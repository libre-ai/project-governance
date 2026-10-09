/**
 * Fleet generation bump: plan, and on request open, the pull request that
 * moves every consumer of the authority to a new governance generation.
 *
 *   bun tools/fleet/bump-generation.ts [--dry-run] [--to <sha>] [--public-only]
 *                                      [--only <owner/name,...>] [--summary <file>]
 *   bun tools/fleet/bump-generation.ts --apply ...
 *
 * `--dry-run` is the default and writes nothing anywhere. It reads the declared
 * generations from ecosystem/fleet-pins.v1.yaml, the consumers from
 * ecosystem/repositories.v1.yaml, and each consumer's surfaces through one
 * GraphQL batch of `HEAD:` expressions — the served branch, whatever it is
 * called. The planner (`bump-plan.ts`) decides; this file only reads, prints and,
 * under `--apply`, writes.
 *
 * `--apply` needs a write token in the environment variable named by
 * `apply_token_secret` in bump-generation.v1.yaml, and a target that the
 * register already declares (declare, then bump — fleet-pins.v1.yaml step 3).
 * For every repository planned as `bump` it clones the served branch,
 * re-plans on the clone, which is a second instrument and also a full-tree
 * count of the old generation, refuses when the two plans disagree, then
 * commits on `work/bump-<gen8>` with `-s`, pushes without force and opens the
 * pull request. It never merges: the consumer's required checks and a reviewer
 * do.
 *
 * Exit status: 0 when every target is bumpable, up to date or carries no
 * surface; 1 when any is refused or unreadable, or when nothing was observed.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildIndex, type InventoryEntry } from "../../ecosystem/build-index";
import {
  delay,
  ghGraphQLRaw,
  hasUsableGraphQLData,
  RETRY_DELAYS_MS,
} from "../../ecosystem/github-fleet";
import {
  AUTHORITY,
  citedPaths,
  type HistoricalSite,
  type PlanContext,
  planRepository,
  type RepositoryPlan,
  type Scan,
  type Snapshot,
  scanSnapshot,
} from "./bump-plan";

const FULL_SHA = /^[0-9a-f]{40}$/;
const COMPOSITION_MANIFEST = ".github/composition/manifest.json";

/** Root files read on every consumer besides the workflows tree and the card. */
export const ROOT_SURFACES = [
  "package.json",
  "bun.lock",
  "README.md",
  "README.fr.md",
  "AGENTS.md",
  "toolchains/github-actions.json",
  "Cargo.toml",
] as const;

export interface BumpData {
  readonly identity: { readonly name: string; readonly email: string };
  readonly tokenSecret: string;
  readonly historical: readonly HistoricalSite[];
}

function requireString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`bump-generation.v1.yaml: ${where} must be a non-empty string`);
  }
  return value;
}

export function parseBumpData(text: string): BumpData {
  const document = Bun.YAML.parse(text) as Record<string, unknown> | null;
  if (document === null || document.schema_version !== "libre-ai.fleet-bump.v1") {
    throw new Error("bump-generation.v1.yaml: schema_version must be libre-ai.fleet-bump.v1");
  }
  const identity = document.commit_identity as Record<string, unknown> | undefined;
  const historical = document.historical_sites;
  if (!Array.isArray(historical)) {
    throw new Error("bump-generation.v1.yaml: historical_sites must be a sequence");
  }
  return {
    identity: {
      name: requireString(identity?.name, "commit_identity.name"),
      email: requireString(identity?.email, "commit_identity.email"),
    },
    tokenSecret: requireString(document.apply_token_secret, "apply_token_secret"),
    historical: historical.map((entry, index) => {
      const record = entry as Record<string, unknown>;
      const sha = requireString(record.sha, `historical_sites[${index}].sha`);
      if (!FULL_SHA.test(sha)) {
        throw new Error(
          `bump-generation.v1.yaml: historical_sites[${index}].sha is not a full sha`,
        );
      }
      return {
        repository: requireString(record.repository, `historical_sites[${index}].repository`),
        path: requireString(record.path, `historical_sites[${index}].path`),
        sha,
        reason: requireString(record.reason, `historical_sites[${index}].reason`).trim(),
      };
    }),
  };
}

export interface BumpTarget {
  readonly repository: string;
  readonly card: string;
  readonly cardDeclared: boolean;
}

export interface TargetSelection {
  readonly targets: readonly BumpTarget[];
  /** Repositories left out on purpose, with the reason printed on every run. */
  readonly excluded: readonly { readonly repository: string; readonly reason: string }[];
}

/**
 * Every non-archived repository except the authority itself, which consumes no
 * generation. Private repositories are excluded only on request, and then by
 * name: a workflow token cannot read them, and silence about them would make
 * the plan look complete.
 */
export function selectTargets(
  repositories: readonly Pick<InventoryEntry, "repository" | "visibility" | "lifecycle" | "card">[],
  options: { readonly publicOnly: boolean; readonly only: readonly string[] | null },
): TargetSelection {
  const targets: BumpTarget[] = [];
  const excluded: { repository: string; reason: string }[] = [];
  for (const entry of repositories) {
    if (entry.lifecycle === "archived") continue;
    if (entry.repository === AUTHORITY) continue;
    if (options.only !== null && !options.only.includes(entry.repository)) continue;
    if (options.publicOnly && entry.visibility === "private") {
      excluded.push({
        repository: entry.repository,
        reason: "private — not readable without the apply token, not planned",
      });
      continue;
    }
    targets.push({
      repository: entry.repository,
      card: entry.card ?? "project.v1.yaml",
      cardDeclared: entry.card !== undefined,
    });
  }
  return { targets, excluded };
}

/** One aliased block per target: the workflows tree plus one Blob per candidate file. */
export function buildSourcesQuery(targets: readonly BumpTarget[]): string {
  const blocks = targets.map((target, index) => {
    const [owner, name] = target.repository.split("/");
    if (owner === undefined || name === undefined) {
      throw new Error(`malformed repository entry, expected "owner/name": ${target.repository}`);
    }
    const paths = [target.card, ...ROOT_SURFACES.filter((path) => path !== target.card)];
    const blobs = paths.map(
      (path, blob) =>
        `    f${blob}: object(expression: ${JSON.stringify(`HEAD:${path}`)}) { ... on Blob { text } }`,
    );
    return [
      `  repo${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {`,
      `    workflows: object(expression: "HEAD:.github/workflows") {`,
      `      ... on Tree { entries { name type object { ... on Blob { text } } } }`,
      `    }`,
      ...blobs,
      `  }`,
    ].join("\n");
  });
  return `query {\n${blocks.join("\n")}\n}`;
}

type SnapshotOutcome = Snapshot | { readonly repository: string; readonly error: string };

interface TreeEntry {
  readonly name?: string;
  readonly type?: string;
  readonly object?: { readonly text?: string | null } | null;
}

export function parseSourcesResponse(
  targets: readonly BumpTarget[],
  data: Readonly<Record<string, unknown>> | undefined,
): SnapshotOutcome[] {
  return targets.map((target, index) => {
    const node = data?.[`repo${index}`] as Record<string, unknown> | null | undefined;
    if (node === null || node === undefined) {
      return { repository: target.repository, error: "repository not resolvable via GraphQL" };
    }
    const files = new Map<string, string>();
    const tree = node.workflows as { entries?: readonly (TreeEntry | null)[] } | null | undefined;
    for (const entry of tree?.entries ?? []) {
      if (entry === null || typeof entry.name !== "string" || !/\.ya?ml$/.test(entry.name))
        continue;
      if (entry.type !== undefined && entry.type !== "blob") continue;
      const text = entry.object?.text;
      if (typeof text === "string") files.set(`.github/workflows/${entry.name}`, text);
    }
    const paths = [target.card, ...ROOT_SURFACES.filter((path) => path !== target.card)];
    paths.forEach((path, blob) => {
      const text = (node[`f${blob}`] as { text?: string | null } | null | undefined)?.text;
      if (typeof text === "string") files.set(path, text);
    });
    if (files.size === 0 && target.cardDeclared) {
      return {
        repository: target.repository,
        error: "no workflow, card or root surface could be read on the served branch",
      };
    }
    return { repository: target.repository, files };
  });
}

async function graphQL(query: string): Promise<Readonly<Record<string, unknown>> | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const { stdout } = await ghGraphQLRaw(query);
    try {
      const parsed: unknown = JSON.parse(stdout);
      if (hasUsableGraphQLData(parsed)) return parsed.data;
    } catch {
      // Not JSON: retried below, then reported as unreadable — never as empty.
    }
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return null;
}

/** What the authority serves at the generations a plan compares. */
export function buildAuthorityQuery(
  target: string,
  generations: readonly string[],
  cited: readonly string[],
): string {
  for (const sha of [target, ...generations]) {
    if (!FULL_SHA.test(sha)) throw new Error(`a generation is a full commit sha, got: ${sha}`);
  }
  const [owner, name] = AUTHORITY.split("/") as [string, string];
  return [
    "query {",
    `  authority: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {`,
    `    commit: object(oid: ${JSON.stringify(target)}) { oid }`,
    `    manifest: object(expression: ${JSON.stringify(`${target}:package.json`)}) { ... on Blob { text } }`,
    ...generations.map(
      (sha, index) =>
        `    g${index}: object(expression: ${JSON.stringify(`${sha}:${COMPOSITION_MANIFEST}`)}) { ... on Blob { text } }`,
    ),
    ...cited.map(
      (path, index) =>
        `    p${index}: object(expression: ${JSON.stringify(`${target}:${path}`)}) { __typename }`,
    ),
    "  }",
    "}",
  ].join("\n");
}

const tarballUrl = (sha: string): string =>
  `https://codeload.github.com/${AUTHORITY}/legacy.tar.gz/${sha}`;

/**
 * The integrity bun writes for a `github:` dependency: sha512 of the legacy
 * tarball GitHub serves for that commit, base64-encoded. Verified on
 * 2026-10-09 against signalement's lock at 7c2238d6 and 1c8b37c8, both equal.
 */
async function tarballIntegrity(sha: string): Promise<string | null> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(tarballUrl(sha));
      if (response.ok) {
        const hasher = new Bun.CryptoHasher("sha512");
        hasher.update(await response.arrayBuffer());
        return `sha512-${hasher.digest("base64")}`;
      }
    } catch {
      // Network error: retried, then null, which refuses every lock edit.
    }
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) await delay(wait);
  }
  return null;
}

const short = (sha: string | null): string => (sha === null ? "—" : sha.slice(0, 8));

export function renderPlanTable(plans: readonly RepositoryPlan[]): string[] {
  const rows = [
    "| Repository | From | Files | Sites | Would change | Left | Verdict |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const plan of plans) {
    const files = new Set(plan.sites.map((site) => site.path)).size;
    const change = plan.edits.reduce((sum, edit) => sum + edit.sites, 0);
    rows.push(
      `| ${plan.repository} | ${short(plan.from)} | ${files} | ${plan.sites.length} | ${change} | ${plan.left.length} | ${plan.status} |`,
    );
  }
  return rows;
}

export function renderPlanDetail(plan: RepositoryPlan): string[] {
  const lines = [`### ${plan.repository} — ${plan.status}`];
  for (const edit of plan.edits) lines.push(`- change ${edit.path} (${edit.sites} site(s))`);
  for (const site of plan.sites) lines.push(`  - ${site.path}:${site.line} ${site.form}`);
  for (const left of plan.left) {
    lines.push(`- left ${left.path}${left.line === null ? "" : `:${left.line}`} — ${left.reason}`);
  }
  for (const refusal of plan.refusals) lines.push(`- REFUSED: ${refusal}`);
  for (const note of plan.notes) lines.push(`- note: ${note}`);
  return lines;
}

interface Options {
  readonly apply: boolean;
  readonly to: string | null;
  readonly publicOnly: boolean;
  readonly only: readonly string[] | null;
  readonly summary: string | null;
}

export function parseOptions(argv: readonly string[]): Options {
  let apply = false;
  let to: string | null = null;
  let publicOnly = false;
  let only: string[] | null = null;
  let summary: string | null = null;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${argument} needs a value`);
      index += 1;
      return next;
    };
    if (argument === "--dry-run") apply = false;
    else if (argument === "--apply") apply = true;
    else if (argument === "--to") to = value();
    else if (argument === "--public-only") publicOnly = true;
    else if (argument === "--only")
      only = value()
        .split(",")
        .filter((entry) => entry !== "");
    else if (argument === "--summary") summary = value();
    else throw new Error(`unknown argument ${argument}`);
  }
  if (to !== null && !FULL_SHA.test(to)) throw new Error(`--to ${to} is not a 40-character sha`);
  return { apply, to, publicOnly, only, summary };
}

// --- apply ------------------------------------------------------------------

/**
 * The token reaches git through a credential helper that reads it from the
 * environment at call time: it is never written on a command line, a remote
 * URL or a file, and so never into a process listing or `.git/config`.
 */
const CREDENTIAL_HELPER = [
  "-c",
  "credential.helper=",
  "-c",
  'credential.helper=!f() { echo username=x-access-token; echo "password=$BUMP_TOKEN"; }; f',
];

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(
  command: readonly string[],
  options: { cwd?: string; env: Record<string, string>; stdin?: string },
): Run {
  const result = Bun.spawnSync([...command], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0" },
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
  });
  return {
    code: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

const SERVED = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m;

/** Whether a tracked path is read into the clone snapshot. */
export function isCandidatePath(path: string, card: string): boolean {
  if (path === card) return true;
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return true;
  if (
    /(^|\/)(package\.json|bun\.lock|project\.v1\.yaml|AGENTS\.md|README(\.[a-z]{2})?\.md)$/.test(
      path,
    )
  ) {
    return true;
  }
  return path === "Cargo.toml" || /^toolchains\/[^/]+\.json$/.test(path);
}

export function commitMessage(plan: RepositoryPlan): { title: string; body: string } {
  const paths = plan.edits.map((edit) => edit.path).join(" ");
  return {
    title: `chore(pins): move governance pins to generation ${short(plan.to)}`,
    body: [
      `Move every ${AUTHORITY} pin surface of this repository from generation`,
      `${short(plan.from)} to ${plan.to}, declared in ecosystem/fleet-pins.v1.yaml.`,
      "",
      `Surfaces: ${paths}`,
      "",
      `Opened by ${AUTHORITY} tools/fleet/bump-generation.ts. The merge stays with`,
      "this repository's required checks and a reviewer.",
    ].join("\n"),
  };
}

type ApplyOutcome =
  | { readonly repository: string; readonly ok: true; readonly detail: string }
  | { readonly repository: string; readonly ok: false; readonly detail: string };

async function applyRepository(
  plan: RepositoryPlan,
  target: BumpTarget,
  context: PlanContext,
  data: BumpData,
  token: string,
): Promise<ApplyOutcome> {
  const env = { BUMP_TOKEN: token };
  const url = `https://github.com/${plan.repository}.git`;
  const branch = `work/bump-${short(plan.to)}`;
  const git = (args: readonly string[], cwd?: string, stdin?: string): Run =>
    run(["git", ...CREDENTIAL_HELPER, ...args], { cwd, env, stdin });
  const fail = (detail: string): ApplyOutcome => ({
    repository: plan.repository,
    ok: false,
    detail,
  });

  const head = git(["ls-remote", "--symref", url, "HEAD"]);
  const served = SERVED.exec(head.stdout)?.[1];
  if (head.code !== 0 || served === undefined)
    return fail(`cannot resolve the served branch: ${head.stderr.trim()}`);
  const existing = git(["ls-remote", "--heads", url, `refs/heads/${branch}`]);
  if (existing.code !== 0) return fail(`cannot list ${branch}: ${existing.stderr.trim()}`);
  if (existing.stdout.trim() !== "") {
    return {
      repository: plan.repository,
      ok: true,
      detail: `${branch} already exists — already proposed, left as is`,
    };
  }

  const directory = mkdtempSync(join(tmpdir(), "bumpbot-"));
  try {
    const clone = git([
      "clone",
      "--quiet",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      served,
      url,
      directory,
    ]);
    if (clone.code !== 0) return fail(`clone failed: ${clone.stderr.trim()}`);
    const from = plan.from as string;
    const listed = git(["ls-files", "-z"], directory)
      .stdout.split("\0")
      .filter((path) => path !== "");
    const grep = git(["grep", "-l", "-z", "-I", "-F", from.slice(0, 7)], directory);
    const carrying = grep.code === 0 ? grep.stdout.split("\0").filter((path) => path !== "") : [];
    const paths = new Set([
      ...listed.filter((path) => isCandidatePath(path, target.card)),
      ...carrying,
    ]);
    const files = new Map<string, string>();
    for (const path of [...paths].sort())
      files.set(path, readFileSync(join(directory, path), "utf8"));
    const snapshot: Snapshot = { repository: plan.repository, files };
    const replanned = planRepository(snapshot, scanSnapshot(snapshot, data.historical), context);
    const signature = (p: RepositoryPlan): string =>
      JSON.stringify(p.edits.map((edit) => [edit.path, edit.sites, edit.after]));
    if (replanned.status !== "bump" || signature(replanned) !== signature(plan)) {
      return fail(
        `the clone of ${served} and the GraphQL read disagree (${replanned.status}: ${replanned.refusals.join("; ") || "different edit set"}) — nothing written`,
      );
    }
    for (const edit of replanned.edits) writeFileSync(join(directory, edit.path), edit.after);
    const { title, body } = commitMessage(replanned);
    const steps: (readonly string[])[] = [
      ["checkout", "--quiet", "-b", branch],
      ["add", "--", ...replanned.edits.map((edit) => edit.path)],
      [
        "-c",
        `user.name=${data.identity.name}`,
        "-c",
        `user.email=${data.identity.email}`,
        "commit",
        "--quiet",
        "-s",
        "-m",
        title,
        "-m",
        body,
      ],
    ];
    for (const step of steps) {
      const result = git(step, directory);
      if (result.code !== 0) return fail(`git ${step[0]} failed: ${result.stderr.trim()}`);
    }
    // signalement refuses a sign-off that is not the last line.
    const message = git(["log", "-1", "--format=%B"], directory).stdout.trimEnd().split("\n");
    const expected = `Signed-off-by: ${data.identity.name} <${data.identity.email}>`;
    if (message[message.length - 1] !== expected)
      return fail("the sign-off is not the last line of the commit message");
    const changed = git(["diff", "--name-only", "HEAD~1", "HEAD"], directory)
      .stdout.trim()
      .split("\n")
      .sort();
    if (
      JSON.stringify(changed) !== JSON.stringify(replanned.edits.map((edit) => edit.path).sort())
    ) {
      return fail(`the commit changes ${changed.join(" ")}, not the planned files — not pushed`);
    }
    const push = git(["push", "--quiet", "origin", `HEAD:refs/heads/${branch}`], directory);
    if (push.code !== 0) return fail(`push failed: ${push.stderr.trim()}`);
    const pr = run(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        plan.repository,
        "--base",
        served,
        "--head",
        branch,
        "--title",
        title,
        "--body-file",
        "-",
      ],
      { env: { GH_TOKEN: token }, stdin: `${body}\n\n${renderPlanDetail(replanned).join("\n")}\n` },
    );
    if (pr.code !== 0)
      return fail(`pushed ${branch}, but the pull request was not opened: ${pr.stderr.trim()}`);
    return { repository: plan.repository, ok: true, detail: `opened ${pr.stdout.trim()}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// --- main -------------------------------------------------------------------

if (import.meta.main) {
  const options = parseOptions(process.argv.slice(2));
  const root = new URL("../../", import.meta.url);
  const register = Bun.YAML.parse(
    await Bun.file(new URL("ecosystem/fleet-pins.v1.yaml", root)).text(),
  ) as { readonly generations: ReadonlyArray<{ readonly sha: string }> };
  const generations = register.generations.map((generation) => generation.sha);
  const inventory = buildIndex(
    await Bun.file(new URL("ecosystem/repositories.v1.yaml", root)).text(),
  );
  const data = parseBumpData(
    await Bun.file(new URL("tools/fleet/bump-generation.v1.yaml", root)).text(),
  );
  const target = options.to ?? (generations[generations.length - 1] as string);
  const declared = generations.includes(target);

  const output: string[] = [];
  const say = (line: string): void => {
    console.log(line);
    output.push(line);
  };

  const selection = selectTargets(inventory.repositories, options);
  const fetched = await graphQL(buildSourcesQuery(selection.targets));
  const outcomes: SnapshotOutcome[] =
    fetched === null
      ? selection.targets.map((t) => ({
          repository: t.repository,
          error: "GraphQL batch unanswered after retries",
        }))
      : parseSourcesResponse(selection.targets, fetched);

  const scans = new Map<string, { snapshot: Snapshot; scan: Scan }>();
  const unreadable: { repository: string; error: string }[] = [];
  for (const outcome of outcomes) {
    if ("error" in outcome) unreadable.push(outcome);
    else
      scans.set(outcome.repository, {
        snapshot: outcome,
        scan: scanSnapshot(outcome, data.historical),
      });
  }
  const froms = [
    ...new Set(
      [...scans.values()]
        .map((entry) => entry.scan.from)
        .filter((sha): sha is string => sha !== null),
    ),
  ].sort();
  const compared = [...new Set([...froms, target])];
  const cited = citedPaths([...scans.values()].map((entry) => entry.scan));
  const authority = await graphQL(buildAuthorityQuery(target, compared, cited));
  const node = (authority?.authority ?? null) as Record<string, unknown> | null;
  if (node === null || (node.commit as { oid?: string } | null)?.oid !== target) {
    console.error(
      node === null
        ? `cannot read ${AUTHORITY}: the authority query was not answered`
        : `${target} is not a commit of ${AUTHORITY}`,
    );
    process.exit(1);
  }
  const composition = new Map<string, string | null>(
    compared.map((sha, index) => [
      sha,
      (node[`g${index}`] as { text?: string } | null)?.text ?? null,
    ]),
  );
  const targetPaths = new Set(
    cited.filter((_, index) => node[`p${index}`] !== null && node[`p${index}`] !== undefined),
  );
  const needsIntegrity = [...scans.values()].some((entry) =>
    entry.scan.sites.some((site) => site.form === "lock-resolution"),
  );
  const context: PlanContext = {
    target,
    generations,
    historical: data.historical,
    composition,
    targetManifest: (node.manifest as { text?: string } | null)?.text ?? null,
    targetIntegrity: needsIntegrity ? await tarballIntegrity(target) : null,
    targetPaths,
  };

  const plans = [...scans.values()].map(({ snapshot, scan }) =>
    planRepository(snapshot, scan, context),
  );
  say(`## Fleet bump plan to ${target}`);
  say("");
  say(
    declared
      ? `Target ${short(target)} is generation ${generations.indexOf(target) + 1} of ${generations.length} declared in ecosystem/fleet-pins.v1.yaml.`
      : `Target ${short(target)} is NOT declared in ecosystem/fleet-pins.v1.yaml: this is a plan only, --apply refuses it (declare, then bump).`,
  );
  say("");
  for (const line of renderPlanTable(plans)) say(line);
  for (const entry of unreadable)
    say(`| ${entry.repository} | — | — | — | — | — | unreadable: ${entry.error} |`);
  for (const entry of selection.excluded)
    say(`| ${entry.repository} | — | — | — | — | — | excluded: ${entry.reason} |`);
  say("");
  for (const plan of plans) {
    if (plan.status === "no-surface") continue;
    for (const line of renderPlanDetail(plan)) say(line);
  }

  const count = (status: string): number => plans.filter((plan) => plan.status === status).length;
  const sites = plans.reduce((sum, plan) => sum + plan.sites.length, 0);
  const filesRead = [...scans.values()].reduce((sum, entry) => sum + entry.snapshot.files.size, 0);
  say("");
  say(
    `Bump plan to ${short(target)}: ${count("bump")} to bump, ${count("up-to-date")} up to date, ` +
      `${count("no-surface")} without surface, ${count("refused")} refused, ${unreadable.length} unreadable, ` +
      `${selection.excluded.length} excluded, across ${selection.targets.length + selection.excluded.length} target(s); ` +
      `${sites} site(s) read in ${filesRead} file(s).`,
  );

  let failed = count("refused") > 0 || unreadable.length > 0;
  if (sites === 0) {
    say("No pin surface was observed on any target — the tool lost its inputs.");
    failed = true;
  }

  if (options.apply) {
    const token = process.env[data.tokenSecret] ?? "";
    if (token === "") {
      say(`apply disabled: no ${data.tokenSecret}`);
      failed = true;
    } else if (!declared) {
      say(`apply refused: ${short(target)} is not a declared generation`);
      failed = true;
    } else {
      for (const plan of plans.filter((p) => p.status === "bump")) {
        const entry = selection.targets.find((t) => t.repository === plan.repository) as BumpTarget;
        const outcome = await applyRepository(plan, entry, context, data, token);
        say(`- apply ${outcome.repository}: ${outcome.ok ? "" : "FAILED — "}${outcome.detail}`);
        if (!outcome.ok) failed = true;
      }
    }
  }

  if (options.summary !== null) {
    writeFileSync(options.summary, `${output.join("\n")}\n`, { flag: "a" });
  }
  process.exit(failed ? 1 : 0);
}
