import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The review-evidence gate run as a process, against a real `git diff`.
 *
 * WHY A PROCESS. The defect closed on 2026-10-23 lived between the two halves:
 * the effectful half handed the whole diff text to the pure scan, so a marker
 * on a context line or on a removed line counted as evidence. On #131 the gate
 * went green on four `Owner-arbitration:` markers of D91-D93 that an earlier
 * pull request had written, shown only as context around the added D94 row.
 * Unit tests over a hand-written diff cannot show that the diff git actually
 * prints is read the same way; these probes run the gate on one.
 *
 * WHY A FIXTURE REMOTE. The gate fetches `origin <base>`, so it needs an
 * `origin`: a throwaway repository over `file://`, no network. The base branch
 * is deliberately not a default-branch name.
 *
 * WHY A SCRUBBED ENVIRONMENT. On a pull-request run of this repository's own
 * CI, `GITHUB_EVENT_NAME`, `GITHUB_BASE_REF` and `GITHUB_EVENT_PATH` are set. A
 * probe inheriting them would measure the ambient run, so each child gets
 * only what it declares, and no global git config can change the diff format.
 */

const GATE = join(import.meta.dir, "check-review-evidence.ts");
const BASE_BRANCH = "probe/served";
const REGISTER = "docs/decisions/DECISION-REGISTER.md";

const BASE_REGISTER = [
  "# Decision register",
  "",
  "| ID | Decision | Source |",
  "| --- | --- | --- |",
  "| D90 | An earlier decision | ADR-0050 |",
  "| D91 | Amendment pull requests carry `Owner-arbitration: 2026-10-22` | ADR-0052 |",
  "| D92 | A second decision, Owner-arbitration: 2026-10-22 | ADR-0052 |",
  "| D93 | A third decision, Owner-arbitration: 2026-10-22 | ADR-0052 |",
  "",
  "Changes to this register require an ADR and explicit human approval.",
  "",
].join("\n");

/** An accepted ADR whose arbitration marker an earlier pull request wrote. */
const ADR = "docs/adr/0042-example.md";
const BASE_ADR = [
  "# ADR-0042 Example",
  "",
  "Accepted. Owner-arbitration: 2026-09-01",
  "",
  "A decision with enough body for rename detection to pair the two paths.",
  "",
].join("\n");

interface Run {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Review Evidence Probe",
  GIT_AUTHOR_EMAIL: "probe@invalid",
  GIT_COMMITTER_NAME: "Review Evidence Probe",
  GIT_COMMITTER_EMAIL: "probe@invalid",
};

function git(cwd: string, argv: readonly string[]): Run {
  const result = Bun.spawnSync(["git", ...argv], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_ENV,
  });
  const run = {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
  if (run.exitCode !== 0) {
    throw new Error(`fixture setup failed: git ${argv.join(" ")} — ${run.stderr.trim()}`);
  }
  return run;
}

let workspace: string;
let upstream: string;
let clone: string;

/** A pull-request branch off the base whose only change is the register rewritten by `edit`. */
function pullRequestBranch(name: string, edit: (register: string) => string): void {
  git(clone, ["switch", "--quiet", "-c", name, `origin/${BASE_BRANCH}`]);
  const path = join(clone, REGISTER);
  writeFileSync(path, edit(readFileSync(path, "utf8")));
  git(clone, ["commit", "--quiet", "--no-gpg-sign", "-am", name]);
}

/** A pull-request branch off the base whose change is whatever `change` does to the clone. */
function branchWith(name: string, change: () => void): void {
  git(clone, ["switch", "--quiet", "-c", name, `origin/${BASE_BRANCH}`]);
  change();
  git(clone, ["add", "-A"]);
  git(clone, ["commit", "--quiet", "--no-gpg-sign", "-m", name]);
}

/** The register without the D91 row: a pull request that removes a marker. */
function withoutD91(register: string): string {
  return register.replace(
    "| D91 | Amendment pull requests carry `Owner-arbitration: 2026-10-22` | ADR-0052 |\n",
    "",
  );
}

/** A throwaway executable in the fixture workspace: test-authored, never read from a change. */
function script(name: string, body: string): string {
  const path = join(workspace, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

/** Set repository config for one probe, and unset it whatever the probe's outcome. */
function withConfig(entries: Readonly<Record<string, string>>, probe: () => void): void {
  for (const [key, value] of Object.entries(entries)) git(clone, ["config", key, value]);
  try {
    probe();
  } finally {
    for (const key of Object.keys(entries)) git(clone, ["config", "--unset", key]);
  }
}

/** Run the gate on the checked-out branch as a pull_request against the fixture base. */
function runGate(body: string): Run {
  const eventPath = join(workspace, "event.json");
  writeFileSync(eventPath, JSON.stringify({ pull_request: { body } }));
  const result = Bun.spawnSync(["bun", GATE], {
    cwd: clone,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_BASE_REF: BASE_BRANCH,
      GITHUB_EVENT_PATH: eventPath,
    },
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "review-evidence-probe-"));
  upstream = join(workspace, "upstream");
  clone = join(workspace, "clone");

  git(workspace, ["init", "--quiet", "-b", BASE_BRANCH, upstream]);
  mkdirSync(join(upstream, "docs/decisions"), { recursive: true });
  writeFileSync(join(upstream, REGISTER), BASE_REGISTER);
  mkdirSync(join(upstream, "docs/adr"), { recursive: true });
  writeFileSync(join(upstream, ADR), BASE_ADR);
  git(upstream, ["add", REGISTER, ADR]);
  git(upstream, ["commit", "--quiet", "--no-gpg-sign", "-m", "fixture base"]);
  git(workspace, ["clone", "--quiet", `file://${upstream}`, clone]);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("only the lines a pull request adds are evidence", () => {
  test("the #131 case: markers present only as context around the added row fail", () => {
    pullRequestBranch("probe/context-only", (register) =>
      register.replace(
        "| D93 | A third decision, Owner-arbitration: 2026-10-22 | ADR-0052 |\n",
        "| D93 | A third decision, Owner-arbitration: 2026-10-22 | ADR-0052 |\n| D94 | Five method rules | ADR-0055 |\n",
      ),
    );
    const run = runGate("docs(adr): ADR-0055 method rules");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `Review evidence: ${REGISTER}: neither the pull request description nor a line the pull request adds`,
    );
    expect(run.stderr).toContain("1 added line(s) examined in the diff of the gated files");
    expect(run.stderr).toContain("0 candidate signal(s) examined");
  });

  test("a pull request that REMOVES a marker fails", () => {
    pullRequestBranch("probe/marker-removed", (register) =>
      register.replace(
        "| D91 | Amendment pull requests carry `Owner-arbitration: 2026-10-22` | ADR-0052 |\n",
        "",
      ),
    );
    const run = runGate("");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("0 added line(s) examined in the diff of the gated files");
    expect(run.stderr).toContain("1 removed");
  });

  test("a pull request that ADDS a marker passes, and says how much it examined", () => {
    pullRequestBranch("probe/marker-added", (register) =>
      register.replace(
        "| D93 | A third decision, Owner-arbitration: 2026-10-22 | ADR-0052 |\n",
        "| D93 | A third decision, Owner-arbitration: 2026-10-22 | ADR-0052 |\n| D94 | Five method rules, Owner-arbitration: 2026-10-23 | ADR-0055 |\n",
      ),
    );
    const run = runGate("");
    expect(run.stderr).toBe("");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(
      "Review evidence verified: 1 assertion(s) hold — 1 added line(s) examined in the diff of the gated files",
    );
    expect(run.stdout).toContain("1 candidate signal(s): 1 admissible, 0 rejected");
  });

  // The parser reads git's own format. A repository config that forces colour
  // prefixes every line with an escape sequence, so an added line no longer
  // starts with `+` and the real marker would be missed: the gate pins the
  // format on its command line instead of trusting the ambient config.
  test("a repository config forcing colour and no prefixes does not change what is read", () => {
    pullRequestBranch("probe/hostile-config", (register) =>
      register.replace(
        "| D93 | A third decision, Owner-arbitration: 2026-10-22 | ADR-0052 |\n",
        "| D93 | A third decision, Owner-arbitration: 2026-10-22 | ADR-0052 |\n| D94 | Five method rules, Owner-arbitration: 2026-10-23 | ADR-0055 |\n",
      ),
    );
    git(clone, ["config", "color.diff", "always"]);
    git(clone, ["config", "diff.noprefix", "true"]);
    try {
      const run = runGate("");
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain(
        "1 added line(s) examined in the diff of the gated files (5 context, 0 removed and 5 header line(s) are not evidence); 1 candidate signal(s): 1 admissible, 0 rejected",
      );
    } finally {
      git(clone, ["config", "--unset", "color.diff"]);
      git(clone, ["config", "--unset", "diff.noprefix"]);
    }
  });
});

// Each probe below is a bypass that reproduced against the gate before its
// flag existed; each flag is held by exactly one probe.
describe("the diff the gate reads is git's own, over every gated path", () => {
  test("a head with no merge base exits 1 instead of reading as an empty change", () => {
    git(clone, ["switch", "--quiet", "--orphan", "probe/orphan"]);
    mkdirSync(join(clone, "docs/decisions"), { recursive: true });
    writeFileSync(join(clone, REGISTER), "| D99 | unrelated history |\n");
    git(clone, ["add", "-A"]);
    git(clone, ["commit", "--quiet", "--no-gpg-sign", "-m", "orphan"]);
    const run = runGate("Owner-arbitration: 2026-10-23");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(
      `check-review-evidence: could not list the paths changed in origin/${BASE_BRANCH}...HEAD`,
    );
    expect(run.stdout).toBe("");
  });

  test("an external diff driver cannot print a marker the change never wrote", () => {
    pullRequestBranch("probe/external-driver", withoutD91);
    const driver = script(
      "fake-external-diff.sh",
      // git passes: path old-file old-hex old-mode new-file new-hex new-mode
      `printf 'diff --git a/%s b/%s\\n--- a/%s\\n+++ b/%s\\n@@ -1 +1 @@\\n+Owner-arbitration: 2026-10-23\\n' "$1" "$1" "$1" "$1"`,
    );
    withConfig({ "diff.external": driver }, () => {
      const run = runGate("");
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("0 candidate signal(s) examined");
    });
  });

  test("a textconv filter cannot print a marker the change never wrote", () => {
    pullRequestBranch("probe/textconv", withoutD91);
    const filter = script(
      "fake-textconv.sh",
      // Appends a marker to the side that lost D91, i.e. the head.
      `cat "$1"; grep -q 'D91' "$1" || echo 'Owner-arbitration: 2026-10-23'`,
    );
    const attributes = join(clone, ".git/info/attributes");
    writeFileSync(attributes, "*.md diff=probe\n");
    try {
      withConfig({ "diff.probe.textconv": filter }, () => {
        const run = runGate("");
        expect(run.exitCode).toBe(1);
        expect(run.stderr).toContain("0 candidate signal(s) examined");
      });
    } finally {
      writeFileSync(attributes, "");
    }
  });

  test("an ADR moved out of docs/adr is a gated change, not a change that touches none", () => {
    branchWith("probe/rename-out", () => {
      mkdirSync(join(clone, "docs/archive"), { recursive: true });
      git(clone, ["mv", ADR, "docs/archive/0042-example.md"]);
    });
    const run = runGate("");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`Review evidence: ${ADR}: neither the pull request description`);
  });

  test("an ADR renamed inside docs/adr does not re-add the marker an earlier pull request wrote", () => {
    branchWith("probe/rename-inside", () => {
      git(clone, ["mv", ADR, "docs/adr/0042-renamed.md"]);
    });
    // `diff.renames=false` is what `--find-renames` overrides: without it the
    // whole moved body, its old marker included, prints as added lines.
    withConfig({ "diff.renames": "false" }, () => {
      const run = runGate("");
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("0 added line(s) examined");
    });
  });

  test("a gated file with a non-ASCII name is gated", () => {
    const name = "docs/adr/0043-naïve.md";
    branchWith("probe/non-ascii", () => {
      writeFileSync(join(clone, name), "# ADR-0043\n\nNo arbitration here.\n");
    });
    const run = runGate("");
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain(`Review evidence: ${name}: neither the pull request description`);
  });
});
