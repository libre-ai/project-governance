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
import { isInForce, parseHeader } from "../quality/check-adr-supersession";
import {
  branchName,
  bumpKind,
  editManifest,
  isExactVersion,
  isSafePackageName,
  type Proposal,
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

export function isAuthorized(adrText: string): boolean {
  const header = parseHeader(AUTHORIZING_ADR, adrText);
  return header !== null && isInForce(header);
}

/** Why a bundled proposal must not be written, or null when it may be. */
export function proposalProblem(proposal: Proposal, root: string, bundle: string): string | null {
  const { name, from, to, branch, manifests, directory } = proposal;
  if (!isSafePackageName(name)) return `unsafe package name ${JSON.stringify(name)}`;
  if (!isExactVersion(from) || !isExactVersion(to)) return "a version is not exact";
  const kind = bumpKind(from, to);
  if (kind === "major") return `${from} to ${to} is a major: listed, never proposed`;
  if (kind !== proposal.kind) return `declared ${proposal.kind}, measured ${kind}`;
  if (branch !== branchName(name, to)) return `unexpected branch ${JSON.stringify(branch)}`;
  if (
    !Number.isSafeInteger(proposal.ageSeconds) ||
    proposal.ageSeconds < MINIMUM_RELEASE_AGE_SECONDS
  ) {
    return `published ${proposal.ageSeconds} seconds ago, below ${MINIMUM_RELEASE_AGE_SECONDS}`;
  }
  if (!/^\d+$/.test(directory)) return `unexpected bundle directory ${JSON.stringify(directory)}`;
  if (manifests.length === 0) return "no manifest is named";
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
    const edited = editManifest(readFileSync(join(root, manifest), "utf8"), name, from, to);
    if (edited === null || edited !== readFileSync(join(source, manifest), "utf8")) {
      return `${manifest} differs from the one-line bump of ${name}`;
    }
  }
  if (!readFileSync(join(source, "bun.lock"), "utf8").includes(`"${name}@${to}"`)) {
    return `bun.lock does not resolve ${name}@${to}`;
  }
  return null;
}

export function pullRequestTitle(proposal: Proposal): string {
  return `chore(deps): bump ${proposal.name} from ${proposal.from} to ${proposal.to}`;
}

/** The declaration block opens the description: the Door gate reads only those lines. */
export function pullRequestBody(proposal: Proposal): string {
  return [
    "Door: two-way",
    "Origin: inspection",
    "",
    "## Summary",
    "",
    `Moves \`${proposal.name}\` from \`${proposal.from}\` to \`${proposal.to}\` (${proposal.kind}), published ${proposal.publishedAt}. \`bun.lock\` is regenerated with lifecycle scripts disabled.`,
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

export type CommandRunner = (
  command: readonly string[],
  options?: { readonly stdin?: string },
) => CommandResult;

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

  const remote = run([
    "git",
    "-C",
    root,
    ...CREDENTIAL_HELPER,
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ]);
  if (remote.code !== 0) return failed("ls-remote", remote);
  if (remote.stdout.trim() !== "") {
    const open = run([
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
    ]);
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
    const push = run([
      "git",
      "-C",
      root,
      ...CREDENTIAL_HELPER,
      "push",
      "--quiet",
      "origin",
      `HEAD:refs/heads/${branch}`,
    ]);
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
      { stdin: pullRequestBody(proposal) },
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

function spawnCommand(
  command: readonly string[],
  options?: { readonly stdin?: string },
): CommandResult {
  const result = Bun.spawnSync([...command], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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

export function main(argv: readonly string[], run: CommandRunner = spawnCommand): number {
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
  const counts: Record<Outcome, number> = { opened: 0, "already-open": 0, refused: 0, failed: 0 };
  for (const proposal of proposals) {
    const problem = proposalProblem(proposal, root, bundle);
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
  process.exit(main(process.argv.slice(2)));
}
