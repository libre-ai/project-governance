/**
 * Opens one pull request per bump prepared by `plan-bun-update.ts` (ADR-0069).
 *
 *   bun tools/fleet/propose-bun-update.ts --root <checkout> --bundle <directory> --repository <owner/name> --base <branch>
 *
 * This is the only half of `.github/workflows/bun-update.yml` that holds a write
 * token, the job's own `GITHUB_TOKEN`. It installs nothing and runs no dependency
 * code. It refuses everything while ADR-0069 is not accepted, treats the bundle as
 * untrusted input, never forces a push and never merges.
 *
 * The bundle comes from a job that resolved third-party packages, so nothing it
 * declares is believed: the target's existence and age are read again from the
 * public registry, anonymously, and `bun.lock` is parsed and compared with the
 * checkout's. Only the target's dependency closure may change, and only towards
 * registry packages.
 *
 * Exit status: 0 every proposal opened or already open; 1 a proposal refused or
 * failed; 2 usage; 3 disabled because ADR-0069 is not accepted.
 */

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import { parseHeader } from "../quality/check-adr-supersession";
import {
  branchName,
  compareVersions,
  editedManifest,
  examinationRefusal,
  isExactVersion,
  isIsoInstant,
  isSafePackageName,
  lowestVersion,
  normalisedInstant,
  type Packument,
  type Proposal,
  parsePackument,
  type RegistryReader,
  readRegistry,
  readWorkspace,
  SECTIONS,
  type Workspace,
  widestKind,
} from "./plan-bun-update";

export const AUTHORIZING_ADR = "docs/adr/0069-bun-update-pull-requests-with-the-job-token.md";

/** The identity GitHub attributes to `GITHUB_TOKEN`; `git commit -s` signs with it. */
export const BOT_IDENTITY = {
  name: "github-actions[bot]",
  email: "41898282+github-actions[bot]@users.noreply.github.com",
} as const;

/** The token is read from the environment by git at call time, never written to argv or config. */
const CREDENTIAL_HELPER = [
  "-c",
  "credential.helper=",
  "-c",
  'credential.helper=!f() { echo username=x-access-token; echo "password=$BUN_UPDATE_TOKEN"; }; f',
];

const MANIFEST_PATH = /^(?:[A-Za-z0-9._-]+\/)*package\.json$/;
const PR_CREATION_REFUSED = /not permitted to create or approve pull requests/i;
/** ADR-0069 is accepted by the literal `accepted`, optionally dated, and by nothing looser. */
const ACCEPTED_STATUS = /^accepted(?: (\d{4}-\d{2}-\d{2}))?$/;
/** The tokens the workflow hands this tool; only commands that reach the forge receive them. */
const TOKEN_VARIABLES: ReadonlySet<string> = new Set(["BUN_UPDATE_TOKEN", "GH_TOKEN"]);
const REGISTRY_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

export function isAuthorized(adrText: string): boolean {
  const status = parseHeader(AUTHORIZING_ADR, adrText)?.status ?? "";
  const accepted = ACCEPTED_STATUS.exec(status);
  if (accepted === null) return false;
  const date = accepted[1];
  return date === undefined || normalisedInstant(`${date}T00:00:00.000Z`)?.slice(0, 10) === date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Lock {
  readonly document: Readonly<Record<string, unknown>>;
  readonly packages: Readonly<Record<string, readonly unknown[]>>;
}

function readLock(text: string): Lock | null {
  let document: unknown;
  try {
    document = Bun.JSONC.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(document) || !isRecord(document.packages)) return null;
  if (!Object.values(document.packages).every(Array.isArray)) return null;
  return { document, packages: document.packages as Lock["packages"] };
}

/** The installed name of a lock key: `a/@s/b` is `@s/b` nested under `a`. */
function installedName(key: string): string {
  const parts = key.split("/");
  const last = parts.at(-1) ?? "";
  const parent = parts.at(-2);
  return parent?.startsWith("@") ? `${parent}/${last}` : last;
}

/**
 * The names `name` can pull in. Names rather than keys: resolving a bump may move
 * a package between the hoisted and a nested key, and both are the same dependency.
 */
function closureOf(lock: Lock, name: string): ReadonlySet<string> {
  const closure = new Set([name]);
  const entries = Object.entries(lock.packages);
  for (const current of closure) {
    for (const [key, entry] of entries) {
      const metadata = entry[2];
      if (installedName(key) !== current || !isRecord(metadata)) continue;
      for (const field of DEPENDENCY_FIELDS) {
        const declared = metadata[field];
        if (isRecord(declared))
          for (const dependency of Object.keys(declared)) closure.add(dependency);
      }
    }
  }
  return closure;
}

/** Why a lock entry is not a package of the public registry, or null when it is. */
function registryEntryProblem(key: string, entry: readonly unknown[]): string | null {
  const [resolved, url, metadata, integrity] = entry;
  const prefix = `${installedName(key)}@`;
  if (
    entry.length !== 4 ||
    typeof resolved !== "string" ||
    !resolved.startsWith(prefix) ||
    !REGISTRY_VERSION.test(resolved.slice(prefix.length)) ||
    url !== "" ||
    !isRecord(metadata) ||
    typeof integrity !== "string" ||
    !INTEGRITY.test(integrity)
  ) {
    return `bun.lock: ${key} is not a registry package with an integrity`;
  }
  return null;
}

/** The `workspaces` table the checkout's lock should hold once the proposal is applied. */
function expectedWorkspaces(base: Lock, proposal: Proposal): unknown {
  const workspaces = structuredClone(base.document.workspaces);
  if (!isRecord(workspaces)) return null;
  for (const { manifest, section, from } of proposal.edits) {
    const member = manifest === "package.json" ? "" : manifest.slice(0, -"/package.json".length);
    const declared = workspaces[member];
    const entries = isRecord(declared) ? declared[section] : undefined;
    if (!isRecord(entries) || entries[proposal.name] !== from) return null;
    entries[proposal.name] = proposal.to;
  }
  return workspaces;
}

/**
 * Why the bundled lock is more than the resolution of this bump, or null. Every
 * table other than `packages` and the moved declarations stays identical: a new
 * `trustedDependencies` or `patchedDependencies` would change what an install runs.
 */
export function lockProblem(baseText: string, text: string, proposal: Proposal): string | null {
  const base = readLock(baseText);
  const bundled = readLock(text);
  if (base === null) return "the bun.lock of the checkout cannot be read";
  if (bundled === null) return "bun.lock cannot be read";
  const { name, to } = proposal;

  for (const [key, entry] of Object.entries(bundled.packages)) {
    if (typeof entry[1] === "string" && entry[1] !== "") {
      return `bun.lock: ${key} resolves to the URL ${JSON.stringify(entry[1])}`;
    }
  }
  const tables = new Set([...Object.keys(base.document), ...Object.keys(bundled.document)]);
  for (const table of tables) {
    if (table === "packages" || table === "workspaces") continue;
    if (!Bun.deepEquals(base.document[table], bundled.document[table])) {
      return `bun.lock: the table ${table} changed`;
    }
  }
  const workspaces = expectedWorkspaces(base, proposal);
  if (workspaces === null || !Bun.deepEquals(workspaces, bundled.document.workspaces)) {
    return `bun.lock: the workspaces table is not the bump of ${name}`;
  }
  const resolves = Object.entries(bundled.packages).some(
    ([key, entry]) => installedName(key) === name && entry[0] === `${name}@${to}`,
  );
  if (!resolves) return `bun.lock does not resolve ${name}@${to}`;

  const reachable = closureOf(bundled, name);
  for (const [key, entry] of Object.entries(bundled.packages)) {
    if (Bun.deepEquals(base.packages[key], entry)) continue;
    if (!reachable.has(installedName(key))) {
      return `bun.lock: ${key} changed outside the dependencies of ${name}`;
    }
    const problem = registryEntryProblem(key, entry);
    if (problem !== null) return problem;
  }
  const released = closureOf(base, name);
  for (const key of Object.keys(base.packages)) {
    if (bundled.packages[key] === undefined && !released.has(installedName(key))) {
      return `bun.lock: ${key} was removed outside the dependencies of ${name}`;
    }
  }
  return null;
}

/**
 * Why the public registry contradicts the proposal, or null. The bundle's own age
 * is not evidence: only what the registry answers now can prove the release-age floor.
 */
export function registryProblem(
  proposal: Proposal,
  packument: Packument | null,
  now: Date,
): string | null {
  const { name, to } = proposal;
  if (packument === null) return `the registry gave no usable answer for ${name}`;
  const published = new Map(packument.versions.map((version) => [version.version, version]));
  for (const { from } of proposal.edits) {
    if (!published.has(from)) return `${name}@${from} is not published on the registry`;
  }
  const target = published.get(to);
  if (target === undefined) return `${name}@${to} is not published on the registry`;
  if (target.deprecated) return `${name}@${to} is deprecated`;
  if (compareVersions(to, packument.latest) > 0) {
    return `${name}@${to} is above latest ${packument.latest}`;
  }
  const publishedAt = target.publishedAt === null ? null : normalisedInstant(target.publishedAt);
  if (publishedAt === null) return `${name}@${to} has no readable date on the registry`;
  if (publishedAt !== proposal.publishedAt) {
    return `the bundle says ${proposal.publishedAt}, the registry says ${publishedAt}`;
  }
  const ageSeconds = Math.floor((now.getTime() - Date.parse(publishedAt)) / 1000);
  if (ageSeconds < MINIMUM_RELEASE_AGE_SECONDS) {
    return `published ${ageSeconds} seconds ago, below ${MINIMUM_RELEASE_AGE_SECONDS}`;
  }
  return null;
}

/** Why the declarations a proposal moves cannot be moved, or null. */
function editsProblem(
  proposal: Proposal,
  workspace: Pick<Workspace, "overrides" | "memberNames">,
): string | null {
  const { name, from, to, edits, manifests } = proposal;
  if (!Array.isArray(edits) || edits.length === 0) return "no declaration is named";
  for (const { manifest, section, from: declared } of edits) {
    if (!SECTIONS.includes(section)) return `unexpected section ${JSON.stringify(section)}`;
    const refusal = examinationRefusal(
      { manifest, section, name, declared },
      workspace.overrides,
      workspace.memberNames,
    );
    if (refusal !== null) return `${manifest}: ${refusal}`;
    if (compareVersions(to, declared) <= 0) return `${declared} to ${to} does not move up`;
  }
  const froms = edits.map((edit) => edit.from);
  if (from !== lowestVersion(froms)) return `${from} is not the lowest declared version`;
  const kind = widestKind(froms, to);
  if (kind === "major") return `${from} to ${to} is a major: listed, never proposed`;
  if (kind !== proposal.kind) return `declared ${proposal.kind}, measured ${kind}`;
  const named = [...new Set(edits.map((edit) => edit.manifest))].sort();
  if (JSON.stringify(named) !== JSON.stringify([...manifests].sort())) {
    return `the manifests named are not the ones edited: ${named.join(", ")}`;
  }
  return null;
}

/** Why a bundled proposal must not be written, or null when it may be. */
export function proposalProblem(
  proposal: Proposal,
  root: string,
  bundle: string,
  workspace: Pick<Workspace, "overrides" | "memberNames">,
): string | null {
  const { name, from, to, branch, manifests, directory } = proposal;
  if (!isSafePackageName(name)) return `unsafe package name ${JSON.stringify(name)}`;
  if (!isExactVersion(from) || !isExactVersion(to)) return "a version is not exact";
  if (manifests.length === 0) return "no manifest is named";
  const edits = editsProblem(proposal, workspace);
  if (edits !== null) return edits;
  if (branch !== branchName(name, to)) return `unexpected branch ${JSON.stringify(branch)}`;
  if (!isIsoInstant(proposal.publishedAt)) {
    return `publication date ${JSON.stringify(proposal.publishedAt)} is not an ISO instant`;
  }
  if (
    !Number.isSafeInteger(proposal.ageSeconds) ||
    proposal.ageSeconds < MINIMUM_RELEASE_AGE_SECONDS
  ) {
    return `published ${proposal.ageSeconds} seconds ago, below ${MINIMUM_RELEASE_AGE_SECONDS}`;
  }
  if (!/^\d+$/.test(directory)) return `unexpected bundle directory ${JSON.stringify(directory)}`;
  const source = join(bundle, directory);
  const expected = [...manifests, "bun.lock"].sort();
  const present = readdirSync(source, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(source.length + 1))
    .sort();
  if (JSON.stringify(present) !== JSON.stringify(expected)) {
    return `the bundle holds ${present.join(", ")}, not ${expected.join(", ")}`;
  }
  for (const path of expected) {
    if (!lstatSync(join(source, path)).isFile()) return `${path} is not a regular file`;
  }
  for (const manifest of manifests) {
    if (!MANIFEST_PATH.test(manifest) || manifest.split("/").includes("..")) {
      return `${manifest} is not a manifest path`;
    }
    if (!existsSync(join(root, manifest))) return `${manifest} is not in the checkout`;
    const edited = editedManifest(readFileSync(join(root, manifest), "utf8"), manifest, proposal);
    if (edited === null || edited !== readFileSync(join(source, manifest), "utf8")) {
      return `${manifest} differs from the one-line bump of ${name}`;
    }
  }
  return lockProblem(
    readFileSync(join(root, "bun.lock"), "utf8"),
    readFileSync(join(source, "bun.lock"), "utf8"),
    proposal,
  );
}

export function pullRequestTitle(proposal: Proposal): string {
  return `chore(deps): bump ${proposal.name} from ${proposal.from} to ${proposal.to}`;
}

/** The declaration block opens the description: the Door gate reads only those lines. */
export function pullRequestBody(proposal: Proposal): string {
  const froms = [...new Set(proposal.edits.map((edit) => `\`${edit.from}\``))].join(", ");
  return [
    "Door: two-way",
    "Origin: inspection",
    "",
    "## Summary",
    "",
    `Moves \`${proposal.name}\` from ${froms} to \`${proposal.to}\` (${proposal.kind}), published ${proposal.publishedAt}. \`bun.lock\` is regenerated with lifecycle scripts disabled.`,
    "",
    "## Before merging",
    "",
    "This pull request was opened with the job's `GITHUB_TOKEN`, so its checks wait in an approval-required state: a person with write access selects **Approve workflows to run**, then reviews the result. Nothing merges this pull request automatically (ADR-0069).",
    "",
  ].join("\n");
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly stdin?: string;
  /** True for the commands that reach the forge, the only ones given the tokens. */
  readonly network?: boolean;
}

export type CommandRunner = (command: readonly string[], options?: CommandOptions) => CommandResult;

export type Outcome = "opened" | "already-open" | "refused" | "failed";

export interface ProposalResult {
  readonly outcome: Outcome;
  readonly detail: string;
}

function compareUrl(repository: string, base: string, branch: string): string {
  return `https://github.com/${repository}/compare/${base}...${encodeURIComponent(branch)}`;
}

/** Writes one proposal. The caller has verified it with `proposalProblem`. */
export function openProposal(
  proposal: Proposal,
  context: {
    readonly root: string;
    readonly bundle: string;
    readonly repository: string;
    readonly base: string;
    readonly baseSha: string;
  },
  run: CommandRunner,
): ProposalResult {
  const { root, bundle, repository, base, baseSha } = context;
  const { branch } = proposal;
  const git = (...args: readonly string[]) => run(["git", "-C", root, ...args]);
  const failed = (step: string, result: CommandResult): ProposalResult => ({
    outcome: "failed",
    detail: `${step}: ${result.stderr.trim()}`,
  });

  const remote = run(
    [
      "git",
      "-C",
      root,
      ...CREDENTIAL_HELPER,
      "ls-remote",
      "--heads",
      "origin",
      `refs/heads/${branch}`,
    ],
    { network: true },
  );
  if (remote.code !== 0) return failed("ls-remote", remote);
  if (remote.stdout.trim() !== "") {
    const open = run(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "number",
        "--jq",
        "length",
      ],
      { network: true },
    );
    if (open.code !== 0) return failed("pr list", open);
    if (open.stdout.trim() !== "0") return { outcome: "already-open", detail: branch };
    return {
      outcome: "failed",
      detail: `${branch} exists without an open pull request; left as is: ${compareUrl(repository, base, branch)}`,
    };
  }

  const message = join(mkdtempSync(join(tmpdir(), "bun-update-message-")), "message");
  try {
    writeFileSync(message, `${pullRequestTitle(proposal)}\n`);
    const files = [...proposal.manifests, "bun.lock"];
    const switched = git("switch", "--quiet", "--force-create", branch, baseSha);
    if (switched.code !== 0) return failed("switch", switched);
    for (const path of files)
      copyFileSync(join(bundle, proposal.directory, path), join(root, path));
    const steps: readonly (readonly string[])[] = [
      ["add", "--", ...files],
      ["commit", "--quiet", "--signoff", "--file", message],
    ];
    for (const step of steps) {
      const result = git(...step);
      if (result.code !== 0) return failed(step[0] ?? "git", result);
    }
    const changed = git("diff", "--name-only", baseSha, "HEAD");
    const written = changed.stdout.trim().split("\n").sort();
    if (changed.code !== 0 || JSON.stringify(written) !== JSON.stringify([...files].sort())) {
      return { outcome: "failed", detail: `the commit changes ${written.join(", ")}: not pushed` };
    }
    const push = run(
      [
        "git",
        "-C",
        root,
        ...CREDENTIAL_HELPER,
        "push",
        "--quiet",
        "origin",
        `HEAD:refs/heads/${branch}`,
      ],
      { network: true },
    );
    if (push.code !== 0) return failed("push", push);
    const created = run(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        repository,
        "--base",
        base,
        "--head",
        branch,
        "--title",
        pullRequestTitle(proposal),
        "--body-file",
        "-",
      ],
      { stdin: pullRequestBody(proposal), network: true },
    );
    if (created.code === 0) return { outcome: "opened", detail: created.stdout.trim() };
    if (PR_CREATION_REFUSED.test(created.stderr)) {
      return {
        outcome: "refused",
        detail: `pushed ${branch}, but the repository setting "Allow GitHub Actions to create and approve pull requests" is off; a person can open it: ${compareUrl(repository, base, branch)}`,
      };
    }
    return failed("pr create", created);
  } finally {
    rmSync(dirname(message), { recursive: true, force: true });
    // A proposal that failed half way must not leak its files into the next one.
    git("switch", "--quiet", "--discard-changes", "--detach", baseSha);
  }
}

export function spawnCommand(command: readonly string[], options?: CommandOptions): CommandResult {
  const inherited = Object.entries(process.env).filter(
    ([name]) => options?.network === true || !TOKEN_VARIABLES.has(name),
  );
  const result = Bun.spawnSync([...command], {
    env: { ...Object.fromEntries(inherited), GIT_TERMINAL_PROMPT: "0" },
    stdin: options?.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function readOptions(argv: readonly string[]): Map<string, string> | string {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index] ?? "", argv[index + 1]];
    if (!["--root", "--bundle", "--repository", "--base"].includes(key))
      return `unknown argument ${key}`;
    if (value === undefined) return `${key} needs a value`;
    values.set(key, value);
  }
  return values;
}

export async function main(
  argv: readonly string[],
  run: CommandRunner = spawnCommand,
  read: RegistryReader = readRegistry,
  now: Date = new Date(),
): Promise<number> {
  const options = readOptions(argv);
  if (typeof options === "string") {
    console.error(options);
    return 2;
  }
  const [root, bundle, repository, base] = ["--root", "--bundle", "--repository", "--base"].map(
    (key) => options.get(key),
  );
  if (
    root === undefined ||
    bundle === undefined ||
    repository === undefined ||
    base === undefined
  ) {
    console.error("--root, --bundle, --repository and --base are required");
    return 2;
  }
  const adr = join(root, AUTHORIZING_ADR);
  if (!existsSync(adr) || !isAuthorized(readFileSync(adr, "utf8"))) {
    console.error(`disabled: ${AUTHORIZING_ADR} is not accepted; nothing written`);
    return 3;
  }
  const { proposals } = JSON.parse(readFileSync(join(bundle, "plan.json"), "utf8")) as {
    readonly proposals: readonly Proposal[];
  };
  const head = run(["git", "-C", root, "rev-parse", "HEAD"]);
  if (head.code !== 0) {
    console.error(`cannot read the base commit: ${head.stderr.trim()}`);
    return 1;
  }
  for (const [key, value] of [
    ["user.name", BOT_IDENTITY.name],
    ["user.email", BOT_IDENTITY.email],
  ] as const) {
    const configured = run(["git", "-C", root, "config", "--local", key, value]);
    if (configured.code !== 0) {
      console.error(`cannot set ${key}: ${configured.stderr.trim()}`);
      return 1;
    }
  }
  const workspace = await readWorkspace(root);
  if (workspace.failures.length > 0) {
    for (const failure of workspace.failures) console.error(failure);
    return 1;
  }
  const counts: Record<Outcome, number> = { opened: 0, "already-open": 0, refused: 0, failed: 0 };
  for (const proposal of proposals) {
    // The registry is asked last: a refused proposal's name never reaches a request.
    const problem =
      proposalProblem(proposal, root, bundle, workspace) ??
      registryProblem(
        proposal,
        await read(proposal.name).then(
          (answer) => parsePackument(answer, proposal.name),
          () => null,
        ),
        now,
      );
    const result: ProposalResult =
      problem === null
        ? openProposal(
            proposal,
            { root, bundle, repository, base, baseSha: head.stdout.trim() },
            run,
          )
        : { outcome: "refused", detail: problem };
    counts[result.outcome] += 1;
    console.log(`${result.outcome}: ${proposal.name}@${proposal.to}: ${result.detail}`);
  }
  console.log(
    `proposals: total=${proposals.length} opened=${counts.opened} already-open=${counts["already-open"]} refused=${counts.refused} failed=${counts.failed}`,
  );
  return counts.refused > 0 || counts.failed > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
