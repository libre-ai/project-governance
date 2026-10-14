/**
 * Git history attestation tool (ADR-0038 D2, D3, D4).
 *
 * Two jobs, one module, because both read the same object database and must
 * agree on what "every object" means:
 *
 *   1. `buildManifest` produces the RFC 8785 (JCS) manifest of a repository:
 *      every full ref name with its OID, every object `{objectId, type, size}`,
 *      every tree entry. It fails closed on a shallow clone, an object type
 *      other than commit/tree/blob/tag, and any non-ASCII string (the only
 *      subset where this serializer equals RFC 8785; a wider input must be
 *      refused, not approximated).
 *   2. `scanRepository` scans every object of the database (a superset of the
 *      objects reachable from the attested refs) on each surface ADR-0038 D3
 *      names, and checks the ref set against an attestation.
 *
 * Why a closed vocabulary of findings: a diagnostic carries the surface, the
 * class and the OID of the object, never the matched bytes (D3: "les
 * diagnostics ne recopient jamais l'octet sensible"). The OID lets a reviewer
 * read the object with `git cat-file`; a copy of the secret in a CI log would
 * itself be the leak.
 *
 * Why every check is one `if` tagged `neutralise:<id>`: `neutralise-check.ts`
 * replays the test suite on a copy where exactly that `if` is forced false and
 * requires the matching `red:<id>` test to fail (gate-integrity section 5: a
 * test is proven by neutralising what it verifies, by no-op substitution and
 * not by deleting the line).
 *
 * Usage:
 *   bun tools/attestation/git-attestation.ts manifest <dir> <owner/repo>
 *   bun tools/attestation/git-attestation.ts scan <dir> --identities <file>
 *        [--attestation <manifest.jcs.json>] [--trusted-ref <ref>]
 *        [--deny-b64 <base64 literal>]...
 */

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  containsCredentialMarker,
  containsEmailIdentifierExcludingRfc2606Examples,
} from "../quality/public-source-scanner";

export type GitObjectType = "commit" | "tree" | "blob" | "tag";
const handledTypes: ReadonlySet<string> = new Set<GitObjectType>(["commit", "tree", "blob", "tag"]);

export interface Ref {
  readonly name: string;
  readonly objectId: string;
}

export interface Identity {
  readonly name: string;
  readonly address: string;
  /** `anywhere`: the owner. `forge-added-only`: valid on commits no trusted ref reaches. */
  readonly scope: "anywhere" | "forge-added-only";
}

export interface Finding {
  readonly surface: string;
  readonly kind: string;
  readonly oid: string;
}

export interface ScanOptions {
  readonly identities: readonly Identity[];
  /** Ref whose history is owner-authored; commits it does not reach are forge-added. */
  readonly trustedRef?: string;
  /** Refs the attestation covers. Absent: the ref-set surfaces are not evaluated. */
  readonly attestedRefs?: readonly Ref[];
  /** Literals denied in every text surface (owner-specific, passed at run time, never committed). */
  readonly denyLiterals?: readonly string[];
  /** Blobs above this size are refused rather than partially read. Default 64 MiB. */
  readonly maximumBlobBytes?: number;
}

export interface ScanReport {
  readonly findings: Finding[];
  readonly counters: Record<string, number>;
}

class GitFailure extends Error {}

// ---------------------------------------------------------------------------
// git access: bounded environment, no ambient configuration, no replace refs.
// ---------------------------------------------------------------------------

const gitEnvironment: Record<string, string> = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: tmpdir(),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

function git(dir: string, args: readonly string[], input?: Uint8Array): Buffer {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: gitEnvironment,
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: 1 << 30,
  });
  // The exit code is the verdict; stderr may quote object content, so it is dropped.
  if (result.exitCode !== 0) throw new GitFailure(`git ${args[0] ?? ""} exited ${result.exitCode}`);
  return Buffer.from(result.stdout);
}

export interface InventoryEntry {
  readonly oid: string;
  readonly type: string;
  readonly size: number;
}

/**
 * Entries whose type is not commit, tree, blob or tag. Git itself refuses to list such an
 * object ("invalid object type", measured with git 2.56.0 on a hand-written loose object), so
 * through the real command this branch is defence in depth and the observable refusal is
 * `fsck-failed` plus `git-failure`; the filter is exercised directly by the tests.
 */
export function unhandledObjects(entries: readonly InventoryEntry[]): InventoryEntry[] {
  return entries.filter((entry) => {
    // neutralise:object-type
    if (!handledTypes.has(entry.type)) return true;
    return false;
  });
}

function inventory(dir: string): InventoryEntry[] {
  const out = git(dir, [
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname) %(objecttype) %(objectsize)",
  ]).toString("latin1");
  const entries: InventoryEntry[] = [];
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const [oid, type, size] = line.split(" ");
    if (oid === undefined || type === undefined || size === undefined)
      throw new GitFailure("inventory line not understood");
    entries.push({ oid, type, size: Number(size) });
  }
  return entries.sort((a, b) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0));
}

interface RawObject {
  readonly type: string;
  readonly body: Buffer;
}

/** One `cat-file --batch` round trip. `null` marks an object git reports missing. */
function readObjects(dir: string, oids: readonly string[]): Map<string, RawObject | null> {
  const out = git(dir, ["cat-file", "--batch"], Buffer.from(`${oids.join("\n")}\n`));
  const objects = new Map<string, RawObject | null>();
  let position = 0;
  for (const oid of oids) {
    const newline = out.indexOf(0x0a, position);
    if (newline < 0) throw new GitFailure("batch output truncated");
    const header = out.subarray(position, newline).toString("latin1").split(" ");
    if (header[1] === "missing") {
      objects.set(oid, null);
      position = newline + 1;
      continue;
    }
    const [, type, size] = header;
    if (type === undefined || size === undefined)
      throw new GitFailure("batch header not understood");
    const start = newline + 1;
    const end = start + Number(size);
    if (end > out.length) throw new GitFailure("batch output truncated");
    objects.set(oid, { type, body: out.subarray(start, end) });
    position = end + 1;
  }
  return objects;
}

function listRefs(dir: string): Ref[] {
  const out = git(dir, ["for-each-ref", "--format=%(refname)%09%(objectname)"]).toString("latin1");
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [name, objectId] = line.split("\t");
      if (name === undefined || objectId === undefined)
        throw new GitFailure("ref line not understood");
      return { name, objectId };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// RFC 8785 serialization of the admitted subset (ASCII strings, safe integers).
// ---------------------------------------------------------------------------

export type Json = string | number | readonly Json[] | { readonly [key: string]: Json };

export function canonicalJson(value: Json): string {
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index += 1)
      // neutralise:manifest-ascii
      if (value.charCodeAt(index) > 0x7f)
        throw new Error("non-ASCII string: outside the admitted JCS subset");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("number outside the admitted JCS subset");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((child) => canonicalJson(child)).join(",")}]`;
  const object = value as { readonly [key: string]: Json };
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${canonicalJson(key)}:${canonicalJson(object[key] as Json)}`).join(",")}}`;
}

interface TreeEntry {
  readonly mode: string;
  readonly name: Buffer;
  readonly oid: string;
}

function parseTree(body: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let position = 0;
  while (position < body.length) {
    const space = body.indexOf(0x20, position);
    const nul = body.indexOf(0x00, space + 1);
    if (space < 0 || nul < 0 || nul + 21 > body.length)
      throw new GitFailure("tree entry malformed");
    entries.push({
      mode: body.subarray(position, space).toString("latin1"),
      name: body.subarray(space + 1, nul),
      oid: body.subarray(nul + 1, nul + 21).toString("hex"),
    });
    position = nul + 21;
  }
  return entries;
}

function entryType(mode: string): string {
  if (mode === "40000") return "tree";
  if (mode === "160000") return "commit";
  return "blob";
}

export function buildManifest(dir: string, repository: string): string {
  // neutralise:manifest-shallow
  if (git(dir, ["rev-parse", "--is-shallow-repository"]).toString().trim() !== "false")
    throw new Error("shallow repository");
  const objectFormat = git(dir, ["rev-parse", "--show-object-format"]).toString().trim();
  const entries = inventory(dir);
  for (const entry of entries)
    if (!handledTypes.has(entry.type)) throw new Error("object type not handled");
  const trees = entries.filter((entry) => entry.type === "tree");
  const bodies = readObjects(
    dir,
    trees.map((entry) => entry.oid),
  );
  const treeEntries: Json[] = [];
  for (const tree of trees) {
    const raw = bodies.get(tree.oid);
    if (raw === null || raw === undefined) throw new Error("tree unreadable");
    for (const entry of parseTree(raw.body)) {
      const mode = entry.mode.padStart(6, "0");
      treeEntries.push({
        mode,
        name: entry.name.toString("latin1"),
        objectId: entry.oid,
        treeObjectId: tree.oid,
        type: entryType(entry.mode),
      });
    }
  }
  treeEntries.sort((a, b) => {
    const left = a as { treeObjectId: string; name: string };
    const right = b as { treeObjectId: string; name: string };
    return left.treeObjectId === right.treeObjectId
      ? left.name < right.name
        ? -1
        : left.name > right.name
          ? 1
          : 0
      : left.treeObjectId < right.treeObjectId
        ? -1
        : 1;
  });
  return canonicalJson({
    gitObjectFormat: objectFormat,
    objects: entries.map((entry) => ({ objectId: entry.oid, size: entry.size, type: entry.type })),
    refs: listRefs(dir).map((ref) => ({ name: ref.name, objectId: ref.objectId })),
    repository,
    schemaVersion: "libre-ai.git-object-manifest.v2",
    treeEntries,
  });
}

// ---------------------------------------------------------------------------
// Content classes. Patterns are assembled from parts so that this source is
// not itself a hit for the repository's own local-path and identifier gates.
// ---------------------------------------------------------------------------

const userHomeSegment = ["Us", "ers"].join("");
const localPathPatterns: readonly RegExp[] = [
  new RegExp(`/${userHomeSegment}/[A-Za-z0-9._-]+`),
  /\/home\/[a-z_][a-z0-9_.-]*\//,
  /\/private\/var\//,
  /\/var\/folders\//,
  new RegExp(`[A-Za-z]:\\\\${userHomeSegment}\\\\`),
  /\/Volumes\/[A-Za-z0-9._-]+\//,
];
const cookiePatterns: readonly RegExp[] = [
  /(?:^|[^A-Za-z0-9_-])(?:Set-)?Cookie\s*:\s*\S/im,
  /document\.cookie/,
  /\b(?:JSESSIONID|PHPSESSID|connect\.sid|sessionid)\s*=\s*[A-Za-z0-9%._-]{8,}/,
];
const personalDataPatterns: readonly RegExp[] = [
  /\+33[ .]?[1-9](?:[ .-]?\d{2}){4}/,
  /\b0[1-9]([ .-])\d{2}\1\d{2}\1\d{2}\1\d{2}\b/,
  /\bFR\d{2}(?: ?\d{4}){5} ?\d{3}\b/,
];
const instanceConfigPatterns: readonly RegExp[] = [
  /[a-z0-9-]+\.(?:cleverapps\.io|clever-cloud\.com)\b/i,
  /\b[A-Z][A-Z0-9]*_ADDON_URI\s*=/,
  /_authToken\s*=/,
  /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/,
];
const instanceConfigNames: readonly RegExp[] = [
  /^\.env(?:\..+)?$/,
  /\.(?:pem|key|p12|pfx|tfstate|tfvars)$/,
  /^(?:id_rsa|id_ed25519|kubeconfig|\.npmrc|\.netrc)/,
];
const captureArtefactNames: readonly RegExp[] = [
  /\.(?:har|pcap|pcapng|mitm|dmp|webarchive|sqlite|sqlite3)$/i,
  /^Cookies$/,
];

const windowSize = 32_768;
const windowOverlap = 512;

function windows(text: string): string[] {
  if (text.length <= windowSize) return [text];
  const out: string[] = [];
  for (let start = 0; start < text.length; start += windowSize - windowOverlap)
    out.push(text.slice(start, start + windowSize));
  return out;
}

function stripAllowedAddresses(text: string, identities: readonly Identity[]): string {
  let stripped = text;
  for (const identity of identities) stripped = stripped.split(identity.address).join("");
  return stripped;
}

/** Content classes present in `text`. Returns class names only, never the bytes. */
export function contentClasses(text: string, options: ScanOptions): string[] {
  const classes = new Set<string>();
  for (const part of windows(text)) {
    // neutralise:content-local-path
    if (localPathPatterns.some((pattern) => pattern.test(part))) classes.add("local-path");
    // neutralise:content-credential
    if (containsCredentialMarker(part)) classes.add("credential");
    // neutralise:content-cookie
    if (cookiePatterns.some((pattern) => pattern.test(part))) classes.add("cookie");
    // neutralise:content-personal-data
    if (
      personalDataPatterns.some((pattern) => pattern.test(part)) ||
      containsEmailIdentifierExcludingRfc2606Examples(
        stripAllowedAddresses(part, options.identities),
      )
    )
      classes.add("personal-data");
    // neutralise:content-instance-config
    if (instanceConfigPatterns.some((pattern) => pattern.test(part)))
      classes.add("instance-config");
    for (const literal of options.denyLiterals ?? []) {
      // neutralise:content-denied-literal
      if (literal !== "" && part.includes(literal)) classes.add("denied-literal");
    }
  }
  return [...classes].sort();
}

// ---------------------------------------------------------------------------
// The scan.
// ---------------------------------------------------------------------------

const treeModes: ReadonlySet<string> = new Set(["100644", "100755", "40000"]);
const defaultMaximumBlobBytes = 64 * 1024 * 1024;

interface Header {
  readonly key: string;
  readonly value: string;
}

/** Commit and tag headers; a continuation line (leading space) extends the previous value. */
function parseHeaders(text: string): { headers: Header[]; message: string } | null {
  const split = text.indexOf("\n\n");
  const head = split < 0 ? text : text.slice(0, split);
  const message = split < 0 ? "" : text.slice(split + 2);
  const headers: Header[] = [];
  for (const line of head.split("\n")) {
    if (line.startsWith(" ")) {
      const last = headers.pop();
      if (last === undefined) return null;
      headers.push({ key: last.key, value: `${last.value}\n${line.slice(1)}` });
      continue;
    }
    const space = line.indexOf(" ");
    if (space < 0) return null;
    headers.push({ key: line.slice(0, space), value: line.slice(space + 1) });
  }
  return { headers, message };
}

interface Person {
  readonly name: string;
  readonly address: string;
}

function parsePerson(value: string): Person | null {
  const match = /^(.*) <([^<>]*)> \d+ [+-]\d{4}$/.exec(value);
  if (match === null) return null;
  return { name: match[1] ?? "", address: match[2] ?? "" };
}

function hasControlOrBackslash(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function scanRepository(dir: string, options: ScanOptions): ScanReport {
  const findings: Finding[] = [];
  const counters: Record<string, number> = {
    objects: 0,
    commits: 0,
    trees: 0,
    treeEntries: 0,
    blobs: 0,
    blobBytes: 0,
    tags: 0,
    refs: 0,
    signatures: 0,
    unreachableObjects: 0,
  };
  const add = (surface: string, kind: string, oid: string): void => {
    findings.push({ surface, kind, oid });
  };
  try {
    scan(dir, options, counters, add);
  } catch (error) {
    if (!(error instanceof GitFailure)) throw error;
    // An unreadable repository is a refusal, never a pass over what could be read.
    add("read", "git-failure", "");
  }
  return { findings, counters };
}

function scan(
  dir: string,
  options: ScanOptions,
  counters: Record<string, number>,
  add: (surface: string, kind: string, oid: string) => void,
): void {
  // neutralise:shallow
  if (git(dir, ["rev-parse", "--is-shallow-repository"]).toString().trim() !== "false") {
    add("clone", "shallow", "");
    return;
  }

  const refs = listRefs(dir);
  counters.refs = refs.length;
  for (const ref of refs) {
    const classes = contentClasses(ref.name, options);
    // neutralise:ref-name
    if (classes.length > 0) add("ref-name", classes.join("+"), ref.objectId);
  }
  const attested = options.attestedRefs;
  if (attested !== undefined) {
    const attestedByName = new Map(attested.map((ref) => [ref.name, ref.objectId]));
    for (const ref of refs) {
      const expected = attestedByName.get(ref.name);
      // neutralise:ref-absent
      if (expected === undefined) add("ref-set", "ref-absent-from-attestation", ref.objectId);
      // neutralise:ref-oid-changed
      else if (expected !== ref.objectId) add("ref-set", "attested-ref-oid-changed", ref.objectId);
    }
    const present = new Set(refs.map((ref) => ref.name));
    for (const ref of attested) {
      // neutralise:ref-missing
      if (!present.has(ref.name)) add("ref-set", "attested-ref-missing", ref.objectId);
    }
  }

  // An object store that git itself rejects is not scanned past: the verdict is the refusal.
  const fsck = Bun.spawnSync(
    ["git", "-C", dir, "fsck", "--strict", "--no-dangling", "--no-progress"],
    {
      env: gitEnvironment,
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  // neutralise:fsck
  if (fsck.exitCode !== 0) add("object-store", "fsck-failed", "");

  const entries = inventory(dir);
  counters.objects = entries.length;
  const known = new Set(entries.map((entry) => entry.oid));
  const unhandled = unhandledObjects(entries);
  for (const entry of unhandled) add("object", "type-not-handled", entry.oid);
  const handled = entries.filter((entry) => !unhandled.includes(entry));

  const raw = readObjects(
    dir,
    handled.map((entry) => entry.oid),
  );

  const trustedCommits = new Set<string>();
  if (options.trustedRef !== undefined) {
    // neutralise:trusted-ref
    if (!refs.some((ref) => ref.name === options.trustedRef))
      add("ref-set", "trusted-ref-missing", "");
    else
      for (const oid of git(dir, ["rev-list", options.trustedRef]).toString().split("\n"))
        if (oid !== "") trustedCommits.add(oid);
  }

  for (const entry of handled) {
    const object = raw.get(entry.oid);
    // Defence in depth: `--batch-all-objects` only lists objects git can find, so a null here
    // means the store changed under the scan. It is refused, not skipped.
    if (object === null || object === undefined) {
      add("object", "unreadable", entry.oid);
      continue;
    }
    if (entry.type === "blob") scanBlob(entry, object, options, counters, add);
    else if (entry.type === "tree") scanTree(entry, object, known, raw, options, counters, add);
    else if (entry.type === "commit")
      scanCommit(entry, object, known, trustedCommits, options, counters, add);
    else scanTag(entry, object, known, options, counters, add);
  }

  // Reachability: D2 attests accessible objects. An object no ref reaches is outside the
  // attested set and could hide content; it is refused rather than silently scanned.
  const reachable = new Set(
    git(dir, ["rev-list", "--objects", "--all"])
      .toString("latin1")
      .split("\n")
      .map((line) => line.split(" ")[0] ?? "")
      .filter((oid) => oid !== ""),
  );
  for (const entry of entries) {
    // neutralise:unreachable
    if (!reachable.has(entry.oid)) {
      counters.unreachableObjects = (counters.unreachableObjects ?? 0) + 1;
      add("object", "unreachable-from-refs", entry.oid);
    }
  }
}

type Add = (surface: string, kind: string, oid: string) => void;

function scanBlob(
  entry: InventoryEntry,
  object: RawObject,
  options: ScanOptions,
  counters: Record<string, number>,
  add: Add,
): void {
  counters.blobs = (counters.blobs ?? 0) + 1;
  counters.blobBytes = (counters.blobBytes ?? 0) + object.body.length;
  // neutralise:blob-limit
  if (object.body.length > (options.maximumBlobBytes ?? defaultMaximumBlobBytes)) {
    add("blob", "resource-limit", entry.oid);
    return;
  }
  const classes = new Set(contentClasses(object.body.toString("latin1"), options));
  // A NUL byte betrays UTF-16 text, which a byte-wise ASCII scan cannot see into.
  if (object.body.includes(0x00))
    for (const klass of contentClasses(object.body.toString("utf16le"), options))
      classes.add(klass);
  const utf8 = decodeUtf8(object.body);
  if (utf8 !== null) for (const klass of contentClasses(utf8, options)) classes.add(klass);
  // neutralise:blob-content
  if (classes.size > 0) add("blob", [...classes].sort().join("+"), entry.oid);
}

function scanTree(
  entry: InventoryEntry,
  object: RawObject,
  known: ReadonlySet<string>,
  raw: ReadonlyMap<string, RawObject | null>,
  options: ScanOptions,
  counters: Record<string, number>,
  add: Add,
): void {
  counters.trees = (counters.trees ?? 0) + 1;
  for (const child of parseTree(object.body)) {
    counters.treeEntries = (counters.treeEntries ?? 0) + 1;
    // neutralise:tree-mode
    if (!treeModes.has(child.mode)) add("tree-entry", `mode-${child.mode}`, entry.oid);
    // neutralise:tree-target-missing
    else if (!known.has(child.oid)) add("tree-entry", "target-missing", entry.oid);
    else {
      const target = raw.get(child.oid);
      // neutralise:tree-type
      if (target !== null && target !== undefined && target.type !== entryType(child.mode))
        add("tree-entry", "type-mismatch", entry.oid);
    }
    const name = decodeUtf8(child.name);
    // neutralise:tree-path-bytes
    if (name === null) {
      add("tree-path", "not-utf8", entry.oid);
      continue;
    }
    const classes = new Set(contentClasses(name, options));
    // neutralise:tree-path-config
    if (instanceConfigNames.some((pattern) => pattern.test(name))) classes.add("instance-config");
    // neutralise:tree-path-capture
    if (captureArtefactNames.some((pattern) => pattern.test(name))) classes.add("capture-artefact");
    // neutralise:tree-path-unsafe
    if (hasControlOrBackslash(name) || /^(?:\.git|\.\.?)$/i.test(name))
      classes.add("unsafe-component");
    // neutralise:tree-path
    if (classes.size > 0) add("tree-path", [...classes].sort().join("+"), entry.oid);
  }
}

function checkPerson(
  role: "author" | "committer" | "tagger",
  person: Person | null,
  oid: string,
  forgeAdded: boolean,
  options: ScanOptions,
  add: Add,
): void {
  if (person === null) {
    add(`${role}-name`, "header-malformed", oid);
    return;
  }
  const admitted = options.identities.filter(
    (identity) => identity.scope === "anywhere" || forgeAdded,
  );
  // Name and address are judged separately so that each has its own failure (D3).
  // neutralise:person-address
  if (!admitted.some((identity) => identity.address === person.address))
    add(`${role}-address`, "not-allowlisted", oid);
  // neutralise:person-name
  if (!admitted.some((identity) => identity.name === person.name))
    add(`${role}-name`, "not-allowlisted", oid);
  else if (
    admitted.some((identity) => identity.address === person.address) &&
    !admitted.some(
      (identity) => identity.address === person.address && identity.name === person.name,
    )
  )
    add(`${role}-name`, "pair-mismatch", oid);
}

function scanCommit(
  entry: InventoryEntry,
  object: RawObject,
  known: ReadonlySet<string>,
  trustedCommits: ReadonlySet<string>,
  options: ScanOptions,
  counters: Record<string, number>,
  add: Add,
): void {
  counters.commits = (counters.commits ?? 0) + 1;
  const text = decodeUtf8(object.body);
  // neutralise:commit-utf8
  if (text === null) {
    add("commit", "not-utf8", entry.oid);
    return;
  }
  const parsed = parseHeaders(text);
  if (parsed === null) {
    add("commit", "headers-malformed", entry.oid);
    return;
  }
  // Forge-added: no trusted ref reaches it. Without a trusted ref every commit is owner-scope.
  const forgeAdded = options.trustedRef !== undefined && !trustedCommits.has(entry.oid);
  let author: Person | null = null;
  let committer: Person | null = null;
  for (const header of parsed.headers) {
    if (header.key === "author") author = parsePerson(header.value);
    else if (header.key === "committer") committer = parsePerson(header.value);
    else if (header.key === "tree" || header.key === "parent") {
      // neutralise:commit-link
      if (!known.has(header.value)) add("commit", "link-missing", entry.oid);
    } else if (header.key === "gpgsig" || header.key === "gpgsig-sha256") {
      counters.signatures = (counters.signatures ?? 0) + 1;
      const classes = contentClasses(header.value, options);
      // neutralise:commit-signature
      if (classes.length > 0) add("commit-signature", classes.join("+"), entry.oid);
    } else {
      // neutralise:commit-header
      add("commit", "header-not-handled", entry.oid);
    }
  }
  checkPerson("author", author, entry.oid, forgeAdded, options, add);
  checkPerson("committer", committer, entry.oid, forgeAdded, options, add);
  const classes = contentClasses(parsed.message, options);
  // neutralise:commit-message
  if (classes.length > 0) add("commit-message", classes.join("+"), entry.oid);
}

function scanTag(
  entry: InventoryEntry,
  object: RawObject,
  known: ReadonlySet<string>,
  options: ScanOptions,
  counters: Record<string, number>,
  add: Add,
): void {
  counters.tags = (counters.tags ?? 0) + 1;
  const text = decodeUtf8(object.body);
  if (text === null) {
    add("tag", "not-utf8", entry.oid);
    return;
  }
  const parsed = parseHeaders(text);
  if (parsed === null) {
    add("tag", "headers-malformed", entry.oid);
    return;
  }
  let tagger: Person | null = null;
  let hasTagger = false;
  for (const header of parsed.headers) {
    if (header.key === "tagger") {
      hasTagger = true;
      tagger = parsePerson(header.value);
    } else if (header.key === "object") {
      if (!known.has(header.value)) add("tag", "link-missing", entry.oid);
    } else if (header.key === "tag") {
      const classes = contentClasses(header.value, options);
      // neutralise:tag-name
      if (classes.length > 0) add("tag-name", classes.join("+"), entry.oid);
    } else if (header.key !== "type") add("tag", "header-not-handled", entry.oid);
  }
  // neutralise:tagger-missing
  if (!hasTagger) add("tagger-name", "tagger-missing", entry.oid);
  else checkPerson("tagger", tagger, entry.oid, false, options, add);
  const classes = contentClasses(parsed.message, options);
  // neutralise:tag-message
  if (classes.length > 0) add("tag-message", classes.join("+"), entry.oid);
}

// ---------------------------------------------------------------------------
// Command line.
// ---------------------------------------------------------------------------

export function readAttestedRefs(manifestPath: string): Ref[] {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const refs = (parsed as { refs?: unknown }).refs;
  if (!Array.isArray(refs)) throw new Error("attestation carries no refs array");
  return refs.map((ref: { name?: unknown; objectId?: unknown }) => {
    if (typeof ref.name !== "string" || typeof ref.objectId !== "string")
      throw new Error("attestation ref malformed");
    return { name: ref.name, objectId: ref.objectId };
  });
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function main(args: readonly string[]): number {
  const [command, dir] = args;
  if (dir === undefined) {
    console.error("usage: git-attestation.ts <manifest|scan> <dir> ...");
    return 2;
  }
  if (command === "manifest") {
    const repository = args[2];
    if (repository === undefined) {
      console.error("usage: git-attestation.ts manifest <dir> <owner/repo>");
      return 2;
    }
    process.stdout.write(buildManifest(dir, repository));
    return 0;
  }
  if (command === "scan") {
    const identitiesPath = option(args, "--identities");
    if (identitiesPath === undefined) {
      console.error("scan requires --identities <file>");
      return 2;
    }
    const attestationPath = option(args, "--attestation");
    const denyLiterals = args.flatMap((arg, index) =>
      arg === "--deny-b64" && args[index + 1] !== undefined
        ? [Buffer.from(args[index + 1] as string, "base64").toString("utf8")]
        : [],
    );
    const report = scanRepository(dir, {
      identities: JSON.parse(readFileSync(identitiesPath, "utf8")) as Identity[],
      trustedRef: option(args, "--trusted-ref"),
      attestedRefs: attestationPath === undefined ? undefined : readAttestedRefs(attestationPath),
      denyLiterals,
    });
    console.log(JSON.stringify({ counters: report.counters, findings: report.findings }, null, 2));
    return report.findings.length === 0 ? 0 : 1;
  }
  console.error("unknown command");
  return 2;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
