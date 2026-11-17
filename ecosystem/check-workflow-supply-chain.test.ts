import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import type { RegistryEntry } from "./check-context-conformance";
import {
  collectRunScripts,
  emptyTally,
  parseRemoteExecutionForms,
  RULE_CODES,
  type RuleCode,
  reviewDefinition,
  reviewInventory,
  reviewRepository,
  summarizeVolume,
} from "./check-workflow-supply-chain";
import type { BlobRead, FleetFileReader, TreeListing } from "./fleet-tree";

const WORKFLOWS = new URL("../.github/workflows/", import.meta.url);
const read = (relative: string): Promise<string> =>
  Bun.file(new URL(relative, import.meta.url)).text();

const formsText = await read("./remote-execution-forms.v1.yaml");
const forms = parseRemoteExecutionForms(formsText);
const prDoor = await read("../.github/workflows/pr-door.yml");
const dependencyPolicy = await read("../.github/workflows/reusable-dependency-policy.yml");

const URL_ = "https://exemple.invalid/i.sh";
const INDENT = "          ";
const CURL = `${INDENT}curl --fail --location --retry 3 --output "$RUNNER_TEMP/bun.zip" "$BUN_ARCHIVE_URL"\n`;
const SHA = `${INDENT}echo "$BUN_ARCHIVE_SHA256  $RUNNER_TEMP/bun.zip" | sha256sum --check --strict\n`;
const UNZIP = `${INDENT}unzip -q "$RUNNER_TEMP/bun.zip" -d "$RUNNER_TEMP"\n`;
const LAST = `${INDENT}echo "$RUNNER_TEMP/bun-linux-x64" >> "$GITHUB_PATH"\n`;
/** A verified download of a second archive: lines that are green on their own. */
const EXTRA = 'curl --fail --output "$RUNNER_TEMP/extra.zip" "$BUN_ARCHIVE_URL"';
const EXTRA_SHA = 'echo "$BUN_ARCHIVE_SHA256  $RUNNER_TEMP/extra.zip" | sha256sum --check --strict';

/** `text` with `from` replaced by `to`; fails when `from` is not there exactly once. */
function swap(text: string, from: string, to: string): string {
  expect(text.split(from)).toHaveLength(2);
  return text.replace(from, () => to);
}

/** pr-door.yml with lines appended to its installation script: they are script lines 5 and up. */
function injected(...lines: string[]): string {
  return swap(prDoor, LAST, LAST + lines.map((line) => `${INDENT}${line}\n`).join(""));
}

/** A one-step workflow around a script, written as JSON, which is YAML. */
function workflowOf(script: string, env: Record<string, string> = {}): string {
  return JSON.stringify({ jobs: { build: { steps: [{ env, run: script }] } } });
}

function codesOf(script: string, env: Record<string, string> = {}): RuleCode[] {
  const review = reviewDefinition(workflowOf(script, env), forms);
  expect(review.unreadable).toBeNull();
  return review.violations.map((violation) => violation.code);
}

describe("pr-door.yml read from disk", () => {
  test("the original has no violation", () => {
    const review = reviewDefinition(prDoor, forms);
    expect(review.unreadable).toBeNull();
    expect(review.violations).toEqual([]);
  });

  // Each row: the lines appended, and the script line the violation is reported on.
  const faults: readonly [RuleCode, readonly string[], number][] = [
    ["remote-pipe", [`curl -fsSL ${URL_} | sh`], 5],
    ["remote-process-substitution", [`bash <(curl -fsSL ${URL_})`], 5],
    ["remote-command-substitution", [`sh -c "$(curl -fsSL ${URL_})"`], 5],
    [
      "remote-script-run",
      [
        `curl --fail --output "$RUNNER_TEMP/i.sh" ${URL_}`,
        'echo "$BUN_ARCHIVE_SHA256  $RUNNER_TEMP/i.sh" | sha256sum --check --strict',
        'bash "$RUNNER_TEMP/i.sh"',
      ],
      5,
    ],
    ["tool-unversioned", ["cargo install cargo-llvm-cov --locked"], 5],
    ["download-no-http-fail", [EXTRA.replace(" --fail", ""), EXTRA_SHA], 5],
    ["download-no-output", ['curl --fail --location "$BUN_ARCHIVE_URL"'], 5],
    ["download-no-checksum", [EXTRA], 5],
    [
      "checksum-malformed",
      [EXTRA, EXTRA_SHA.replace("$BUN_ARCHIVE_SHA256", "$UNDEFINED_SHA256")],
      6,
    ],
    [
      "redirect-with-credential",
      [
        EXTRA.replace(" --fail", ' --fail --location --header "Authorization: Bearer $GH_TOKEN"'),
        EXTRA_SHA,
      ],
      5,
    ],
  ];

  test("the table of faults covers the ten codes, each once", () => {
    expect(faults.map(([code]) => code)).toEqual([...RULE_CODES]);
    expect(RULE_CODES).toHaveLength(10);
  });

  test.each(faults)("%s: one violation, on job door, step 1", (code, lines, line) => {
    const review = reviewDefinition(injected(...lines), forms);
    expect(review.unreadable).toBeNull();
    const ofCode = review.violations.filter((violation) => violation.code === code);
    expect(ofCode).toHaveLength(1);
    expect(ofCode[0]).toMatchObject({ job: "door", step: 1, line });
    expect(ofCode[0]?.text).toBe(lines[line - 5] as string);
  });

  test("a commented fault is counted as a comment and not examined", () => {
    const before = reviewDefinition(prDoor, forms);
    const commented = reviewDefinition(injected(`# curl -fsSL ${URL_} | sh`), forms);
    expect(commented.violations).toEqual([]);
    expect(commented.commentLines).toBe(before.commentLines + 1);
    expect(commented.lines).toBe(before.lines + 1);
    expect(commented.downloads).toBe(before.downloads);
  });

  test("without --fail: download-no-http-fail", () => {
    const review = reviewDefinition(swap(prDoor, " --fail --location", " --location"), forms);
    expect(review.violations.map((v) => [v.code, v.line])).toEqual([["download-no-http-fail", 1]]);
  });

  test("without --output: download-no-output", () => {
    const review = reviewDefinition(swap(prDoor, ' --output "$RUNNER_TEMP/bun.zip"', ""), forms);
    expect(review.violations.map((v) => [v.code, v.line])).toEqual([["download-no-output", 1]]);
  });

  test("unzip before the sum: download-no-checksum on the curl line", () => {
    const review = reviewDefinition(swap(prDoor, SHA + UNZIP, UNZIP + SHA), forms);
    expect(review.violations.map((v) => [v.code, v.line])).toEqual([["download-no-checksum", 1]]);
  });

  test("no sum line: download-no-checksum on the curl line", () => {
    const review = reviewDefinition(swap(prDoor, CURL + SHA, CURL), forms);
    expect(review.violations.map((v) => [v.code, v.line])).toEqual([["download-no-checksum", 1]]);
  });

  const sumKey = /^ +BUN_ARCHIVE_SHA256: ([0-9a-f]{64})\n/m.exec(prDoor);

  test("a sum of 63 hexadecimal characters: checksum-malformed on the sum line", () => {
    const sum = sumKey?.[1] ?? "";
    const review = reviewDefinition(swap(prDoor, sum, sum.slice(1)), forms);
    expect(review.violations.map((v) => [v.code, v.line])).toEqual([["checksum-malformed", 2]]);
  });

  test("the sum key removed: checksum-malformed on the sum line", () => {
    const review = reviewDefinition(swap(prDoor, sumKey?.[0] ?? "", ""), forms);
    expect(review.violations.map((v) => [v.code, v.line])).toEqual([["checksum-malformed", 2]]);
  });

  test("an Authorization header without --location is not redirect-with-credential", () => {
    const header = ' --header "Authorization: Bearer $GH_TOKEN"';
    const follows = injected(EXTRA.replace(" --fail", ` --fail --location${header}`), EXTRA_SHA);
    const stays = injected(EXTRA.replace(" --fail", ` --fail${header}`), EXTRA_SHA);
    expect(reviewDefinition(follows, forms).violations.map((v) => v.code)).toEqual([
      "redirect-with-credential",
    ]);
    expect(reviewDefinition(stays, forms).violations).toEqual([]);
  });
});

describe("reusable-dependency-policy.yml read from disk", () => {
  test("the second archive left unverified: one download-no-checksum, on the second curl", () => {
    const check = `${INDENT}echo "$CARGO_AUDIT_ARCHIVE_SHA256  $RUNNER_TEMP/cargo-audit.tgz" | sha256sum --check --strict\n`;
    const review = reviewDefinition(swap(dependencyPolicy, check, ""), forms);
    expect(review.violations).toEqual([
      {
        code: "download-no-checksum",
        job: "dependency-policy",
        step: 2,
        line: 6,
        text: 'curl --fail --location --retry 3 --output "$RUNNER_TEMP/cargo-audit.tgz" "$CARGO_AUDIT_ARCHIVE_URL"',
      },
    ]);
  });
});

describe("the table of forms", () => {
  const formCodes = RULE_CODES.slice(0, 4);
  const cases = forms.flatMap((form) => [
    ...form.red.map((script) => [form.code, "red", script] as const),
    ...form.green.map((script) => [form.code, "green", script] as const),
  ]);

  test("holds the four forms, each with a red and a green example", () => {
    expect(forms.map((form) => form.code)).toEqual([...formCodes]);
    for (const form of forms) {
      expect(form.red.length).toBeGreaterThan(0);
      expect(form.green.length).toBeGreaterThan(0);
    }
  });

  test.each(cases)("%s %s: %s", (code, colour, script) => {
    const found = codesOf(script).filter((found) => formCodes.includes(found));
    if (colour === "red") expect(found).toContain(code);
    else expect(found).toEqual([]);
  });

  const valid = {
    schema_version: "libre-ai.remote-execution-forms.v1",
    interpreters: ["sh"],
    forms: formCodes.map((code) => ({
      code,
      description: "a form",
      pattern: "curl.*\\|\\s*{{interpreter}}",
      red: ["curl x | sh"],
      green: ["true"],
    })),
  };
  const first = valid.forms[0];
  const withFirst = (change: object): string =>
    JSON.stringify({ ...valid, forms: [{ ...first, ...change }, ...valid.forms.slice(1)] });

  test("a valid table parses, and its token becomes the interpreters", () => {
    const parsed = parseRemoteExecutionForms(JSON.stringify(valid));
    expect(parsed).toHaveLength(4);
    expect(parsed[0]?.pattern.source).toBe("curl.*\\|\\s*(?:sh)");
  });

  test.each([
    ["an empty table", JSON.stringify({ ...valid, forms: [] }), "empty table: no form"],
    [
      "a duplicate code",
      JSON.stringify({ ...valid, forms: [...valid.forms, first] }),
      "forms[4]: duplicate code remote-pipe",
    ],
    ["a pattern that does not compile", withFirst({ pattern: "(" }), "pattern does not compile"],
    ["a form without a red example", withFirst({ red: [] }), "forms[0].red: no example"],
    [
      "a form without a green example",
      withFirst({ green: undefined }),
      "forms[0].green: no example",
    ],
    ["an unknown code", withFirst({ code: "tool-unversioned" }), "forms[0]: unknown code"],
    [
      "a missing form",
      JSON.stringify({ ...valid, forms: valid.forms.slice(1) }),
      "missing form remote-pipe",
    ],
    [
      "an interpreter that is not a name",
      JSON.stringify({ ...valid, interpreters: ["sh|.*"] }),
      "interpreters[0]",
    ],
    ["text that is not YAML", "forms: [\n", "YAML parse failed"],
  ])("%s is refused with its reason", (_name, text, reason) => {
    expect(() => parseRemoteExecutionForms(text)).toThrow(reason);
  });
});

describe("tool-unversioned", () => {
  test("the cargo install of validate-composition.yml carries its version", async () => {
    const text = await read("../.github/workflows/validate-composition.yml");
    const line = "cargo install cargo-llvm-cov --version 0.8.7 --locked";
    expect(text).toContain(`run: ${line}\n`);
    expect(reviewDefinition(text, forms).violations).toEqual([]);
    expect(codesOf(line)).toEqual([]);
    expect(codesOf("cargo install cargo-llvm-cov --locked")).toEqual(["tool-unversioned"]);
  });

  test.each([
    ["cargo install cargo-llvm-cov@0.8.7 --locked", {}],
    ["cargo install --path crates/tool --locked", {}],
    [
      'cargo install cargo-deny --version "$CARGO_DENY_VERSION" --locked',
      { CARGO_DENY_VERSION: "0.19.5" },
    ],
    ["echo 'the notes mention cargo install without running it'", {}],
  ])("green: %s", (script, env) => {
    expect(codesOf(script, env)).toEqual([]);
  });

  test.each([
    ["cargo install cargo-llvm-cov --version 0.8 --locked"],
    ['cargo install cargo-deny --version "$CARGO_DENY_VERSION" --locked'],
    ["cargo binstall cargo-llvm-cov@0.8.7"],
    ["bun add --global prettier@latest"],
    ["pipx install reuse --version latest"],
  ])("red: %s", (script) => {
    expect(codesOf(script)).toEqual(["tool-unversioned"]);
  });

  test("red: a /releases/latest/ URL segment", () => {
    const sum = "a".repeat(64);
    const script = [
      'curl --fail --output "$RUNNER_TEMP/t.tgz" https://exemple.invalid/o/r/releases/latest/download/t.tgz',
      `echo "${sum}  $RUNNER_TEMP/t.tgz" | sha256sum --check`,
    ].join("\n");
    expect(codesOf(script)).toEqual(["tool-unversioned"]);
  });
});

describe("downloads", () => {
  const SUM = "0123456789abcdef".repeat(4);
  const env = { TOOL_SHA256: SUM };
  /** The braced spelling of the variable, and a workflow expression, as a script writes them. */
  const BRACED = ["$", "{TOOL_SHA256}"].join("");
  const EXPRESSION = ["$", "{{ inputs.sum }}"].join("");

  test.each([
    [
      'curl -fsSLo "$RUNNER_TEMP/t.tgz" "$TOOL_URL"\necho "$TOOL_SHA256  $RUNNER_TEMP/t.tgz" | sha256sum -c -',
    ],
    [
      'curl --fail-with-body --output t.tgz "$TOOL_URL"\necho "$TOOL_SHA256 *t.tgz" | shasum -a 256 -c',
    ],
    [`curl -f -o t.tgz "$TOOL_URL" && echo "${SUM}  t.tgz" | sha256sum --check && tar -xzf t.tgz`],
    [`wget -q -O t.tgz "$TOOL_URL"\nsha256sum --check --strict <<< "${BRACED}  t.tgz"`],
    ['wget -q https://exemple.invalid/dist/t.tgz\necho "$TOOL_SHA256  t.tgz" | sha256sum --check'],
    ["sudo apt-get install --yes curl wget"],
    ["curl --version"],
  ])("green: %s", (script) => {
    expect(codesOf(script, env)).toEqual([]);
  });

  test.each<[string, RuleCode[]]>([
    [
      'curl --fail-early --output t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz" | sha256sum -c',
      ["download-no-http-fail"],
    ],
    [
      'curl -sSL -o t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz" | sha256sum -c',
      ["download-no-http-fail"],
    ],
    ['curl --fail --silent "$TOOL_URL" | tar -xz', ["download-no-output"]],
    ['curl --fail --output - "$TOOL_URL"', ["download-no-output"]],
    ['wget -qO- "$TOOL_URL" | tar -xz', ["download-no-output"]],
    ['wget -q -O - "$TOOL_URL"', ["download-no-output"]],
    ['if ! curl --fail "$TOOL_URL"; then exit 1; fi', ["download-no-output"]],
    [
      'curl -f -o t.tgz "$TOOL_URL" && tar -xzf t.tgz\necho "$TOOL_SHA256  t.tgz" | sha256sum -c',
      ["download-no-checksum"],
    ],
    ['curl -fO "$TOOL_URL"', ["download-no-checksum"]],
    [
      'curl -fO "$TOOL_URL"\necho "$TOOL_SHA256  $TOOL_URL" | sha256sum -c',
      ["download-no-checksum"],
    ],
    [
      'curl -f -o t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz.sig" | sha256sum -c',
      ["download-no-checksum"],
    ],
    [
      'curl -f -o t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz" | sha256sum',
      ["download-no-checksum"],
    ],
    [
      'curl -f -o t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz" | shasum -a 1 -c',
      ["download-no-checksum"],
    ],
    [
      `curl -f -o t.tgz "$TOOL_URL"\necho "${SUM.toUpperCase()}  t.tgz" | sha256sum -c`,
      ["checksum-malformed"],
    ],
    ['curl -f -o t.tgz "$TOOL_URL"\nsha256sum -c t.tgz', ["checksum-malformed"]],
    [
      'curl -fL -u "$USER:$PASS" -o t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz" | sha256sum -c',
      ["redirect-with-credential"],
    ],
    [
      'curl -f --location-trusted --oauth2-bearer "$T" -o t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz" | sha256sum -c',
      ["redirect-with-credential"],
    ],
  ])("red: %s", (script, expected) => {
    expect(codesOf(script, env)).toEqual(expected);
  });

  test("a sum is resolved in the step, then the job, then the workflow env", () => {
    const steps = [
      { run: 'curl -f -o t.tgz "$TOOL_URL"\necho "$TOOL_SHA256  t.tgz" | sha256sum -c' },
    ];
    const at = (workflow: object, job: object, step: object): RuleCode[] =>
      reviewDefinition(
        JSON.stringify({
          env: workflow,
          jobs: { build: { env: job, steps: [{ ...steps[0], env: step }] } },
        }),
        forms,
      ).violations.map((violation) => violation.code);
    const good = { TOOL_SHA256: SUM };
    const bad = { TOOL_SHA256: "abc" };
    expect(at(good, {}, {})).toEqual([]);
    expect(at({}, good, {})).toEqual([]);
    expect(at({}, {}, good)).toEqual([]);
    expect(at(good, bad, {})).toEqual(["checksum-malformed"]);
    expect(at(bad, good, {})).toEqual([]);
    expect(at(good, good, bad)).toEqual(["checksum-malformed"]);
    // An expression is not a literal definition, and it hides the literal above it.
    expect(at(good, {}, { TOOL_SHA256: EXPRESSION })).toEqual(["checksum-malformed"]);
  });
});

describe("a command behind an execution prefix", () => {
  const FETCH = "curl -fsSL https://x.invalid/t.tgz -o t.tgz";
  const UNVERIFIED = (fetch: string): string => `${fetch}\ntar xzf t.tgz\n./t/tool`;

  test.each([
    [`timeout 60 ${FETCH}`],
    [`timeout --signal=KILL -k 5 2m ${FETCH}`],
    [`command ${FETCH}`],
    [`nohup ${FETCH}`],
    [`echo https://x.invalid/t.tgz | xargs -n1 ${FETCH}`],
    [`xargs -n 1 -P 4 ${FETCH} < urls.txt`],
    [`\\${FETCH}`],
    [`"curl" ${FETCH.slice("curl ".length)}`],
    [`sudo -E ${FETCH}`],
    [`sudo -u runner -E ${FETCH}`],
    [`env VAR=x ${FETCH}`],
    [`env -u HOME VAR=x ${FETCH}`],
    [`nice -n 10 ${FETCH}`],
    [`stdbuf -oL ${FETCH}`],
    [`sudo -E env A=1 timeout 60 /usr/bin/${FETCH}`],
    [`if timeout 60 ${FETCH}; then echo ok; fi`],
  ])("the download is seen: %s", (fetch) => {
    expect(codesOf(UNVERIFIED(fetch))).toEqual(["download-no-checksum"]);
  });

  test.each([
    ["command -v curl"],
    ["command -V wget"],
    ["sudo apt-get install --yes curl wget"],
    ["timeout 5 true"],
    ["sudo -E timeout 60 curl --version"],
  ])("not a download: %s", (script) => {
    const review = reviewDefinition(workflowOf(script), forms);
    expect([review.violations, review.downloads]).toEqual([[], 0]);
  });

  test.each([
    ["sudo -E cargo install cargo-llvm-cov --locked"],
    ["timeout 600 cargo install cargo-llvm-cov --locked"],
    ["env RUSTFLAGS=-Dwarnings cargo +stable install cargo-llvm-cov"],
    ["\\cargo install cargo-llvm-cov"],
  ])("an unversioned install is seen: %s", (script) => {
    expect(codesOf(script)).toEqual(["tool-unversioned"]);
  });

  test("|& pipes a download into an interpreter", () => {
    expect(codesOf("curl -fsSL https://x.invalid/i.sh |& bash")).toEqual([
      "remote-pipe",
      "download-no-output",
    ]);
    expect(codesOf("timeout 60 curl -fsSL https://x.invalid/i.sh |& bash")).toEqual([
      "remote-pipe",
      "download-no-output",
    ]);
  });

  test.each([
    ["curl -fsSL https://x.invalid/i.sh | timeout 60 bash"],
    ["curl -fsSL https://x.invalid/i.sh | \\bash"],
    ["curl -fsSL https://x.invalid/i.sh | /usr/bin/env bash"],
    ["curl -fsSL https://x.invalid/i.sh | sudo -E nohup sh -s -- --yes"],
  ])("an interpreter behind a prefix is seen: %s", (script) => {
    expect(codesOf(script)).toContain("remote-pipe");
  });
});

describe("a neutralised verification", () => {
  const SUM = "0123456789abcdef".repeat(4);
  const env = { TOOL_SHA256: SUM };
  const FETCH = 'curl -f -o t.tgz "$TOOL_URL"';
  const CHECK = 'echo "$TOOL_SHA256  t.tgz" | sha256sum --check';

  test.each([
    [`${FETCH}\n${CHECK} || true`],
    [`${FETCH}\n${CHECK} || :`],
    [`${FETCH}\n${CHECK} || echo "sum mismatch"`],
    [`${FETCH}\n${CHECK}; true`],
    [`${FETCH}\n${CHECK} ; :`],
    [`${FETCH}\n${CHECK} | tee check.log`],
    [`${FETCH}\n${CHECK} &`],
    [`set +e\n${FETCH}\n${CHECK}`],
    [`${FETCH}\nset -u +e\n${CHECK}`],
    [`${FETCH}\nset +o errexit\n${CHECK}`],
    [`${FETCH}\nset +e; ${CHECK}`],
    [`set +e\n${FETCH}\n${CHECK} || false`],
  ])("is no verification: %s", (script) => {
    expect(codesOf(script, env)).toEqual(["download-no-checksum"]);
  });

  test.each([
    [`${FETCH}\n${CHECK} || exit 1`],
    [`${FETCH}\n${CHECK} || { echo "sum mismatch" >&2; exit 1; }`],
    [`${FETCH}\n${CHECK} || false`],
    [`set +e\n${FETCH}\n${CHECK} || exit 1`],
    [`set +e\nset -e\n${FETCH}\n${CHECK}`],
    [`set +e\n${FETCH}\nset -euo pipefail\n${CHECK}`],
    [`${FETCH}\n${CHECK} && tar -xzf t.tgz`],
  ])("still verifies: %s", (script) => {
    expect(codesOf(script, env)).toEqual([]);
  });
});

describe("cargo install of several crates", () => {
  test.each([
    ["cargo install a@0.1.0 b"],
    ["cargo install a b@0.1.0"],
    ["cargo install --locked a@0.1.0 b --root /opt"],
    ["cargo install a@0.1.0 b@^1"],
  ])("red: %s", (script) => {
    expect(codesOf(script)).toEqual(["tool-unversioned"]);
  });

  test.each([
    ["cargo install a@0.1.0 b@0.2.0 --locked"],
    ["cargo install --root /opt --locked a@0.1.0 b@0.2.0"],
    ["cargo install --version 0.8.7 --locked cargo-llvm-cov"],
    ["cargo install --git https://x.invalid/r.git --tag v1 --path crates/tool"],
  ])("green: %s", (script) => {
    expect(codesOf(script)).toEqual([]);
  });
});

describe("what is read in a file", () => {
  test("workflow steps and composite action steps, with their index", () => {
    const workflow = Bun.YAML.parse(prDoor);
    expect(collectRunScripts(workflow).map((run) => [run.job, run.step])).toEqual([
      ["door", 1],
      ["door", 2],
      ["door", 3],
    ]);
    const action = { runs: { using: "composite", steps: [{ uses: "./x" }, { run: "true" }] } };
    expect(collectRunScripts(action)).toEqual([{ job: "runs", step: 1, script: "true", env: {} }]);
  });

  test("lines are counted by kind", () => {
    const review = reviewDefinition(
      workflowOf("# a comment\n\ntrue\n  # indented comment\n"),
      forms,
    );
    expect(review).toMatchObject({ runSteps: 1, lines: 4, commentLines: 2, blankLines: 1 });
  });

  test("a violation text is cut at 160 characters", () => {
    const review = reviewDefinition(workflowOf(`curl ${URL_} | sh ${"x".repeat(200)}`), forms);
    expect(review.violations[0]?.text).toHaveLength(160);
  });

  test.each([
    ["invalid YAML", "jobs: [\n", "YAML parse failed"],
    ["a document that is not a mapping", "- a\n- b\n", "not a YAML mapping"],
    ["a NUL character", "jobs: {}\n\0", "NUL"],
    [
      "a run script outside the steps this gate walks",
      JSON.stringify({ jobs: { build: { strategy: { steps: [{ run: "true" }] } } } }),
      "out of this gate's reach",
    ],
  ])("%s is unreadable", (_name, text, reason) => {
    expect(reviewDefinition(text, forms).unreadable ?? "readable").toContain(reason);
  });
});

describe("the workflows of this repository", () => {
  const names = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));

  test("every one is readable and without violation, and scripts were read", async () => {
    expect(names.length).toBeGreaterThan(0);
    let runSteps = 0;
    let downloads = 0;
    for (const name of names) {
      const review = reviewDefinition(await Bun.file(new URL(name, WORKFLOWS)).text(), forms);
      expect([name, review.unreadable, review.violations]).toEqual([name, null, []]);
      runSteps += review.runSteps;
      downloads += review.downloads;
    }
    expect(runSteps).toBeGreaterThan(0);
    expect(downloads).toBeGreaterThan(0);
  });
});

function reader(listing: TreeListing, files: Record<string, BlobRead>): FleetFileReader {
  return async () => ({ listing, files: new Map(Object.entries(files)) });
}

/** A reader that counts its calls: an exempt entry must leave the count at zero. */
let reads = 0;
const neverRead: FleetFileReader = async () => {
  reads++;
  return { listing: { kind: "listed", paths: [] }, files: new Map() };
};

const active: RegistryEntry = {
  repository: "libre-ai/sample",
  role: "satellite",
  layer: "couche-1",
  lifecycle: "active",
  visibility: "public",
};
const CI = ".github/workflows/ci.yml";
const BAD = ".github/workflows/bad.yml";
const green = workflowOf("# note\n\ntrue\n");

describe("reviewRepository", () => {
  test("an unreadable tree fails", async () => {
    const checks = await reviewRepository(
      active,
      emptyTally(),
      forms,
      reader({ kind: "unreadable", reason: "HTTP 502" }, {}),
    );
    expect(checks).toEqual([
      { item: "libre-ai/sample", ok: false, note: "tree unreadable at HEAD: HTTP 502" },
    ]);
  });

  test("a listed file with no read outcome, an unreadable blob and invalid YAML all fail", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      forms,
      reader(
        { kind: "listed", paths: [CI, BAD, "action.yml", "README.md"] },
        {
          [BAD]: { kind: "unreadable", reason: "truncated" },
          "action.yml": { kind: "text", text: "runs: [\n" },
        },
      ),
    );
    expect(checks.map((check) => [check.item, check.ok])).toEqual([
      [`libre-ai/sample:${CI}`, false],
      [`libre-ai/sample:${BAD}`, false],
      ["libre-ai/sample:action.yml", false],
    ]);
    expect(checks[0]?.note).toBe("unreadable at HEAD: no read outcome recorded");
    expect(tally).toMatchObject({ filesTracked: 3, filesExamined: 0, filesUnreadable: 3 });
  });

  test("a violation is rendered with its code, job, step, line and text", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      forms,
      reader(
        { kind: "listed", paths: [CI] },
        { [CI]: { kind: "text", text: injected("cargo binstall x") } },
      ),
    );
    expect(checks).toEqual([
      {
        item: `libre-ai/sample:${CI}`,
        ok: false,
        note: "[tool-unversioned] door[1]:5 cargo binstall x",
      },
    ]);
    expect(tally.violations).toBe(1);
  });

  test("private and archived entries are exempt and not read; the counters sum", async () => {
    const tally = emptyTally();
    const entries: RegistryEntry[] = [
      { ...active, repository: "libre-ai/private", visibility: "private" },
      { ...active, repository: "libre-ai/archived", lifecycle: "archived" },
    ];
    for (const entry of entries) {
      const checks = await reviewRepository(entry, tally, forms, neverRead);
      expect(checks).toHaveLength(1);
      expect(checks[0]).toMatchObject({ item: entry.repository, ok: true });
      expect(checks[0]?.note).toStartWith("exempt: ");
    }
    expect(reads).toBe(0);
    await reviewRepository(
      active,
      tally,
      forms,
      reader(
        { kind: "listed", paths: [CI, BAD] },
        { [CI]: { kind: "text", text: green }, [BAD]: { kind: "unreadable", reason: "truncated" } },
      ),
    );
    await reviewRepository(
      active,
      tally,
      forms,
      reader({ kind: "listed", paths: ["README.md"] }, {}),
    );
    expect(tally).toMatchObject({
      repositories: 2,
      exempt: 2,
      filesTracked: 2,
      filesExamined: 1,
      filesUnreadable: 1,
    });
    expect(tally.filesTracked).toBe(tally.filesExamined + tally.filesUnreadable);
    expect(summarizeVolume(tally)).toBe(
      "4 inventory entries (2 read, 2 exempt): 2 tracked workflow/action file(s) = 1 examined + 1 unreadable; 1 run step(s); 3 script line(s) = 1 examined + 1 comment + 1 blank; 0 download(s) examined; rules=10 violations=0",
    );
  });
});

describe("reviewInventory", () => {
  const listed = reader({ kind: "listed", paths: [CI] }, { [CI]: { kind: "text", text: green } });

  test("a file examined without violation passes, and the volume is printed", async () => {
    const report = await reviewInventory([active], forms, listed);
    expect(report.outcome).toBe("pass");
    expect(report.volumeSummary).toContain("rules=10 violations=0");
  });

  test("an inventory that has no file examined fails by name", async () => {
    const exempt = { ...active, visibility: "private" as const };
    const none = reader({ kind: "listed", paths: ["README.md"] }, {});
    for (const report of [
      await reviewInventory([exempt], forms, neverRead),
      await reviewInventory([active], forms, none),
      await reviewInventory([], forms, neverRead),
    ]) {
      expect(report.outcome).toBe("violations");
      expect(report.violations.at(-1)).toStartWith(
        "inventory: no workflow or action file was examined",
      );
    }
  });
});

describe("summarizeVolume", () => {
  test("prints the number of rules and of violations", () => {
    expect(summarizeVolume({ ...emptyTally(), violations: 3 })).toContain("rules=10 violations=3");
  });
});

describe("package.json", () => {
  test("the script exists and is not part of the check chain", async () => {
    const manifest = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["check:workflow-supply-chain"]).toBe(
      "bun run check:bun:runtime && bun ecosystem/check-workflow-supply-chain.ts",
    );
    expect(manifest.scripts.check).not.toContain("workflow-supply-chain");
  });
});
