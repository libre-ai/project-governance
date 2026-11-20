import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { findUnreadableCharacter } from "../tools/quality/yaml-text-guard";

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
 * THE REGISTRY (`ecosystem/fleet-gates.v1.yaml`, the module the brief names;
 * owner's decision of 2026-11-17). It lists the fleet's gates, each by its
 * `identifiant` and the `fichier` that carries it in the detectors directory.
 * The discovery reads it and checks it against the directory both ways: a
 * gate declared in the registry with no detector at its file fails, named; a
 * script whose header declares a gate without a registry entry fails, named;
 * an entry whose file declares another identifier fails. The header stays the
 * declaration of what a gate does, the registry the list of which gates exist.
 *
 * The registry is read through a LINE WHITELIST, then confronted with
 * `Bun.YAML.parse`. A YAML parser resolves a repeated key silently (the last
 * wins), so the line reader, which sees every key, refuses a key declared
 * twice; the shapes it admits cannot quote, escape, alias or comment a value,
 * so text equality is key equality. The whitelist:
 *
 *   version: 1
 *   detecteurs: []                  or  detecteurs:  then one or more entries
 *     - identifiant: <slug>         (indent 2; `fichier` may come first)
 *       fichier: <file name>        (indent 4; no `/`, not hidden)
 *
 * plus whole-line comments (`# …`) and blank lines. Any other line is refused.
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
      /** Entries of the registry; equal to the detectors found when ok. */
      readonly registered: number;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface RegistryEntry {
  readonly id: string;
  /** A file name in the detectors directory. */
  readonly file: string;
}

export type RegistryParse =
  | { readonly ok: true; readonly entries: readonly RegistryEntry[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The registry of the fleet's gates in this repository. */
export const REGISTRY_PATH = join(import.meta.dir, "fleet-gates.v1.yaml");

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

// ------------------------------------------------------------------ registry

const REGISTRY_VERSION = /^version:(?: (.*))?$/;
const REGISTRY_LIST = /^detecteurs:( \[\])?$/;
const REGISTRY_ENTRY = /^( {2}- | {4})(identifiant|fichier):(?: (.*))?$/;
/** A plain file name: no directory, not hidden, nothing YAML would read as syntax. */
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

type EntryKey = "identifiant" | "fichier";

interface EntryLines {
  readonly line: number;
  readonly values: Map<EntryKey, string>;
}

/** Reads the registry text; every refusal is named with its line, none stops the others. */
export function parseRegistry(text: string): RegistryParse {
  const unreadable = findUnreadableCharacter(text);
  if (unreadable !== null) {
    return {
      ok: false,
      errors: [`line ${unreadable.line}: unreadable character ${unreadable.codePoint}`],
    };
  }
  const errors: string[] = [];
  let version: { line: number; value: string } | null = null;
  let list: { line: number; empty: boolean } | null = null;
  const entries: EntryLines[] = [];

  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    if (line === "" || line.startsWith("#")) continue;
    const versionMatch = REGISTRY_VERSION.exec(line);
    if (versionMatch !== null) {
      if (version !== null) {
        errors.push(`line ${number}: « version » declared twice (line ${version.line})`);
      } else version = { line: number, value: versionMatch[1] ?? "" };
      continue;
    }
    const listMatch = REGISTRY_LIST.exec(line);
    if (listMatch !== null) {
      if (list !== null) {
        errors.push(`line ${number}: « detecteurs » declared twice (line ${list.line})`);
      } else list = { line: number, empty: listMatch[1] !== undefined };
      continue;
    }
    const entryMatch = REGISTRY_ENTRY.exec(line);
    if (entryMatch !== null) {
      const [, indent, key = "", value = ""] = entryMatch;
      if (list === null || list.empty) {
        errors.push(`line ${number}: an entry outside a non-empty « detecteurs » list`);
        continue;
      }
      const entryKey = key as EntryKey;
      if (indent === "  - ") {
        entries.push({ line: number, values: new Map([[entryKey, value]]) });
        continue;
      }
      const current = entries.at(-1);
      if (current === undefined) {
        errors.push(`line ${number}: « ${entryKey} » belongs to no entry`);
      } else if (current.values.has(entryKey)) {
        errors.push(
          `line ${number}: « ${entryKey} » declared twice in the entry of line ${current.line}`,
        );
      } else current.values.set(entryKey, value);
      continue;
    }
    errors.push(
      `line ${number}: not a line of the registry (version, detecteurs, an entry's identifiant or fichier, a comment): « ${printable(line)} »`,
    );
  }

  if (version === null) errors.push("missing « version »");
  else if (version.value !== "1") {
    errors.push(`line ${version.line}: version « ${printable(version.value)} » is not 1`);
  }
  if (list === null) errors.push("missing « detecteurs » (write « detecteurs: [] » for none)");
  else if (!list.empty && entries.length === 0) {
    errors.push(`line ${list.line}: « detecteurs » without entries (write « detecteurs: [] »)`);
  }

  const result: RegistryEntry[] = [];
  const ids = new Map<string, number>();
  const files = new Map<string, number>();
  for (const entry of entries) {
    const id = entry.values.get("identifiant");
    const file = entry.values.get("fichier");
    const where = `entry of line ${entry.line}`;
    if (id === undefined) errors.push(`${where}: missing « identifiant »`);
    else if (!SLUG.test(id)) {
      errors.push(`${where}: identifiant « ${printable(id)} » is not a lowercase slug`);
    }
    if (file === undefined) errors.push(`${where}: missing « fichier »`);
    else if (!FILE_NAME.test(file)) {
      errors.push(`${where}: fichier « ${printable(file)} » is not a plain, visible file name`);
    }
    if (id === undefined || file === undefined) continue;
    const firstId = ids.get(id);
    if (firstId !== undefined)
      errors.push(`${where}: identifiant « ${id} » already at line ${firstId}`);
    else ids.set(id, entry.line);
    const firstFile = files.get(file);
    if (firstFile !== undefined)
      errors.push(`${where}: fichier « ${file} » already at line ${firstFile}`);
    else files.set(file, entry.line);
    result.push({ id, file });
  }
  if (errors.length > 0) return { ok: false, errors };

  // The whitelist admits no syntax a parser could read otherwise; confronting
  // the two keeps that claim checked rather than assumed.
  const expected = {
    version: 1,
    detecteurs: result.map((entry) => ({ identifiant: entry.id, fichier: entry.file })),
  };
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`not YAML: ${printable(reason)}`] };
  }
  if (JSON.stringify(sortedEntries(parsed)) !== JSON.stringify(sortedEntries(expected))) {
    return { ok: false, errors: ["the YAML parser reads another registry than the line reader"] };
  }
  return { ok: true, entries: result };
}

/** Key order is not meaning: `fichier` may precede `identifiant` in an entry. */
function sortedEntries(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedEntries);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, sortedEntries(inner)]),
    );
  }
  return value;
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

/**
 * Discovers the detectors of one directory, ordered by file name, and checks
 * them against the registry at `registryPath` both ways.
 */
export async function discoverDetectors(
  directory: string,
  registryPath: string,
): Promise<Discovery> {
  let registryText: string;
  try {
    registryText = await Bun.file(registryPath).text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [`registry ${printable(registryPath)}: unreadable: ${printable(reason)}`],
    };
  }
  const registry = parseRegistry(registryText);
  if (!registry.ok) {
    return {
      ok: false,
      errors: registry.errors.map((error) => `registry ${printable(registryPath)}: ${error}`),
    };
  }

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
  /** File name (raw) → identifier its header declares, for the registry check. */
  const byFile = new Map<string, string>();
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
    byFile.set(entry.name, parsed.header.id);
  }

  // The registry against the directory, both ways.
  const registeredIn = new Map(registry.entries.map((entry) => [entry.file, entry.id]));
  for (const [file, id] of byFile) {
    if (registeredIn.get(file) !== id) {
      errors.push(
        `${printable(file)}: declares the gate « ${id} », which has no entry for this file in the registry`,
      );
    }
  }
  for (const entry of registry.entries) {
    const found = byFile.get(entry.file);
    if (found === undefined) {
      errors.push(`registry: « ${entry.id} » declared in ${entry.file}, no detector found there`);
    } else if (found !== entry.id) {
      errors.push(
        `registry: « ${entry.id} » declared in ${entry.file}, which declares the gate « ${found} »`,
      );
    }
  }

  if (errors.length === 0 && detectors.length === 0) {
    errors.push(
      `${printable(root)}: no detector found (a fleet audited by zero detectors would read clean)`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    detectors,
    examined: entries.length,
    ignored,
    links,
    folders,
    registered: registry.entries.length,
  };
}
