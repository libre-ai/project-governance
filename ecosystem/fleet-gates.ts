import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

/**
 * Discovery of the fleet detectors (idea h-plugins-flotte-02).
 *
 * A detector is a shell or Python script that declares, in comments within its
 * first 20 lines, five keys: `identifiant`, `titre`, `fragilite` (the weakness
 * it targets), `cible` (the count of findings expected: an integer, or `info`
 * for a blind spot or a size, neither conformant nor in breach) and `portee`
 * (`repo`: run in each worktree; `parc`: run once from the root of the
 * worktrees).
 *
 * The discovery lists ONE directory, sorted, holds every candidate script to
 * the header, and refuses: a missing key, an unknown key (the schema is closed:
 * any `# word: value` line in the header is a key line), a scope outside the
 * two values, a target that is neither a safe integer nor `info`, a duplicated
 * identifier, and a directory without any detector (a fleet audited by zero
 * detectors would read « clean »). It never runs anything: execution is not
 * this module's. Names and values are printed with control characters escaped.
 *
 * A CANDIDATE is a regular file with a script extension (any case), a shebang
 * or an executable bit: a gate present but undeclared is refused, never passed.
 *
 * WHAT IS NOT A DETECTOR. A non-executable file of another extension without a
 * shebang (exemption data, README), a sub-folder (a detector set aside in a
 * pending folder is neither run nor counted), a symbolic link (not followed:
 * its target may sit outside the directory). Each is counted apart, so the
 * counters sum to the entries read.
 *
 * KNOWN GAP WITH THE BRIEF. The brief names the module
 * `ecosystem/fleet-gates.v1.yaml + vérificateur`: one declaration file checked
 * against the scripts. Here the declaration is the header of each script, so a
 * gate declared but absent cannot exist and is not checked. Owner's call.
 */

/** Lines of a script, from the first, in which the keys are looked for. */
const HEADER_LINES = 20;

/** Compared lower-cased. Shell and Python carry `#` headers; the others never can, so they are refused. */
const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".ksh",
  ".py",
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".rb",
  ".pl",
]);

type Scope = "repo" | "parc";

export interface DetectorHeader {
  readonly id: string;
  readonly title: string;
  readonly fragility: string;
  /** The count of findings expected; null for `info`. */
  readonly target: number | null;
  readonly scope: Scope;
}

export interface DetectorDescriptor extends DetectorHeader {
  /** Absolute: the script runs from another directory. */
  readonly path: string;
}

export type HeaderParse =
  | { readonly ok: true; readonly header: DetectorHeader }
  | { readonly ok: false; readonly errors: readonly string[] };

export type Discovery =
  | {
      readonly ok: true;
      readonly detectors: readonly DetectorDescriptor[];
      /** Entries of the directory: detectors + ignored + links + folders. */
      readonly examined: number;
      readonly ignored: number;
      readonly links: number;
      readonly folders: number;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

const KEYS = ["identifiant", "titre", "fragilite", "cible", "portee"] as const;
type Key = (typeof KEYS)[number];

function isKey(value: string): value is Key {
  return (KEYS as readonly string[]).includes(value);
}

/**
 * Any `# word: value` line is a key line, whatever the case or the alphabet of
 * the word, so that `# Cible: 3` or `# portée: repo` is read and refused as an
 * unknown key instead of being skipped as prose. The colon must be followed by
 * a blank or the end of the line, so a URL (`# https://…`) stays prose.
 */
// `s`: a carriage return or a line separator inside a value is kept, then escaped, never a reason to skip the line.
const KEY_LINE = /^#[ \t]*([\p{L}_][\p{L}\p{N}_-]*)[ \t]*:(?:[ \t](.*))?$/su;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;

const UNPRINTABLE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: escaping control characters is the point.
  /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{200e}\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

/**
 * A file name or a header value, made safe to print on one line: a line break
 * in a name would otherwise forge a line of the report, an escape sequence
 * would repaint it, a bidi override would reorder it.
 */
export function printable(text: string): string {
  return text.replace(
    UNPRINTABLE,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Reads the header of a script; every refusal is named, none stops the others. */
export function parseDetectorHeader(text: string): HeaderParse {
  const found = new Map<Key, string>();
  const errors: string[] = [];
  for (const line of text.split("\n").slice(0, HEADER_LINES)) {
    const match = KEY_LINE.exec(line.replace(/\r$/, ""));
    const key = match?.[1];
    if (match === null || key === undefined) continue;
    if (!isKey(key)) {
      // The schema is closed: an unknown key is a typo or a setting nobody reads.
      errors.push(`unknown key « ${printable(key)} » (expected: ${KEYS.join(", ")})`);
      continue;
    }
    if (found.has(key)) {
      errors.push(`key « ${key} » declared twice`);
      continue;
    }
    // Trimmed here, not in the regex: overlapping quantifiers backtrack quadratically.
    found.set(key, (match[2] ?? "").trim());
  }

  for (const key of KEYS) {
    if (!found.has(key)) errors.push(`missing key « ${key} »`);
    else if (found.get(key) === "") errors.push(`key « ${key} » is empty`);
  }

  const id = found.get("identifiant") ?? "";
  if (id !== "" && !SLUG.test(id)) {
    errors.push(`identifiant « ${printable(id)} » is not a lowercase slug (a-z, 0-9, hyphen)`);
  }

  const targetText = found.get("cible");
  let target: number | null = null;
  if (targetText !== undefined && targetText !== "" && targetText !== "info") {
    // Past 2^53 - 1, Number() rounds: the target compared would not be the one declared.
    const value = INTEGER.test(targetText) ? Number(targetText) : Number.NaN;
    if (Number.isSafeInteger(value)) target = value;
    else
      errors.push(
        `cible « ${printable(targetText)} » is neither an integer up to ${Number.MAX_SAFE_INTEGER} nor « info »`,
      );
  }

  const scope = found.get("portee");
  if (scope !== undefined && scope !== "" && scope !== "repo" && scope !== "parc") {
    errors.push(`portee « ${printable(scope)} » is neither « repo » nor « parc »`);
  }

  if (errors.length > 0 || (scope !== "repo" && scope !== "parc")) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    header: {
      id,
      title: found.get("titre") ?? "",
      fragility: found.get("fragilite") ?? "",
      target,
      scope,
    },
  };
}

/**
 * Whether a regular file is to be held to the header: a script extension of
 * any case, a shebang, or an executable bit. Anything that could run as a gate
 * is a candidate, so a gate present but undeclared is refused, never counted
 * as « other file ».
 */
async function looksLikeScript(path: string, name: string): Promise<boolean> {
  if (SCRIPT_EXTENSIONS.has(extname(name).toLowerCase())) return true;
  if (((await lstat(path)).mode & 0o111) !== 0) return true;
  return (await Bun.file(path).slice(0, 2).text()) === "#!";
}

/** Discovers the detectors of one directory, ordered by file name. */
export async function discoverDetectors(directory: string): Promise<Discovery> {
  const root = resolve(directory);
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [`${printable(root)}: directory unreadable: ${printable(reason)}`],
    };
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const errors: string[] = [];
  const detectors: DetectorDescriptor[] = [];
  const seen = new Map<string, string>();
  let ignored = 0;
  let links = 0;
  let folders = 0;

  for (const entry of entries) {
    const name = printable(entry.name);
    if (entry.isSymbolicLink()) {
      links += 1;
      continue;
    }
    if (entry.isDirectory()) {
      folders += 1;
      continue;
    }
    if (!entry.isFile()) {
      ignored += 1;
      continue;
    }
    const path = join(root, entry.name);
    let candidate: boolean;
    try {
      candidate = await looksLikeScript(path, entry.name);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: unreadable: ${printable(reason)}`);
      continue;
    }
    if (!candidate) {
      ignored += 1;
      continue;
    }
    let text: string;
    try {
      text = await Bun.file(path).text();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`${name}: unreadable: ${printable(reason)}`);
      continue;
    }
    const parsed = parseDetectorHeader(text);
    if (!parsed.ok) {
      for (const message of parsed.errors) errors.push(`${name}: ${message}`);
      continue;
    }
    const first = seen.get(parsed.header.id);
    if (first !== undefined) {
      errors.push(`${name}: identifiant « ${parsed.header.id} » already declared by ${first}`);
      continue;
    }
    seen.set(parsed.header.id, name);
    detectors.push({ ...parsed.header, path });
  }

  if (errors.length === 0 && detectors.length === 0) {
    errors.push(
      `${printable(root)}: no detector found (a fleet audited by zero detectors would read clean)`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, detectors, examined: entries.length, ignored, links, folders };
}
