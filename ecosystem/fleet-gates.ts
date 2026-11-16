import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
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
 * The discovery lists ONE directory, sorted, keeps the shell and Python
 * scripts, and refuses: a missing key, a scope outside the two values, a target
 * that is neither an integer nor `info`, a duplicated identifier, and a
 * directory without any detector (a fleet audited by zero detectors would read
 * « clean »). It never runs anything: execution is not this module's.
 *
 * WHAT IS NOT A DETECTOR. A file of another extension (exemption data, README),
 * a sub-folder (a detector set aside in a pending folder is neither run nor
 * counted), a symbolic link (not followed: its target may sit outside the
 * directory). Each is counted apart, so the counters sum to the entries read.
 */

/** Lines of a script, from the first, in which the keys are looked for. */
const HEADER_LINES = 20;

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([".sh", ".bash", ".py"]);

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

const KEY_LINE = /^#\s*([a-z]+)\s*:(.*)$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;

/** Reads the header of a script; every refusal is named, none stops the others. */
export function parseDetectorHeader(text: string): HeaderParse {
  const found = new Map<Key, string>();
  const errors: string[] = [];
  for (const line of text.split("\n").slice(0, HEADER_LINES)) {
    const match = KEY_LINE.exec(line.replace(/\r$/, ""));
    const key = match?.[1];
    if (match === null || key === undefined || !isKey(key)) continue;
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
    errors.push(`identifiant « ${id} » is not a lowercase slug (a-z, 0-9, hyphen)`);
  }

  const targetText = found.get("cible");
  let target: number | null = null;
  if (targetText !== undefined && targetText !== "" && targetText !== "info") {
    if (INTEGER.test(targetText)) target = Number(targetText);
    else errors.push(`cible « ${targetText} » is neither an integer nor « info »`);
  }

  const scope = found.get("portee");
  if (scope !== undefined && scope !== "" && scope !== "repo" && scope !== "parc") {
    errors.push(`portee « ${scope} » is neither « repo » nor « parc »`);
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

/** Discovers the detectors of one directory, ordered by file name. */
export async function discoverDetectors(directory: string): Promise<Discovery> {
  const root = resolve(directory);
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`${root}: directory unreadable: ${reason}`] };
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const errors: string[] = [];
  const detectors: DetectorDescriptor[] = [];
  const seen = new Map<string, string>();
  let ignored = 0;
  let links = 0;
  let folders = 0;

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      links += 1;
    } else if (entry.isDirectory()) {
      folders += 1;
    } else if (!entry.isFile() || !SCRIPT_EXTENSIONS.has(extname(entry.name))) {
      ignored += 1;
    } else {
      const path = join(root, entry.name);
      let text: string;
      try {
        text = await Bun.file(path).text();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        errors.push(`${entry.name}: unreadable: ${reason}`);
        continue;
      }
      const parsed = parseDetectorHeader(text);
      if (!parsed.ok) {
        for (const message of parsed.errors) errors.push(`${entry.name}: ${message}`);
        continue;
      }
      const first = seen.get(parsed.header.id);
      if (first !== undefined) {
        errors.push(
          `${entry.name}: identifiant « ${parsed.header.id} » already declared by ${first}`,
        );
        continue;
      }
      seen.set(parsed.header.id, entry.name);
      detectors.push({ ...parsed.header, path });
    }
  }

  if (errors.length === 0 && detectors.length === 0) {
    errors.push(`${root}: no detector found (a fleet audited by zero detectors would read clean)`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, detectors, examined: entries.length, ignored, links, folders };
}
