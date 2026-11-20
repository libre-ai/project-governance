/**
 * Supply chain of the `run:` scripts across the fleet.
 *
 * `check-action-pins` holds what a workflow *calls* (`uses:`) to fixed content.
 * Nothing held what a workflow *types*: a script could pipe a download into a
 * shell, fetch without failing on an HTTP error, unpack an archive nobody
 * verified, or install whatever version a registry serves that day, and every
 * gate stayed green. This gate reads the same files as `check-action-pins`
 * (its selector `isActionDefinition`, the inventory
 * `ecosystem/repositories.v1.yaml`, the tree reader of `fleet-tree`) and
 * refuses ten defects in their scripts.
 *
 * WHAT IS READ. The `run` value of every step, taken from the parsed YAML
 * (`jobs.<id>.steps[]` of a workflow, `runs.steps[]` of a composite action,
 * reported under the job name `runs`) and split into lines. A blank line, or a
 * line whose first non-blank character is `#`, is counted and not examined.
 * YAML comments are not part of the value and are never read. A file whose YAML
 * does not parse, that carries a NUL, or that holds a `run` script anywhere the
 * walk above does not reach, is unreadable: a failure, never a skip.
 *
 * THE TEN RULES, in the order they are printed.
 *
 *   1-4  remote content reaching an interpreter (`remote-pipe`,
 *        `remote-process-substitution`, `remote-command-substitution`,
 *        `remote-script-run`). Their patterns and examples live in
 *        `ecosystem/remote-execution-forms.v1.yaml`, the only definition of
 *        these forms.
 *   5    `tool-unversioned` — `cargo install` without an exact `--version` or
 *        `crate@x.y.z` (a `--path` install excepted), any `cargo binstall`, an
 *        `@latest` token, `--version latest`, a `/releases/latest/` URL segment.
 *   6    `download-no-http-fail` — curl without `--fail`, `-f` or
 *        `--fail-with-body`. wget fails on an HTTP error by default.
 *   7    `download-no-output` — curl without an output file, or wget writing
 *        to standard output: the bytes go straight to whatever comes next.
 *   8    `download-no-checksum` — the first later use of the output file is
 *        not a sha256 verification of that file, or nothing uses it.
 *   9    `checksum-malformed` — the sum of that verification is not exactly 64
 *        lowercase hexadecimal characters, or is a variable with no literal
 *        definition in the `env` of the step, the job or the workflow.
 *   10   `redirect-with-credential` — curl follows redirects while carrying an
 *        `Authorization` header, `-u`/`--user` or `--oauth2-bearer`.
 *
 * Comparing a sum to the canonical toolchain policy stays the job of
 * `check-toolchain-source`; this gate holds its presence and its shape.
 *
 * A verification counts only while its exit status still fails the step. The
 * runner's shells start with errexit; a check whose status is discarded (a
 * later pipeline stage, `&`, `; true`, `|| true`, `|| :`, any `||` that does
 * not exit non-zero) or run after `set +e` without `|| exit N` is no check.
 *
 * DECLARED LIMITS. A script is read line by line: a command folded with a
 * trailing backslash is not joined. curl, wget and cargo are recognised as the
 * program a simple command runs (line start, after `|`, `;`, `&`, `(`, `{`,
 * `$(`, a backquote or a shell keyword), read through assignments, quotes, a
 * leading backslash, a path and the execution prefixes of `EXECUTION_PREFIXES`
 * (`sudo -E`, `env A=1`, `timeout 60`, `xargs -n1`, `nohup`, `command`, ...).
 * A wrapper function, a program named by a variable or a command inside a
 * quoted `-c` string hides them, and a package list naming `curl` is not a
 * download. errexit is taken as on when the script starts: a step `shell:`
 * without `-e` is not read, and a check that is the left side of `&&` or the
 * condition of an `if` still counts. The output file is compared as it is
 * written: `$DIR/x` and `${DIR}/x` are two names, and the second then counts
 * as unverified.
 */

import { GateReport } from "../tools/quality/gate-report";
import { isActionDefinition } from "./check-action-pins";
import { parseRegistry, type RegistryEntry } from "./check-context-conformance";
import { exemption, type FleetFileReader, readRepositoryFiles } from "./fleet-tree";

const FORMS_PATH = "ecosystem/remote-execution-forms.v1.yaml";
const FORMS_SCHEMA = "libre-ai.remote-execution-forms.v1";
const INTERPRETER_TOKEN = "{{interpreter}}";
const INTERPRETER_NAME = /^[a-z][a-z0-9]*$/;

const FORM_CODES = [
  "remote-pipe",
  "remote-process-substitution",
  "remote-command-substitution",
  "remote-script-run",
] as const;

/** The ten codes, in printing order; `rules=` is the length of this list. */
export const RULE_CODES = [
  ...FORM_CODES,
  "tool-unversioned",
  "download-no-http-fail",
  "download-no-output",
  "download-no-checksum",
  "checksum-malformed",
  "redirect-with-credential",
] as const;

export type RuleCode = (typeof RULE_CODES)[number];
type FormCode = (typeof FORM_CODES)[number];

export interface RemoteExecutionForm {
  readonly code: RuleCode;
  readonly description: string;
  readonly pattern: RegExp;
  readonly red: readonly string[];
  readonly green: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refuseTable(reason: string): never {
  throw new Error(`remote-execution-forms: ${reason}`);
}

function isFormCode(value: unknown): value is FormCode {
  return typeof value === "string" && (FORM_CODES as readonly string[]).includes(value);
}

function nonEmptyText(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    return refuseTable(`${where}: expected a non-empty string`);
  }
  return value;
}

function examples(value: unknown, where: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) return refuseTable(`${where}: no example`);
  return value.map((item, index) => nonEmptyText(item, `${where}[${index}]`));
}

/**
 * The table of forms, or a thrown error naming why it cannot be trusted. A
 * table that lost a form would leave `rules=10` printed over nine rules, so
 * each of the four codes must be present exactly once.
 */
export function parseRemoteExecutionForms(yamlText: string): readonly RemoteExecutionForm[] {
  let document: unknown;
  try {
    document = Bun.YAML.parse(yamlText);
  } catch (error) {
    return refuseTable(`YAML parse failed: ${(error as Error).message}`);
  }
  if (!isRecord(document)) return refuseTable("the table is not a mapping");
  if (document.schema_version !== FORMS_SCHEMA) {
    return refuseTable(`schema_version is not ${FORMS_SCHEMA}`);
  }
  const names = document.interpreters;
  if (!Array.isArray(names) || names.length === 0) return refuseTable("no interpreter listed");
  const interpreters = names.map((name, index) => {
    if (typeof name !== "string" || !INTERPRETER_NAME.test(name)) {
      return refuseTable(`interpreters[${index}]: not a name of lowercase letters and digits`);
    }
    return name;
  });
  const alternation = `(?:${interpreters.join("|")})`;
  const entries = document.forms;
  if (!Array.isArray(entries) || entries.length === 0) return refuseTable("empty table: no form");
  const forms: RemoteExecutionForm[] = [];
  const seen = new Set<FormCode>();
  for (const [index, entry] of entries.entries()) {
    const where = `forms[${index}]`;
    if (!isRecord(entry)) return refuseTable(`${where}: not a mapping`);
    const code = entry.code;
    if (!isFormCode(code)) return refuseTable(`${where}: unknown code ${JSON.stringify(code)}`);
    if (seen.has(code)) return refuseTable(`${where}: duplicate code ${code}`);
    seen.add(code);
    const source = nonEmptyText(entry.pattern, `${where}.pattern`);
    let pattern: RegExp;
    try {
      pattern = new RegExp(source.replaceAll(INTERPRETER_TOKEN, alternation), "gm");
    } catch (error) {
      return refuseTable(`${where}: pattern does not compile: ${(error as Error).message}`);
    }
    forms.push({
      code,
      description: nonEmptyText(entry.description, `${where}.description`),
      pattern,
      red: examples(entry.red, `${where}.red`),
      green: examples(entry.green, `${where}.green`),
    });
  }
  for (const code of FORM_CODES) {
    if (!seen.has(code)) return refuseTable(`missing form ${code}`);
  }
  return forms;
}

export interface RunScript {
  readonly job: string;
  readonly step: number;
  readonly script: string;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * `base` overlaid with the literal entries of an `env` mapping. An entry that
 * is not a literal string (an `${{ … }}` expression, a number YAML already
 * converted) removes the name: it shadows an outer literal without being one.
 */
function overlayEnv(base: Readonly<Record<string, string>>, node: unknown): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  if (!isRecord(node)) return merged;
  for (const [name, value] of Object.entries(node)) {
    if (typeof value === "string" && !value.includes("${{")) merged[name] = value;
    else delete merged[name];
  }
  return merged;
}

function stepScripts(
  job: string,
  steps: unknown,
  env: Readonly<Record<string, string>>,
): RunScript[] {
  if (!Array.isArray(steps)) return [];
  const scripts: RunScript[] = [];
  for (const [index, step] of steps.entries()) {
    if (!isRecord(step) || typeof step.run !== "string") continue;
    scripts.push({ job, step: index, script: step.run, env: overlayEnv(env, step.env) });
  }
  return scripts;
}

/** Every `run` script of a workflow or a composite action, with the `env` in force for it. */
export function collectRunScripts(document: unknown): RunScript[] {
  if (!isRecord(document)) return [];
  const scripts: RunScript[] = [];
  const workflowEnv = overlayEnv({}, document.env);
  if (isRecord(document.jobs)) {
    for (const [id, job] of Object.entries(document.jobs)) {
      if (!isRecord(job)) continue;
      scripts.push(...stepScripts(id, job.steps, overlayEnv(workflowEnv, job.env)));
    }
  }
  if (isRecord(document.runs)) scripts.push(...stepScripts("runs", document.runs.steps, {}));
  return scripts;
}

/** Every string held by a `run` key, at any depth: the control count of `collectRunScripts`. */
function countRunStrings(node: unknown): number {
  if (Array.isArray(node))
    return node.reduce((sum: number, item) => sum + countRunStrings(item), 0);
  if (!isRecord(node)) return 0;
  let count = 0;
  for (const [key, value] of Object.entries(node)) {
    count += key === "run" && typeof value === "string" ? 1 : countRunStrings(value);
  }
  return count;
}

export interface Violation {
  readonly code: RuleCode;
  readonly job: string;
  readonly step: number;
  readonly line: number;
  readonly text: string;
}

export interface DefinitionReview {
  readonly violations: readonly Violation[];
  readonly unreadable: string | null;
  readonly runSteps: number;
  readonly lines: number;
  readonly commentLines: number;
  readonly blankLines: number;
  readonly downloads: number;
}

interface ShellCommand {
  readonly words: readonly string[];
  /** Index of the first character after the command: its terminator, or the line length. */
  readonly end: number;
}

/**
 * The words of one simple command starting at `start`, quotes removed and their
 * content kept, up to the first unquoted `|`, `;`, `&`, backquote or unmatched
 * `)`. Enough of a shell reader to tell an option from its value and a quoted
 * `|` from a pipe; not a shell parser.
 */
function readCommand(line: string, start: number): ShellCommand {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: string | null = null;
  let depth = 0;
  let index = start;
  for (; index < line.length; index++) {
    const char = line.charAt(index);
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < line.length) {
        index++;
        word += line.charAt(index);
      } else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
      continue;
    }
    if (char === "\\" && index + 1 < line.length) {
      index++;
      word += line.charAt(index);
      inWord = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && "|;&`".includes(char)) break;
    word += char;
    inWord = true;
  }
  if (inWord) words.push(word);
  return { words, end: index };
}

/** Where a command may start on a line: line start, an operator, a group, a substitution. */
const COMMAND_START = /(?:^|[|;&(`{]|\$\()\s*/g;
const ASSIGNMENT = /^\w+=/;
/** Words that open a command without being one: the command is the word after them. */
const SHELL_KEYWORDS: ReadonlySet<string> = new Set([
  "!",
  "{",
  "if",
  "then",
  "elif",
  "else",
  "while",
  "until",
  "do",
]);

/**
 * A program that runs the command written after it: its options, the option
 * letters that take a value, and the positional words it reads before that
 * command. `stops` names the letters with which it runs nothing (`command -v`).
 */
interface ExecutionPrefix {
  readonly valued: string;
  readonly longValued: readonly string[];
  readonly positionals: number;
  readonly assignments: boolean;
  readonly stops: string;
}

function prefix(spec: Partial<ExecutionPrefix>): ExecutionPrefix {
  return { valued: "", longValued: [], positionals: 0, assignments: false, stops: "", ...spec };
}

const EXECUTION_PREFIXES: Readonly<Record<string, ExecutionPrefix>> = {
  builtin: prefix({}),
  chronic: prefix({}),
  command: prefix({ stops: "vV" }),
  doas: prefix({ valued: "uC" }),
  env: prefix({
    valued: "uCSP",
    longValued: ["--unset", "--chdir", "--split-string"],
    assignments: true,
  }),
  exec: prefix({ valued: "a" }),
  ionice: prefix({ valued: "cnp", longValued: ["--class", "--classdata", "--pid"] }),
  nice: prefix({ valued: "n", longValued: ["--adjustment"] }),
  nohup: prefix({}),
  setsid: prefix({}),
  stdbuf: prefix({ valued: "ioe", longValued: ["--input", "--output", "--error"] }),
  sudo: prefix({
    valued: "ugCDprtUT",
    longValued: ["--user", "--group", "--close-from", "--chdir", "--prompt", "--role", "--type"],
  }),
  time: prefix({ valued: "fo", longValued: ["--format", "--output"] }),
  timeout: prefix({ valued: "sk", longValued: ["--signal", "--kill-after"], positionals: 1 }),
  xargs: prefix({
    valued: "adEILnPs",
    longValued: [
      "--arg-file",
      "--delimiter",
      "--eof",
      "--max-lines",
      "--max-args",
      "--max-procs",
      "--max-chars",
    ],
  }),
};

/** Index of the word after `prefix`'s options and positionals, or -1 when it runs nothing. */
function skipPrefix(words: readonly string[], from: number, spec: ExecutionPrefix): number {
  let index = from;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") {
      index++;
      break;
    }
    if (word.startsWith("--")) {
      const takesNext = !word.includes("=") && spec.longValued.includes(word);
      index += takesNext ? 2 : 1;
      continue;
    }
    if (spec.assignments && ASSIGNMENT.test(word)) {
      index++;
      continue;
    }
    if (!word.startsWith("-") || word.length === 1) break;
    // `nice -10`: a niceness written as an option.
    let consumed = 1;
    if (!/^-\d+$/.test(word)) {
      for (let at = 1; at < word.length; at++) {
        const letter = word.charAt(at);
        if (spec.stops.includes(letter)) return -1;
        if (spec.valued.includes(letter)) {
          if (at === word.length - 1) consumed = 2;
          break;
        }
      }
    }
    index += consumed;
  }
  return index + spec.positionals;
}

interface SimpleCommand {
  /** The program run, its path removed: `curl` for `/usr/bin/curl`, `\curl` or `"curl"`. */
  readonly name: string;
  readonly args: readonly string[];
  /** Index on the line where the command, prefixes included, starts. */
  readonly start: number;
  /** Index of the first character after the command. */
  readonly end: number;
}

/**
 * Every simple command of a line, read through its leading assignments and
 * through the execution prefixes above (`sudo -E env A=1 timeout 60 curl …`
 * runs curl). A command those prefixes do not run (`command -v curl`) is left out.
 */
function simpleCommands(line: string): SimpleCommand[] {
  const commands: SimpleCommand[] = [];
  for (const match of line.matchAll(COMMAND_START)) {
    const start = (match.index ?? 0) + match[0].length;
    const { words, end } = readCommand(line, start);
    let index = 0;
    for (;;) {
      while (ASSIGNMENT.test(words[index] ?? "") || SHELL_KEYWORDS.has(words[index] ?? "")) {
        index++;
      }
      const word = words[index];
      if (word === undefined) break;
      const name = word.slice(word.lastIndexOf("/") + 1);
      const spec = EXECUTION_PREFIXES[name];
      if (spec === undefined) {
        commands.push({ name, args: words.slice(index + 1), start, end });
        break;
      }
      index = skipPrefix(words, index + 1, spec);
      if (index < 0) break;
    }
  }
  return commands;
}

const CARGO_BINSTALL = /(?<![\w.-])cargo\s+(?:\+\S+\s+)?binstall(?![\w-])/;
const MOVING_VERSION = /@latest(?![\w.-])|--version[ =]+["']?latest(?![\w.-])|\/releases\/latest\//;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VARIABLE = /^\$(?:(\w+)|\{(\w+)\})$/;

/** A literal, or the literal a `$NAME` / `${NAME}` token is given by the `env` in force. */
function resolve(token: string, env: Readonly<Record<string, string>>): string | null {
  const variable = VARIABLE.exec(token);
  if (variable === null) return token;
  const name = variable[1] ?? variable[2] ?? "";
  return Object.hasOwn(env, name) ? (env[name] ?? null) : null;
}

/** `cargo install` options that take a value: the next word is that value, not a crate. */
const CARGO_INSTALL_VALUED = new Set([
  "--version",
  "--vers",
  "--git",
  "--branch",
  "--tag",
  "--rev",
  "--path",
  "--root",
  "--index",
  "--registry",
  "--features",
  "-F",
  "--target",
  "--target-dir",
  "--profile",
  "--config",
  "--jobs",
  "-j",
  "-Z",
  "--color",
  "--message-format",
  "--bin",
  "--example",
]);

/**
 * Whether every crate a `cargo install` names is pinned: by `crate@x.y.z`, or,
 * for a crate written bare, by an exact `--version`. A `--path` install is a
 * local build and needs neither.
 */
function cargoInstallIsVersioned(
  words: readonly string[],
  env: Readonly<Record<string, string>>,
): boolean {
  const crates: string[] = [];
  let version: string | null = null;
  for (let index = 0; index < words.length; index++) {
    const word = words[index] ?? "";
    const equals = word.indexOf("=");
    const name = word.startsWith("--") && equals !== -1 ? word.slice(0, equals) : word;
    let value: string | null = null;
    if (name !== word) value = word.slice(equals + 1);
    else if (CARGO_INSTALL_VALUED.has(word)) {
      index++;
      value = words[index] ?? "";
    } else if (!word.startsWith("-")) {
      crates.push(word);
      continue;
    }
    if (name === "--path") return true;
    if ((name === "--version" || name === "--vers") && value !== null) version = value;
  }
  const exact = version === null ? null : resolve(version, env);
  const versionIsExact = exact !== null && EXACT_VERSION.test(exact);
  // `cargo install --git <url>` names no crate and installs what the branch holds.
  if (crates.length === 0) return versionIsExact;
  return crates.every((crate) => {
    const at = crate.indexOf("@");
    return at === -1 ? versionIsExact : EXACT_VERSION.test(crate.slice(at + 1));
  });
}

function isUnversionedTool(line: string, env: Readonly<Record<string, string>>): boolean {
  if (MOVING_VERSION.test(line) || CARGO_BINSTALL.test(line)) return true;
  for (const { name, args } of simpleCommands(line)) {
    if (name !== "cargo") continue;
    const subcommand = args[0]?.startsWith("+") === true ? 1 : 0;
    if (args[subcommand] !== "install") continue;
    if (!cargoInstallIsVersioned(args.slice(subcommand + 1), env)) return true;
  }
  return false;
}

interface Download {
  readonly tool: "curl" | "wget";
  readonly httpFail: boolean;
  /** `null` when the bytes go to standard output. */
  readonly sink: { readonly file: string | null } | null;
  readonly followsRedirects: boolean;
  readonly credential: boolean;
}

/** The file name a server-named download lands under, when the URL is a literal. */
function remoteName(url: string | undefined): string | null {
  if (url === undefined || url.includes("$")) return null;
  const name =
    url
      .replace(/[?#].*$/, "")
      .split("/")
      .at(-1) ?? "";
  return name === "" ? null : name;
}

function sinkOf(output: string | null, named: string | null | undefined): Download["sink"] {
  if (output === "-" || output === "/dev/stdout") return null;
  if (output !== null) return { file: output };
  return named === undefined ? null : { file: named };
}

/** curl short options that take a value: the rest of the group, or the next word, is that value. */
const CURL_SHORT_WITH_VALUE = "AbcCdDeEFHKmoPQrtTuUwxXyYz";

function parseCurl(args: readonly string[]): Download {
  let httpFail = false;
  let followsRedirects = false;
  let credential = false;
  let named = false;
  let output: string | null = null;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg : arg.slice(0, equals);
      let value = equals === -1 ? "" : arg.slice(equals + 1);
      if (["--output", "--header", "--user", "--oauth2-bearer"].includes(name) && equals === -1) {
        index++;
        value = args[index] ?? "";
      }
      if (name === "--fail" || name === "--fail-with-body") httpFail = true;
      else if (name === "--location" || name === "--location-trusted") followsRedirects = true;
      else if (name === "--remote-name" || name === "--remote-name-all") named = true;
      else if (name === "--output") output = value;
      else if (name === "--user" || name === "--oauth2-bearer") credential = true;
      else if (name === "--header" && /authorization/i.test(value)) credential = true;
      continue;
    }
    if (!arg.startsWith("-") || arg.length === 1) {
      positional.push(arg);
      continue;
    }
    for (let at = 1; at < arg.length; at++) {
      const flag = arg.charAt(at);
      if (!CURL_SHORT_WITH_VALUE.includes(flag)) {
        if (flag === "f") httpFail = true;
        else if (flag === "L") followsRedirects = true;
        else if (flag === "O") named = true;
        continue;
      }
      let value = arg.slice(at + 1);
      if (value === "") {
        index++;
        value = args[index] ?? "";
      }
      if (flag === "o") output = value;
      else if (flag === "u") credential = true;
      else if (flag === "H" && /authorization/i.test(value)) credential = true;
      break;
    }
  }
  return {
    tool: "curl",
    httpFail,
    sink: sinkOf(output, named ? remoteName(positional.at(-1)) : undefined),
    followsRedirects,
    credential,
  };
}

/** wget short options, other than `-O`, that take a value. */
const WGET_SHORT_WITH_VALUE = "oaiBtTwQPUelARDIX";

function parseWget(args: readonly string[]): Download {
  let output: string | null = null;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (arg === "--output-document") {
      index++;
      output = args[index] ?? "";
      continue;
    }
    if (arg.startsWith("--output-document=")) {
      output = arg.slice("--output-document=".length);
      continue;
    }
    // Any other long option: it names no output file.
    if (arg.startsWith("--")) continue;
    if (!arg.startsWith("-") || arg.length === 1) {
      positional.push(arg);
      continue;
    }
    for (let at = 1; at < arg.length; at++) {
      const flag = arg.charAt(at);
      if (flag !== "O" && !WGET_SHORT_WITH_VALUE.includes(flag)) continue;
      let value = arg.slice(at + 1);
      if (value === "") {
        index++;
        value = args[index] ?? "";
      }
      if (flag === "O") output = value;
      break;
    }
  }
  return {
    tool: "wget",
    httpFail: true,
    // Without -O, wget writes the file under the name the URL ends with.
    sink: sinkOf(output, remoteName(positional.at(-1))),
    followsRedirects: false,
    credential: false,
  };
}

interface FoundDownload {
  readonly download: Download;
  /** What follows the command on its own line. */
  readonly rest: string;
}

function findDownloads(line: string): FoundDownload[] {
  const found: FoundDownload[] = [];
  for (const { name, args, end } of simpleCommands(line)) {
    if (name !== "curl" && name !== "wget") continue;
    // Asking the tool what it is downloads nothing.
    if (args.includes("--version") || args.includes("--help")) continue;
    found.push({
      download: name === "curl" ? parseCurl(args) : parseWget(args),
      rest: line.slice(end),
    });
  }
  return found;
}

/** Index of `file` in `text` as a whole name, or -1: `a.zip` is not cited by `a.zip.sig`. */
function citationIndex(text: string, file: string): number {
  let at = text.indexOf(file);
  while (at !== -1) {
    const before = at === 0 ? "" : text.charAt(at - 1);
    const after = text.charAt(at + file.length);
    if (!/[\w.-]/.test(before) && !/[\w.-]/.test(after)) return at;
    at = text.indexOf(file, at + 1);
  }
  return -1;
}

const SHA_COMMAND = /(?<![\w.-])(sha256sum|shasum)(?=\s|$)/g;

/** After the check: the next stage of a pipeline, a background `&`, a `; true` or `; :`. */
const STATUS_DISCARDED = /^\s*(?:\|(?!\|)|&(?!&)|;\s*(?:true|:)(?![\w.-]))/;
/** An `||` alternative that still fails the step: `exit N`/`return N` with N ≠ 0, alone or in a group. */
const ALTERNATIVE_FAILS =
  /^\s*\|\|\s*(?:[{(]\s*)?(?:(?:[^;|&]|[<>]&)*;\s*)*?(?:exit|return)\s+[1-9]\d*(?![\w.])/;
/** `|| false` fails the step only while errexit is on. */
const ALTERNATIVE_FALSE = /^\s*\|\|\s*false(?![\w.-])/;

/**
 * Whether the exit status of the check still stops the step. The runner's
 * shells start with errexit (`bash -e`, `sh -e`): a failed check ends the step
 * unless the script discards its status (a later pipeline stage without
 * pipefail, `&`, `|| true`, `|| :`, any `||` that does not fail) or turned
 * errexit off before it (`set +e`, `set +o errexit`), where only `|| exit N`
 * still stops it.
 */
function statusKept(rest: string, errexit: boolean): boolean {
  if (STATUS_DISCARDED.test(rest)) return false;
  if (/^\s*\|\|/.test(rest)) {
    return ALTERNATIVE_FAILS.test(rest) || (errexit && ALTERNATIVE_FALSE.test(rest));
  }
  return errexit;
}

/**
 * Whether the text runs `sha256sum --check` (or `-c`), or `shasum -a 256 -c`,
 * with a status that still fails the step; `errexitAt` tells, for a position
 * on the text, whether errexit is on there.
 */
function verifiesSha256(text: string, errexitAt: (position: number) => boolean): boolean {
  for (const match of text.matchAll(SHA_COMMAND)) {
    const position = match.index ?? 0;
    const command = readCommand(text, position);
    const words = command.words.slice(1);
    const checks = words.some((word) => word === "--check" || /^-[a-z]*c[a-z]*$/.test(word));
    if (!checks) continue;
    const algorithm =
      match[1] === "sha256sum" ||
      words.some(
        (word, index) =>
          word === "-a256" ||
          word === "--algorithm=256" ||
          ((word === "-a" || word === "--algorithm") && words[index + 1] === "256"),
      );
    if (algorithm && statusKept(text.slice(command.end), errexitAt(position))) return true;
  }
  return false;
}

/**
 * The errexit changes a line makes, in order: `set -e`/`-o errexit` turns it
 * on, `set +e`/`+o errexit` off, an option group counting when it holds `e`.
 */
function errexitChanges(line: string): { readonly at: number; readonly on: boolean }[] {
  const changes: { at: number; on: boolean }[] = [];
  for (const { name, args, start } of simpleCommands(line)) {
    if (name !== "set") continue;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index] ?? "";
      if (arg === "--" || !/^[-+]/.test(arg)) break;
      const on = arg.startsWith("-");
      if (/^[-+]o$/.test(arg)) {
        index++;
        if (args[index] === "errexit") changes.push({ at: start, on });
      } else if (/^[-+][a-zA-Z]*e/.test(arg)) changes.push({ at: start, on });
    }
  }
  return changes;
}

/** The token a checksum line places before the file name: `<sum>  <file>`. */
function sumBefore(text: string, citation: number): string | null {
  return /([^\s"']+)\s+\*?$/.exec(text.slice(0, citation))?.[1] ?? null;
}

type LineKind = "blank" | "comment" | "command";

function kindOf(line: string): LineKind {
  const trimmed = line.trim();
  if (trimmed === "") return "blank";
  return trimmed.startsWith("#") ? "comment" : "command";
}

interface ScriptReview {
  readonly violations: Violation[];
  readonly lines: number;
  readonly commentLines: number;
  readonly blankLines: number;
  readonly downloads: number;
}

function reviewScript(run: RunScript, forms: readonly RemoteExecutionForm[]): ScriptReview {
  const lines = run.script.split("\n");
  // The newline that ends a block scalar closes its last line; it opens no other.
  if (lines.at(-1) === "") lines.pop();
  const kinds = lines.map(kindOf);
  const examined = lines.map((line, index) => (kinds[index] === "command" ? line : ""));
  const violations: Violation[] = [];
  const add = (code: RuleCode, index: number): void => {
    violations.push({
      code,
      job: run.job,
      step: run.step,
      line: index + 1,
      text: (lines[index] ?? "").trim().slice(0, 160),
    });
  };

  const body = examined.join("\n");
  for (const form of forms) {
    for (const match of body.matchAll(form.pattern)) {
      add(form.code, body.slice(0, match.index ?? 0).split("\n").length - 1);
    }
  }

  const changes = examined.map(errexitChanges);
  /** Whether errexit is on at `position` of line `lineIndex`: on when the script starts. */
  const errexitAt = (lineIndex: number, position: number): boolean => {
    let on = true;
    for (const [index, ofLine] of changes.slice(0, lineIndex + 1).entries()) {
      for (const change of ofLine) {
        if (index < lineIndex || change.at <= position) on = change.on;
      }
    }
    return on;
  };

  let downloads = 0;
  for (const [index, line] of examined.entries()) {
    if (line === "") continue;
    if (isUnversionedTool(line, run.env)) add("tool-unversioned", index);
    for (const { download, rest } of findDownloads(line)) {
      downloads++;
      if (download.tool === "curl" && !download.httpFail) add("download-no-http-fail", index);
      if (download.sink === null) add("download-no-output", index);
      else {
        const file = download.sink.file;
        // The rest of the line comes first: `curl -o f … && unzip f` uses the file there.
        const later = [{ index, text: rest, offset: line.length - rest.length }].concat(
          examined
            .slice(index + 1)
            .map((text, next) => ({ index: index + 1 + next, text, offset: 0 })),
        );
        const use =
          file === null ? undefined : later.find(({ text }) => citationIndex(text, file) !== -1);
        if (
          file === null ||
          use === undefined ||
          !verifiesSha256(use.text, (position) => errexitAt(use.index, use.offset + position))
        ) {
          add("download-no-checksum", index);
        } else {
          const sum = sumBefore(use.text, citationIndex(use.text, file));
          const literal = sum === null ? null : resolve(sum, run.env);
          if (literal === null || !SHA256.test(literal)) add("checksum-malformed", use.index);
        }
      }
      if (download.followsRedirects && download.credential) add("redirect-with-credential", index);
    }
  }

  violations.sort(
    (a, b) => a.line - b.line || RULE_CODES.indexOf(a.code) - RULE_CODES.indexOf(b.code),
  );
  return {
    violations,
    lines: lines.length,
    commentLines: kinds.filter((kind) => kind === "comment").length,
    blankLines: kinds.filter((kind) => kind === "blank").length,
    downloads,
  };
}

function unreadableReview(reason: string): DefinitionReview {
  return {
    violations: [],
    unreadable: reason,
    runSteps: 0,
    lines: 0,
    commentLines: 0,
    blankLines: 0,
    downloads: 0,
  };
}

export function reviewDefinition(
  text: string,
  forms: readonly RemoteExecutionForm[],
): DefinitionReview {
  // Bun.YAML.parse stops at a NUL that ends a value line and reports success:
  // every script after it would be dropped without a word.
  if (text.includes("\0")) return unreadableReview("the file carries a NUL character");
  let document: unknown;
  try {
    document = Bun.YAML.parse(text);
  } catch (error) {
    return unreadableReview(`YAML parse failed: ${(error as Error).message}`);
  }
  if (!isRecord(document)) return unreadableReview("the document is not a YAML mapping");
  const scripts = collectRunScripts(document);
  const anywhere = countRunStrings(document);
  if (anywhere !== scripts.length) {
    return unreadableReview(
      `${anywhere} \`run\` script(s) in the document, ${scripts.length} under jobs.<id>.steps or runs.steps — part of the file is out of this gate's reach`,
    );
  }
  const reviews = scripts.map((script) => reviewScript(script, forms));
  const total = (pick: (review: ScriptReview) => number): number =>
    reviews.reduce((sum, review) => sum + pick(review), 0);
  return {
    violations: reviews.flatMap((review) => review.violations),
    unreadable: null,
    runSteps: scripts.length,
    lines: total((review) => review.lines),
    commentLines: total((review) => review.commentLines),
    blankLines: total((review) => review.blankLines),
    downloads: total((review) => review.downloads),
  };
}

export interface SupplyChainTally {
  repositories: number;
  exempt: number;
  filesTracked: number;
  filesExamined: number;
  filesUnreadable: number;
  runSteps: number;
  lines: number;
  commentLines: number;
  blankLines: number;
  downloads: number;
  violations: number;
}

export function emptyTally(): SupplyChainTally {
  return {
    repositories: 0,
    exempt: 0,
    filesTracked: 0,
    filesExamined: 0,
    filesUnreadable: 0,
    runSteps: 0,
    lines: 0,
    commentLines: 0,
    blankLines: 0,
    downloads: 0,
    violations: 0,
  };
}

export function summarizeVolume(t: SupplyChainTally): string {
  return (
    `${t.repositories + t.exempt} inventory entries (${t.repositories} read, ${t.exempt} exempt): ` +
    `${t.filesTracked} tracked workflow/action file(s) = ${t.filesExamined} examined + ${t.filesUnreadable} unreadable; ` +
    `${t.runSteps} run step(s); ` +
    `${t.lines} script line(s) = ${t.lines - t.commentLines - t.blankLines} examined + ${t.commentLines} comment + ${t.blankLines} blank; ` +
    `${t.downloads} download(s) examined; rules=${RULE_CODES.length} violations=${t.violations}`
  );
}

export interface ItemCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

function renderViolation(violation: Violation): string {
  return `[${violation.code}] ${violation.job}[${violation.step}]:${violation.line} ${violation.text}`;
}

export async function reviewRepository(
  entry: RegistryEntry,
  tally: SupplyChainTally,
  forms: readonly RemoteExecutionForm[],
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
      tally.filesUnreadable++;
      checks.push({
        item,
        ok: false,
        note: `unreadable at HEAD: ${read?.reason ?? "no read outcome recorded"}`,
      });
      continue;
    }
    const review = reviewDefinition(read.text, forms);
    if (review.unreadable !== null) {
      tally.filesUnreadable++;
      checks.push({ item, ok: false, note: `unreadable: ${review.unreadable}` });
      continue;
    }
    tally.filesExamined++;
    tally.runSteps += review.runSteps;
    tally.lines += review.lines;
    tally.commentLines += review.commentLines;
    tally.blankLines += review.blankLines;
    tally.downloads += review.downloads;
    tally.violations += review.violations.length;
    const examined = review.lines - review.commentLines - review.blankLines;
    checks.push({
      item,
      ok: review.violations.length === 0,
      note:
        review.violations.length === 0
          ? `${review.runSteps} run step(s), ${examined} line(s) examined, ${review.downloads} download(s): no violation`
          : review.violations.map(renderViolation).join("; "),
    });
  }
  return checks;
}

/**
 * The whole inventory as one report. An inventory that had no file examined is
 * a named failure: every entry exempt, or every repository without a workflow,
 * would otherwise print a green over zero scripts.
 */
export async function reviewInventory(
  registry: readonly RegistryEntry[],
  forms: readonly RemoteExecutionForm[],
  reader: FleetFileReader = readRepositoryFiles,
): Promise<GateReport> {
  const report = new GateReport();
  const tally = emptyTally();
  for (const entry of registry) {
    for (const check of await reviewRepository(entry, tally, forms, reader)) {
      report.check(check.item, check.ok, check.note);
    }
  }
  if (tally.filesExamined === 0) {
    report.check(
      "inventory",
      false,
      `no workflow or action file was examined across ${registry.length} inventory entries: nothing was verified`,
    );
  }
  report.volume(summarizeVolume(tally));
  return report;
}

async function reviewFleet(): Promise<GateReport> {
  let forms: readonly RemoteExecutionForm[];
  try {
    forms = parseRemoteExecutionForms(await Bun.file(FORMS_PATH).text());
  } catch (error) {
    return new GateReport().check(
      FORMS_PATH,
      false,
      `the table of forms cannot be used: ${(error as Error).message}`,
    );
  }
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  return reviewInventory(registry, forms);
}

if (import.meta.main) {
  const { concludeGate } = await import("../tools/quality/gate-report");
  const report = await reviewFleet();
  if (report.outcome !== "pass" && report.volumeSummary !== null) {
    console.error(`Workflow supply chain volume: ${report.volumeSummary}`);
  }
  concludeGate("Workflow supply chain", report);
}
