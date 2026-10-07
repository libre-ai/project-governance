#!/usr/bin/env bun
/**
 * Heterogeneous cold-reader runner (positioning L3).
 *
 * Doctrinal purpose — decorrelate the reviewers: the agents that build this
 * repository share a provider and a context window, so their reading of the
 * public surfaces cannot count as independent. This runner submits ONLY the
 * public surfaces (the organization profile README and the monorepo README,
 * fetched raw and anonymously) to a model from ANOTHER provider with zero
 * project context, then grades the answers against the versioned grid in
 * `questionnaire.json`.
 *
 * The backend is pluggable via environment variables and NO provider is
 * hardcoded — sovereignty rationale: the reviewer must be able to run on a
 * self-hosted EU endpoint (vLLM, llama.cpp, Ollama all speak the
 * OpenAI-chat API) just as well as on any commercial one.
 *
 *   COLD_READER_CMD        shell command; prompt on stdin, answer on stdout
 *                          (wins over the HTTP backend when both are set:
 *                          a local command is the most sovereign option)
 *   COLD_READER_BASE_URL   OpenAI-chat-compatible endpoint base URL
 *   COLD_READER_MODEL      model name (required with COLD_READER_BASE_URL)
 *   COLD_READER_API_KEY    optional bearer token (self-hosted endpoints may
 *                          need none)
 *
 * Without any backend configured the runner writes an explicit
 * `status: "pending"` verdict — the POLARIS.md IN-SERVICE vs PENDING honesty
 * convention — and exits 0: the code stays green with no key anywhere.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gradeQuestionnaire,
  parseQuestionnaire,
  type Questionnaire,
  type QuestionScore,
} from "./grading";

const COLD_READER_SCHEMA_VERSION = "libre-ai.cold-reader.v1";

interface PublicSurface {
  readonly id: string;
  readonly url: string;
}

/** The only inputs the cold reader may see: anonymous, public, raw. */
const PUBLIC_SURFACES: readonly PublicSurface[] = [
  {
    id: "org-profile",
    url: "https://raw.githubusercontent.com/libre-ai/.github/main/profile/README.md",
  },
  {
    id: "monorepo-readme",
    url: "https://raw.githubusercontent.com/libre-ai/libre-ai/main/README.md",
  },
];

type Backend =
  | { readonly kind: "cli"; readonly command: string }
  | {
      readonly kind: "openai-compatible";
      readonly baseUrl: string;
      readonly model: string;
      readonly apiKey: string | null;
    };

function resolveBackend(env: Readonly<Record<string, string | undefined>>): Backend | null {
  const command = env.COLD_READER_CMD;
  if (command !== undefined && command.length > 0) {
    return { kind: "cli", command };
  }
  const baseUrl = env.COLD_READER_BASE_URL;
  if (baseUrl !== undefined && baseUrl.length > 0) {
    const model = env.COLD_READER_MODEL;
    if (model === undefined || model.length === 0) {
      // An half-configured backend is an operator mistake, not a pending
      // state: failing loud avoids publishing a false "pending" verdict.
      throw new Error("COLD_READER_BASE_URL is set but COLD_READER_MODEL is missing");
    }
    return {
      kind: "openai-compatible",
      baseUrl: baseUrl.replace(/\/+$/, ""),
      model,
      apiKey: env.COLD_READER_API_KEY ?? null,
    };
  }
  return null;
}

async function ask(backend: Backend, prompt: string): Promise<string> {
  if (backend.kind === "cli") {
    // The command string is operator-supplied configuration (their own
    // machine, their own shell) — not observed content.
    const proc = Bun.spawn(["sh", "-c", backend.command], {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`cold-reader CLI backend exited with code ${exitCode}`);
    }
    return stdout.trim();
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (backend.apiKey !== null) {
    headers.authorization = `Bearer ${backend.apiKey}`;
  }
  const response = await fetch(`${backend.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: backend.model,
      // temperature 0: the grid grades understanding, not sampling luck.
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    throw new Error(`cold-reader backend returned HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  const content = extractChatContent(payload);
  if (content === null) {
    throw new Error("cold-reader backend response carried no message content");
  }
  return content;
}

function extractChatContent(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0];
  if (typeof first !== "object" || first === null) {
    return null;
  }
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : null;
}

interface FetchedSurface extends PublicSurface {
  readonly content: string;
  readonly sha256: string;
  readonly bytes: number;
}

async function fetchSurfaces(): Promise<FetchedSurface[]> {
  return Promise.all(
    PUBLIC_SURFACES.map(async (surface) => {
      const response = await fetch(surface.url);
      if (!response.ok) {
        throw new Error(`public surface ${surface.id} returned HTTP ${response.status}`);
      }
      const content = await response.text();
      return {
        ...surface,
        content,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: Buffer.byteLength(content),
      };
    }),
  );
}

/**
 * Zero-context by construction: the prompt contains the surfaces and the
 * question, nothing else — no project glossary, no hints, no prior turns.
 */
function buildPrompt(surfaces: readonly FetchedSurface[], question: string): string {
  const documents = surfaces
    .map((surface) => `--- DOCUMENT ${surface.id} (${surface.url}) ---\n${surface.content}`)
    .join("\n\n");
  return [
    "You are reviewing a project you have never seen before.",
    "The ONLY information available to you is the public documents below.",
    "Answer the question using nothing but these documents.",
    "If the documents do not answer it, say so explicitly.",
    "",
    documents,
    "",
    `QUESTION: ${question}`,
  ].join("\n");
}

function parseOutDir(argv: readonly string[], defaultDir: string): string {
  const flagIndex = argv.indexOf("--out");
  if (flagIndex === -1) {
    return defaultDir;
  }
  const value = argv[flagIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--out requires a directory argument");
  }
  return value;
}

interface GradedQuestion extends QuestionScore {
  readonly question: string;
  readonly answer: string;
}

async function runGraded(
  backend: Backend,
  questionnaire: Questionnaire,
): Promise<{ surfaces: FetchedSurface[]; questions: GradedQuestion[] }> {
  const surfaces = await fetchSurfaces();
  const answers = new Map<string, string>();
  const questions: GradedQuestion[] = [];
  // One request per question: answers must not contaminate each other, and a
  // reviewer that saw question 1 answered would no longer be context-free.
  for (const item of questionnaire.items) {
    console.error(`=== cold-reader: asking ${item.id} ===`);
    const answer = await ask(backend, buildPrompt(surfaces, item.question));
    answers.set(item.id, answer);
  }
  const score = gradeQuestionnaire(questionnaire, answers);
  for (const perQuestion of score.perQuestion) {
    const item = questionnaire.items.find((candidate) => candidate.id === perQuestion.questionId);
    if (item === undefined) {
      throw new Error(`graded unknown question: ${perQuestion.questionId}`);
    }
    questions.push({ ...perQuestion, question: item.question, answer: answers.get(item.id) ?? "" });
  }
  return { surfaces, questions };
}

async function main(): Promise<void> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(moduleDir, "..", "..", "..");
  const outDir = parseOutDir(
    process.argv.slice(2),
    join(repoRoot, "distribution", "evidence", "adoption"),
  );
  const questionnaire = parseQuestionnaire(
    await readFile(join(moduleDir, "questionnaire.json"), "utf8"),
  );
  const backend = resolveBackend(process.env);
  const generatedAt = new Date().toISOString();

  let verdict: Record<string, unknown>;
  if (backend === null) {
    verdict = {
      schemaVersion: COLD_READER_SCHEMA_VERSION,
      status: "pending",
      generatedAt,
      // POLARIS.md honesty convention: not-yet-in-service capabilities are
      // declared PENDING explicitly instead of failing or staying silent.
      pendingReason:
        "no cold-reader backend configured (set COLD_READER_CMD, or COLD_READER_BASE_URL + COLD_READER_MODEL [+ COLD_READER_API_KEY])",
      surfaces: PUBLIC_SURFACES,
      questionnaire: {
        schemaVersion: questionnaire.schemaVersion,
        questions: questionnaire.items.length,
        expectedElements: questionnaire.items.reduce(
          (sum, item) => sum + item.expectedElements.length,
          0,
        ),
      },
    };
    console.error("cold-reader: no backend configured — writing an explicit pending verdict.");
  } else {
    const { surfaces, questions } = await runGraded(backend, questionnaire);
    verdict = {
      schemaVersion: COLD_READER_SCHEMA_VERSION,
      status: "graded",
      generatedAt,
      backend:
        backend.kind === "cli"
          ? { kind: backend.kind }
          : { kind: backend.kind, model: backend.model },
      surfaces: surfaces.map(({ id, url, sha256, bytes }) => ({ id, url, sha256, bytes })),
      questions,
      totals: {
        covered: questions.reduce((sum, question) => sum + question.covered, 0),
        expected: questions.reduce((sum, question) => sum + question.total, 0),
      },
    };
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "cold-reader-latest.json"), `${JSON.stringify(verdict, null, 2)}\n`);
  console.error(
    `cold-reader: verdict '${String(verdict.status)}' written to ${join(outDir, "cold-reader-latest.json")}`,
  );
}

if (import.meta.main) {
  await main();
}
