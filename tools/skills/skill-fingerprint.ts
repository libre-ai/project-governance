/**
 * Fingerprint of a skill directory — recipe `libre-ai.skill-fingerprint.v1`.
 *
 * The admission receipt (build-skills-admission.ts) binds what was checked to
 * what the directory holds. This file is the recipe, written here so that a
 * copy of a skill can be recomputed and compared anywhere.
 *
 * WHAT IS HASHED. Every regular file under the directory, at any depth,
 * whatever its name or extension: nothing is excluded, because a stray file is
 * part of what a copy of the directory carries. A directory is traversed and
 * is not a record: git tracks no empty directory, so recording one would make
 * a working tree and a fresh clone disagree.
 *
 * ONE RECORD PER FILE, four fields:
 * - the node type, `file` (the only one admitted; written so that a later
 *   version can admit another without changing the shape);
 * - the execute bit of the OWNER alone, `x` or `-` (`mode & 0o100`). The group
 *   and other bits follow the umask of whoever cloned the repository; the
 *   owner bit is the one git versions. A file in 0755 and in 0700 is the same
 *   record, 0644 and 0755 are two;
 * - the SHA-256 of its bytes, 64 lowercase hexadecimal digits;
 * - its path relative to the directory, `/`-separated, in Unicode NFC.
 *
 * THE PREIMAGE, unambiguous by construction. One line names the recipe, then
 * one line per record, the records sorted by the bytes of their UTF-8 path:
 *
 *   libre-ai.skill-fingerprint.v1\n
 *   file <x|-> <sha256> <byte length of the path>:<path>\n
 *
 * The first three fields have a closed alphabet and a fixed width. The path
 * comes last and is prefixed by its length in bytes, so a path holding a
 * space, a colon or a line break cannot be read as another record.
 *
 * THE FINGERPRINT is `sha256:` followed by the SHA-256 of the preimage.
 *
 * REFUSED, each one named, never skipped: a symbolic link (the directory
 * itself included; never followed, the repository versions the link and not
 * its target), an entry that is neither a file nor a directory (FIFO, socket,
 * device; never opened), an entry that cannot be inspected, listed or read,
 * and two paths that become one once normalised. A directory with one refused
 * entry has no fingerprint at all.
 *
 * NOT COVERED, by decision (ADR-0072, « Limites connues »): two names that
 * differ only by case, which a case-insensitive file system holds as one file,
 * and the line endings a clone converts (`core.autocrlf`). The recipe hashes
 * the bytes on disk.
 *
 * Idea adapted from the source-tree identity of
 * NVIDIA/SkillEvaluator@35af6d9:src/skillevaluator/publication_identity.py:621
 * (no text taken). Departure: that recipe keeps the three execute bits
 * (NVIDIA/SkillEvaluator@35af6d9:src/skillevaluator/publication_identity.py:386),
 * which makes the result depend on the umask.
 */

import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FINGERPRINT_RECIPE = "libre-ai.skill-fingerprint.v1";

/** The only permission bit the recipe reads: execute, for the owner. */
const OWNER_EXECUTE = 0o100;

export interface FileRecord {
  /** Relative to the skill directory, `/`-separated, NFC. */
  readonly path: string;
  /** The owner's execute bit, and no other. */
  readonly executable: boolean;
  /** SHA-256 of the file's bytes, lowercase hexadecimal. */
  readonly sha256: string;
}

/** An entry the walk refused, with the reason it names. */
export interface Refusal {
  readonly path: string;
  readonly reason: string;
}

export type SkillFingerprint =
  | { readonly ok: true; readonly fingerprint: string; readonly files: number }
  | { readonly ok: false; readonly refusals: readonly Refusal[] };

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Order of the UTF-8 bytes. The default string order compares UTF-16 code
 * units, which sorts a character outside the Basic Multilingual Plane before
 * some characters inside it: two implementations of the recipe would disagree.
 */
export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** Pure: the bytes the fingerprint hashes, whatever order the records come in. */
export function fingerprintPreimage(records: readonly FileRecord[]): string {
  const sorted = [...records].sort((left, right) => compareUtf8(left.path, right.path));
  const lines = sorted.map(
    (record) =>
      `file ${record.executable ? "x" : "-"} ${record.sha256} ${Buffer.byteLength(record.path, "utf8")}:${record.path}\n`,
  );
  return `${FINGERPRINT_RECIPE}\n${lines.join("")}`;
}

/** Pure: the fingerprint of a set of records. */
export function fingerprintOf(records: readonly FileRecord[]): string {
  return `sha256:${sha256Hex(fingerprintPreimage(records))}`;
}

/**
 * Pure: the paths met more than once, each named once. Two names that differ
 * only by their Unicode composition are one path after NFC; a file system that
 * keeps both would otherwise give two records no reader can tell apart.
 */
export function duplicatePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) duplicated.add(path);
    seen.add(path);
  }
  return [...duplicated];
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The fingerprint of one skill directory, or every entry that forbids one.
 * `directory` is used as given in the refusals, so a relative path stays
 * relative in what the gate prints.
 */
export function fingerprintSkillDirectory(directory: string): SkillFingerprint {
  const records: FileRecord[] = [];
  const refusals: Refusal[] = [];

  const visit = (path: string, relative: string): void => {
    let stats: ReturnType<typeof lstatSync>;
    try {
      // lstat, not stat: a link is seen as a link, whatever it points to.
      stats = lstatSync(path);
    } catch (error) {
      refusals.push({ path, reason: `cannot be inspected (${errorCode(error)})` });
      return;
    }
    if (stats.isSymbolicLink()) {
      refusals.push({
        path,
        reason: "symbolic link, never followed: the repository versions the link, not its target",
      });
      return;
    }
    if (stats.isDirectory()) {
      let entries: string[];
      try {
        entries = readdirSync(path);
      } catch (error) {
        refusals.push({ path, reason: `directory cannot be listed (${errorCode(error)})` });
        return;
      }
      for (const entry of entries) {
        visit(join(path, entry), relative === "" ? entry : `${relative}/${entry}`);
      }
      return;
    }
    if (relative === "") {
      refusals.push({ path, reason: "not a directory" });
      return;
    }
    if (!stats.isFile()) {
      // Opening a FIFO blocks until a writer comes; a device or a socket has
      // no content to hash.
      refusals.push({
        path,
        reason: "not a regular file (FIFO, socket or device), never opened",
      });
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      refusals.push({ path, reason: `cannot be read (${errorCode(error)})` });
      return;
    }
    records.push({
      path: relative.normalize("NFC"),
      executable: (stats.mode & OWNER_EXECUTE) !== 0,
      sha256: sha256Hex(bytes),
    });
  };
  visit(directory, "");
  return concludeFingerprint(directory, records, refusals);
}

/**
 * Pure: the fingerprint of the records a walk gathered, or what forbids one.
 * Apart from the walk because the last refusal cannot be staged on every file
 * system: one that folds Unicode compositions (APFS) never holds the two names
 * that one that keeps them (ext4, the CI runner) can.
 */
export function concludeFingerprint(
  directory: string,
  records: readonly FileRecord[],
  walkRefusals: readonly Refusal[],
): SkillFingerprint {
  const refusals = [
    ...walkRefusals,
    ...duplicatePaths(records.map((record) => record.path)).map((path) => ({
      path: join(directory, path),
      reason: "two entries have this path once normalised (NFC): the record would be ambiguous",
    })),
  ];
  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, fingerprint: fingerprintOf(records), files: records.length };
}
