/**
 * Action pinning across the fleet (threat triage 2026-10-09, menace 6; owner
 * arbitration 2026-10-10).
 *
 * A tag or a branch named in `uses:` is a pointer the action's owner can move:
 * the next run executes whatever it points to, with the job's token. Only a
 * full commit id names fixed content. `tools/quality/check-workflows.test.ts`
 * (`ACTION_PIN`) asserted that for this repository alone; this gate carries the
 * same rule to every active, public entry of `ecosystem/repositories.v1.yaml`.
 *
 * Read at `HEAD` (the served branch), for every tracked
 * `.github/workflows/*.y(a)ml` and every tracked `action.y(a)ml` (composite
 * actions run `uses:` steps too):
 *
 *   - `owner/repo[/path]@<40 hex>` — pinned; reusable workflows of the fleet
 *     (`libre-ai/project-governance/.github/workflows/<file>@<sha>`) follow
 *     the same rule, which `check-fleet-pins` already relies on;
 *   - `./<path>` — the same repository at the same commit: nothing to pin;
 *   - `docker://<image>@sha256:<64 hex>` — pinned by digest;
 *   - anything else — a violation, named with its file and line.
 *
 * Two readers extract the references — a line scanner and a YAML parse — and
 * must return the same multiset, or the file is unreadable: a `uses:` written in
 * a flow mapping or behind an anchor would otherwise escape one of them.
 */

import { parseRegistry, type RegistryEntry } from "./check-context-conformance";
import { exemption, type FleetFileReader, readRepositoryFiles } from "./fleet-tree";

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const COMPOSITE_ACTION = /(^|\/)action\.ya?ml$/;

export function isActionDefinition(path: string): boolean {
  return WORKFLOW.test(path) || COMPOSITE_ACTION.test(path);
}

/** The `ACTION_PIN` rule of check-workflows.test.ts, unchanged. */
export const ACTION_PIN = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
const DOCKER_DIGEST = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

export type ReferenceKind = "pinned" | "local" | "docker-digest" | "unpinned";

export function classifyReference(reference: string): ReferenceKind {
  if (reference.startsWith("./")) return "local";
  if (reference.startsWith("docker://")) {
    return DOCKER_DIGEST.test(reference) ? "docker-digest" : "unpinned";
  }
  return ACTION_PIN.test(reference) ? "pinned" : "unpinned";
}

export interface UsesLine {
  readonly line: number;
  readonly reference: string;
}

const USES_LINE = /^\s*(?:-\s+)?uses\s*:\s*(.*)$/;

/** Reader 1: every block-style `uses:` line, comment stripped, quotes removed. */
export function scanUsesLines(text: string): UsesLine[] {
  const found: UsesLine[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const match = USES_LINE.exec(raw);
    if (match === null) continue;
    let value = (match[1] ?? "").trim();
    const quoted = /^(["'])(.*)\1/.exec(value);
    if (quoted !== null) value = quoted[2] ?? "";
    else value = value.replace(/\s+#.*$/, "").trim();
    found.push({ line: index + 1, reference: value });
  }
  return found;
}

/** Reader 2: every string value of a `uses` key, at any depth of the parsed document. */
export function collectUsesValues(document: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "uses" && typeof value === "string") found.push(value);
        else walk(value);
      }
    }
  };
  walk(document);
  return found;
}

export interface FileReview {
  readonly references: readonly UsesLine[];
  readonly failures: readonly string[];
  readonly unreadable: string | null;
}

export function reviewDefinition(text: string): FileReview {
  const references = scanUsesLines(text);
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (error) {
    return {
      references,
      failures: [],
      unreadable: `YAML parse failed: ${(error as Error).message}`,
    };
  }
  const fromLines = references.map((r) => r.reference).sort();
  const fromYaml = collectUsesValues(parsed).sort();
  if (JSON.stringify(fromLines) !== JSON.stringify(fromYaml)) {
    return {
      references,
      failures: [],
      unreadable: `the line scanner found ${fromLines.length} \`uses:\` and the YAML parse ${fromYaml.length}, or different values — one reader is blind to part of the file`,
    };
  }
  const failures = references
    .filter((r) => classifyReference(r.reference) === "unpinned")
    .map(
      (r) =>
        `line ${r.line}: \`uses: ${r.reference}\` is not pinned to a 40-character commit id — resolve it with \`gh api repos/<owner>/<action>/git/ref/tags/<tag>\` and keep the tag as a \`# <tag>\` comment`,
    );
  return { references, failures, unreadable: null };
}

export interface ActionPinTally {
  repositories: number;
  exempt: number;
  filesTracked: number;
  filesExamined: number;
  pinned: number;
  local: number;
  dockerDigest: number;
  unpinned: number;
}

export function emptyTally(): ActionPinTally {
  return {
    repositories: 0,
    exempt: 0,
    filesTracked: 0,
    filesExamined: 0,
    pinned: 0,
    local: 0,
    dockerDigest: 0,
    unpinned: 0,
  };
}

export function summarizeVolume(t: ActionPinTally): string {
  const uses = t.pinned + t.local + t.dockerDigest + t.unpinned;
  return `${t.repositories + t.exempt} inventory entries (${t.repositories} read, ${t.exempt} exempt): ${t.filesExamined} of ${t.filesTracked} tracked workflow/action file(s) examined, ${uses} \`uses:\` = ${t.pinned} pinned by commit + ${t.local} local + ${t.dockerDigest} docker by digest + ${t.unpinned} unpinned`;
}

export interface ItemCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

export async function reviewRepository(
  entry: RegistryEntry,
  tally: ActionPinTally,
  reader: FleetFileReader = readRepositoryFiles,
): Promise<ItemCheck[]> {
  const exempt = exemption(entry);
  if (exempt !== null) {
    tally.exempt++;
    return [{ item: entry.repository, ok: true, note: `exempt: ${exempt}` }];
  }
  tally.repositories++;
  const { listing, files } = await reader(entry.repository, isActionDefinition);
  if (listing.kind === "unreadable") {
    return [
      { item: entry.repository, ok: false, note: `tree unreadable at HEAD: ${listing.reason}` },
    ];
  }
  const definitions = listing.paths.filter(isActionDefinition);
  tally.filesTracked += definitions.length;
  if (definitions.length === 0) {
    return [{ item: entry.repository, ok: true, note: "no workflow or action definition tracked" }];
  }
  const checks: ItemCheck[] = [];
  for (const path of definitions) {
    const item = `${entry.repository}:${path}`;
    const read = files.get(path);
    if (read === undefined || read.kind === "unreadable") {
      checks.push({
        item,
        ok: false,
        note: `unreadable at HEAD: ${read?.reason ?? "no read outcome recorded"}`,
      });
      continue;
    }
    const review = reviewDefinition(read.text);
    if (review.unreadable !== null) {
      checks.push({ item, ok: false, note: `unreadable: ${review.unreadable}` });
      continue;
    }
    tally.filesExamined++;
    for (const reference of review.references) {
      const kind = classifyReference(reference.reference);
      if (kind === "pinned") tally.pinned++;
      else if (kind === "local") tally.local++;
      else if (kind === "docker-digest") tally.dockerDigest++;
      else tally.unpinned++;
    }
    checks.push({
      item,
      ok: review.failures.length === 0,
      note:
        review.failures.length === 0
          ? `${review.references.length} uses: reference(s), all pinned or local`
          : review.failures.join("; "),
    });
  }
  return checks;
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const report = new GateReport();
  const tally = emptyTally();
  for (const entry of registry) {
    for (const check of await reviewRepository(entry, tally)) {
      report.check(check.item, check.ok, check.note);
    }
  }
  report.volume(summarizeVolume(tally));
  if (report.outcome !== "pass") console.error(`Action pins volume: ${summarizeVolume(tally)}`);
  concludeGate("Action pins", report);
}
