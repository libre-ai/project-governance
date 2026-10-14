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
 * Mutation proof. A REFUSAL SITE is a line that emits a finding (`add("`) or
 * throws (`throw new GitFailure(` / `throw new Refusal(`). Each site carries a
 * `// neutralise:<id>` marker within the eight lines above it (one marker covers one site), or a
 * `// neutralise:none <reason>` exemption that states why no test can reach it.
 * `neutralise-check.ts` finds the sites with its own pattern, independently of
 * the markers, prints sites / marked / exempt, and fails when the three do not
 * add up. For each marker it replays the tests on a throwaway copy where that
 * condition is forced false and requires a `red:<id>` test to fail by
 * assertion (gate-integrity sections 2 and 5).
 *
 * Usage:
 *   bun tools/attestation/git-attestation.ts manifest <dir> <owner/repo>
 *   bun tools/attestation/git-attestation.ts text <file>... --identities <file> [--deny-b64 b]
 *   bun tools/attestation/git-attestation.ts scan <dir> --identities <file>
 *        [--attestation <manifest.jcs.json>] [--trusted-ref <ref>]
 *        [--deny-b64 <base64 literal>]...
 */

import { readFileSync, statSync } from "node:fs";
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

export type IdentityScope = "anywhere" | "forge-added-only";

export interface Identity {
  readonly name: string;
  readonly address: string;
  /** `anywhere`: the owner. `forge-added-only`: valid on commits no trusted ref reaches. */
  readonly scope: IdentityScope;
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

type Add = (surface: string, kind: string, oid: string) => void;

class GitFailure extends Error {
  constructor(
    message: string,
    /** The finding kind a scan reports for this failure. */
    readonly kind: string = "git-failure",
  ) {
    super(message);
  }
}

/** A refusal to run or to describe: its message is fixed text and is the only thing main() prints. */
class Refusal extends Error {}

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

let gitOutputLimit = 1 << 30;

/** Test seam: the largest output of one git command that is read, in bytes (default 1 GiB). */
export function setGitOutputLimit(bytes: number): void {
  gitOutputLimit = bytes;
}

function git(dir: string, args: readonly string[], input?: Uint8Array): Buffer {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: gitEnvironment,
    stdin: input ?? "ignore",
    stdout: "pipe",
    stderr: "pipe",
    maxBuffer: gitOutputLimit,
  });
  // The exit code is the verdict; stderr may quote object content, so it is dropped.
  // neutralise:git-exit
  if (result.exitCode !== 0) throw new GitFailure(`git ${args[0] ?? ""} exited ${result.exitCode}`);
  // Bun 1.4.0 returns exit code 0 with a TRUNCATED stdout when the output exceeds maxBuffer
  // (measured: 200000 bytes asked, 66536 returned, exitedDueToMaxBuffer true). A partial listing
  // would read as a complete one.
  // neutralise:git-output-limit
  if (result.exitedDueToMaxBuffer)
    throw new GitFailure("git output exceeds the read limit", "git-output-limit");
  return Buffer.from(result.stdout);
}

export interface InventoryEntry {
  readonly oid: string;
  readonly type: string;
  readonly size: number;
}

/**
 * Refuse entries whose type is not commit, tree, blob or tag, and return them. Git itself
 * refuses to list such an object ("invalid object type", measured with git 2.56.0 on a
 * hand-written loose object), so through the real command this branch is defence in depth and
 * the observable refusal is `fsck-failed` plus `git-failure`; the filter is exercised directly.
 */
export function refuseUnhandled(entries: readonly InventoryEntry[], add: Add): InventoryEntry[] {
  const unhandled: InventoryEntry[] = [];
  for (const entry of entries) {
    // neutralise:object-type
    if (!handledTypes.has(entry.type)) {
      add("object", "type-not-handled", entry.oid);
      unhandled.push(entry);
    }
  }
  return unhandled;
}

/** The manifest cannot describe an object type it does not handle: refuse, never skip. */
export function assertHandledTypes(entries: readonly InventoryEntry[]): void {
  for (const entry of entries) {
    // neutralise:manifest-type
    if (!handledTypes.has(entry.type)) throw new Refusal("object type not handled");
  }
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
      // neutralise:none short or truncated git output is refused earlier by git-output-limit; kept for a git that exits 0 with a short answer, contract: cat-file prints three fields per line or fails
      throw new GitFailure("inventory line not understood");
    entries.push({ oid, type, size: Number(size) });
  }
  return entries.sort((a, b) => (a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : 0));
}

interface RawObject {
  readonly type: string;
  readonly body: Buffer;
}

/**
 * One `cat-file --batch` round trip. `null` marks an object git reports missing.
 *
 * Accepted limit (not a fix): every handled object is read into one buffer, bounded by the git
 * output limit (1 GiB). `maximumBlobBytes` is applied after that read, so it bounds the scan of a
 * blob, not the memory used to fetch it. A repository whose objects exceed the limit fails closed
 * (`git-output-limit` becomes a `git-failure` finding) instead of being read partly. The
 * candidate holds 366,295 blob bytes in 205 objects.
 */
function readObjects(dir: string, oids: readonly string[]): Map<string, RawObject | null> {
  const out = git(dir, ["cat-file", "--batch"], Buffer.from(`${oids.join("\n")}\n`));
  const objects = new Map<string, RawObject | null>();
  let position = 0;
  for (const oid of oids) {
    const newline = out.indexOf(0x0a, position);
    if (newline < 0)
      // neutralise:none short or truncated git output is refused earlier by git-output-limit; kept for a git that exits 0 with a short answer, contract: --batch answers once per requested object
      throw new GitFailure("batch output truncated");
    const header = out.subarray(position, newline).toString("latin1").split(" ");
    if (header[1] === "missing") {
      objects.set(oid, null);
      position = newline + 1;
      continue;
    }
    const [, type, size] = header;
    if (type === undefined || size === undefined)
      // neutralise:none short or truncated git output is refused earlier by git-output-limit; kept for a git that exits 0 with a short answer, contract: --batch header is "<oid> <type> <size>"
      throw new GitFailure("batch header not understood");
    const start = newline + 1;
    const end = start + Number(size);
    if (end > out.length)
      // neutralise:none short or truncated git output is refused earlier by git-output-limit; kept for a git that exits 0 with a short answer, contract: --batch body is as long as its header says
      throw new GitFailure("batch output truncated");
    objects.set(oid, { type, body: out.subarray(start, end) });
    position = end + 1;
  }
  return objects;
}

/**
 * Pair each handled entry with its bytes. An object git listed but cannot read means the store
 * changed under the scan: it is refused, not skipped.
 */
export function readableObjects(
  entries: readonly InventoryEntry[],
  raw: ReadonlyMap<string, RawObject | null>,
  add: Add,
): Array<{ entry: InventoryEntry; object: RawObject }> {
  const readable: Array<{ entry: InventoryEntry; object: RawObject }> = [];
  for (const entry of entries) {
    const object = raw.get(entry.oid);
    // neutralise:unreadable
    if (object === null || object === undefined) {
      add("object", "unreadable", entry.oid);
      continue;
    }
    readable.push({ entry, object });
  }
  return readable;
}

function listRefs(dir: string): Ref[] {
  const out = git(dir, ["for-each-ref", "--format=%(refname)%09%(objectname)"]).toString("latin1");
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [name, objectId] = line.split("\t");
      if (name === undefined || objectId === undefined)
        // neutralise:none short or truncated git output is refused earlier by git-output-limit; kept for a git that exits 0 with a short answer, contract: for-each-ref prints "<ref> TAB <oid>"
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
        throw new Refusal("non-ASCII string: outside the admitted JCS subset");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    // neutralise:manifest-number
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Refusal("number outside the admitted JCS subset");
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
    // neutralise:tree-malformed
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
    throw new Refusal("shallow repository");
  const objectFormat = git(dir, ["rev-parse", "--show-object-format"]).toString().trim();
  const entries = inventory(dir);
  assertHandledTypes(entries);
  const trees = entries.filter((entry) => entry.type === "tree");
  const bodies = readObjects(
    dir,
    trees.map((entry) => entry.oid),
  );
  type TreeRecord = {
    mode: string;
    name: string;
    objectId: string;
    treeObjectId: string;
    type: string;
  };
  const treeEntries: TreeRecord[] = [];
  for (const tree of trees) {
    const raw = bodies.get(tree.oid);
    if (raw === null || raw === undefined)
      // neutralise:none the tree was just listed by --batch-all-objects; same contract as unreadable
      throw new Refusal("tree unreadable");
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
    return a.treeObjectId === b.treeObjectId
      ? a.name < b.name
        ? -1
        : a.name > b.name
          ? 1
          : 0
      : a.treeObjectId < b.treeObjectId
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

export const windowSize = 32_768;
export const windowOverlap = 512;

export function windows(text: string): string[] {
  if (text.length <= windowSize) return [text];
  const out: string[] = [];
  for (let start = 0; start < text.length; start += windowSize - windowOverlap)
    out.push(text.slice(start, start + windowSize));
  return out;
}

const addressLocalPart = /[A-Za-z0-9._%+-]/;
const addressDomainPart = /[A-Za-z0-9_-]/;

/**
 * Remove each DELIMITED occurrence of `address`. An occurrence that continues a longer address
 * (a local part glued before it, a domain label glued after it) is a different address and stays.
 */
function stripAddress(text: string, address: string): string {
  let out = "";
  let from = 0;
  for (let at = text.indexOf(address); at >= 0; at = text.indexOf(address, from)) {
    const end = at + address.length;
    const before = at === 0 ? "" : (text[at - 1] ?? "");
    const after = text[end] ?? "";
    const next = text[end + 1] ?? "";
    // neutralise:strip-boundary
    if (
      addressLocalPart.test(before) ||
      addressDomainPart.test(after) ||
      (after === "." && /[A-Za-z0-9]/.test(next))
    ) {
      out += text.slice(from, end);
      from = end;
      continue;
    }
    out += text.slice(from, at);
    from = end;
  }
  return out + text.slice(from);
}

/**
 * Remove the allowlisted addresses before the personal-data judgement. A forge-only identity is
 * removed only from the message of a forge-added commit: the same address in a blob, or in a
 * commit main reaches, stays visible and is refused.
 */
export function stripAllowedAddresses(
  text: string,
  identities: readonly Identity[],
  forgeAdded: boolean,
): string {
  let stripped = text;
  for (const identity of identities) {
    // neutralise:strip-scope
    if (identity.scope === "forge-added-only" && !forgeAdded) continue;
    stripped = stripAddress(stripped, identity.address);
  }
  return stripped;
}

/** Content classes present in `text`. Returns class names only, never the bytes. */
export function contentClasses(text: string, options: ScanOptions, forgeAdded = false): string[] {
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
        stripAllowedAddresses(part, options.identities, forgeAdded),
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
  const add: Add = (surface, kind, oid) => {
    findings.push({ surface, kind, oid });
  };
  try {
    scan(dir, options, counters, add);
  } catch (error) {
    if (!(error instanceof GitFailure)) throw error;
    // An unreadable repository is a refusal, never a pass over what could be read.
    // neutralise:git-failure
    add("read", error.kind, "");
  }
  return { findings, counters };
}

function scan(dir: string, options: ScanOptions, counters: Record<string, number>, add: Add): void {
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
  const unhandled = refuseUnhandled(entries, add);
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

  for (const { entry, object } of readableObjects(handled, raw, add)) {
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
  const classes = classesOfBytes(object.body, options);
  // neutralise:blob-content
  if (classes.length > 0) add("blob", classes.join("+"), entry.oid);
}

/** Content classes of raw bytes: latin1, UTF-16LE when a NUL byte is present, and strict UTF-8. */
export function classesOfBytes(body: Buffer, options: ScanOptions): string[] {
  const classes = new Set(contentClasses(body.toString("latin1"), options));
  // A NUL byte betrays UTF-16 text, which a byte-wise ASCII scan cannot see into.
  // neutralise:blob-utf16
  if (body.includes(0x00))
    for (const klass of contentClasses(body.toString("utf16le"), options)) classes.add(klass);
  // The UTF-8 reading folds compatibility forms (fullwidth letters, ligatures) that a latin1
  // reading of the same bytes leaves as unrecognisable multi-byte noise.
  const utf8 = decodeUtf8(body);
  // neutralise:blob-utf8
  if (utf8 !== null) for (const klass of contentClasses(utf8, options)) classes.add(klass);
  // One invalid byte must not switch the compatibility-form reading off for the whole file: fall
  // back to the lossy UTF-8 reading (invalid bytes become U+FFFD) so the rest is still folded.
  // neutralise:blob-utf8-lossy
  if (utf8 === null)
    for (const klass of contentClasses(body.toString("utf8"), options)) classes.add(klass);
  return [...classes].sort();
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
    if (hasControlOrBackslash(name)) classes.add("unsafe-component");
    // neutralise:tree-path-dot
    if (/^(?:\.git|\.\.?)$/i.test(name)) classes.add("unsafe-component");
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
  // neutralise:person-malformed
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
  // neutralise:person-pair
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
  // neutralise:commit-headers
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
  const classes = contentClasses(parsed.message, options, forgeAdded);
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
  // neutralise:tag-utf8
  if (text === null) {
    add("tag", "not-utf8", entry.oid);
    return;
  }
  const parsed = parseHeaders(text);
  // neutralise:tag-headers
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
      // neutralise:tag-link
      if (!known.has(header.value)) add("tag", "link-missing", entry.oid);
    } else if (header.key === "tag") {
      const classes = contentClasses(header.value, options);
      // neutralise:tag-name
      if (classes.length > 0) add("tag-name", classes.join("+"), entry.oid);
    } else if (header.key !== "type") {
      // neutralise:tag-header
      add("tag", "header-not-handled", entry.oid);
    }
  }
  // neutralise:tagger-missing
  if (!hasTagger) add("tagger-name", "tagger-missing", entry.oid);
  else checkPerson("tagger", tagger, entry.oid, false, options, add);
  const classes = contentClasses(parsed.message, options);
  // neutralise:tag-message
  if (classes.length > 0) add("tag-message", classes.join("+"), entry.oid);
}

// ---------------------------------------------------------------------------
// Operator input: a malformed argument or file is a refusal, never a silent default.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a file the operator named. The error carries the kind of file, never its path. */
function readOperatorFile(path: string, what: string): Buffer {
  let bytes: Buffer | undefined;
  try {
    bytes = readFileSync(path);
  } catch {
    bytes = undefined;
  }
  // neutralise:cli-file
  if (bytes === undefined) throw new Refusal(`${what} cannot be read`);
  return bytes;
}

/** A directory the operator named must exist; the error does not echo the path. */
function requireDirectory(path: string): void {
  let found = false;
  try {
    found = statSync(path).isDirectory();
  } catch {
    found = false;
  }
  // neutralise:cli-dir
  if (!found) throw new Refusal("repository directory not found");
}

export function readAttestedRefs(manifestPath: string): Ref[] {
  const parsed: unknown = JSON.parse(
    readOperatorFile(manifestPath, "attestation file").toString("utf8"),
  );
  const refs = isRecord(parsed) ? parsed.refs : undefined;
  // neutralise:attestation-refs
  if (!Array.isArray(refs)) throw new Refusal("attestation carries no refs array");
  const list = refs.map((ref: unknown) => {
    // neutralise:attestation-ref
    if (!isRecord(ref) || typeof ref.name !== "string" || typeof ref.objectId !== "string")
      throw new Refusal("attestation ref malformed");
    return { name: ref.name, objectId: ref.objectId };
  });
  // A Map keeps the last of two entries with one name: a conflicting pair would pass unseen.
  const names = new Set<string>();
  for (const ref of list) {
    // neutralise:attestation-duplicate
    if (names.has(ref.name)) throw new Refusal("attestation lists a ref name twice");
    names.add(ref.name);
  }
  return list;
}

export function parseIdentities(text: string): Identity[] {
  let parsed: unknown;
  let readable = true;
  try {
    parsed = JSON.parse(text);
  } catch {
    readable = false;
  }
  // neutralise:identities-json
  if (!readable) throw new Refusal("identities file is not JSON");
  // neutralise:identities-array
  if (!Array.isArray(parsed) || parsed.length === 0)
    throw new Refusal("identities file must be a non-empty array");
  const identities: Identity[] = parsed.map((entry: unknown) => {
    // neutralise:identities-object
    if (!isRecord(entry)) throw new Refusal("identity entry is not an object");
    // neutralise:identities-keys
    if (Object.keys(entry).sort().join(",") !== "address,name,scope")
      throw new Refusal("identity entry must have exactly name, address and scope");
    const { name, address, scope } = entry;
    // neutralise:identities-strings
    if (typeof name !== "string" || name === "" || typeof address !== "string" || address === "")
      throw new Refusal("identity name and address must be non-empty strings");
    // neutralise:identities-scope
    if (scope !== "anywhere" && scope !== "forge-added-only")
      throw new Refusal('identity scope must be "anywhere" or "forge-added-only"');
    return { name, address, scope };
  });
  // neutralise:identities-owner
  if (!identities.some((identity) => identity.scope === "anywhere"))
    throw new Refusal("identities carry no owner entry with scope anywhere");
  return identities;
}

/** Strict base64 of a non-empty UTF-8 literal. The value is never echoed in an error. */
export function decodeDenyLiteral(encoded: string): string {
  // neutralise:cli-b64-form
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    Buffer.from(encoded, "base64").toString("base64") !== encoded
  )
    throw new Refusal("--deny-b64 value is not canonical base64");
  const decoded = decodeUtf8(Buffer.from(encoded, "base64"));
  // neutralise:cli-b64-utf8
  if (decoded === null) throw new Refusal("--deny-b64 value is not UTF-8");
  // A canonical non-empty base64 string cannot decode to nothing: the empty literal is already
  // refused by the form check above, which is why there is no separate branch for it.
  return decoded;
}

export interface ParsedArguments {
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, readonly string[]>;
}

const knownFlags: ReadonlySet<string> = new Set([
  "--identities",
  "--attestation",
  "--trusted-ref",
  "--deny-b64",
]);
const repeatableFlags: ReadonlySet<string> = new Set(["--deny-b64"]);

export function parseArguments(args: readonly string[]): ParsedArguments {
  const positional: string[] = [];
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    // neutralise:cli-flag-unknown
    if (!knownFlags.has(arg)) throw new Refusal("unknown flag");
    const value = args[index + 1];
    // neutralise:cli-flag-value
    if (value === undefined || value.startsWith("--")) throw new Refusal(`${arg} needs a value`);
    const seen = flags.get(arg) ?? [];
    // neutralise:cli-flag-duplicate
    if (seen.length > 0 && !repeatableFlags.has(arg)) throw new Refusal(`${arg} given twice`);
    flags.set(arg, [...seen, value]);
    index += 1;
  }
  return { positional, flags };
}

function run(args: readonly string[]): number {
  const { positional, flags } = parseArguments(args);
  const [command, dir, repository] = positional;
  if (command === "manifest") {
    // neutralise:cli-positional
    if (dir === undefined || repository === undefined || positional.length !== 3 || flags.size > 0)
      throw new Refusal("usage: manifest <dir> <owner/repo>");
    requireDirectory(dir);
    process.stdout.write(buildManifest(dir, repository));
    return 0;
  }
  if (command === "text") {
    // neutralise:cli-text-usage
    if (dir === undefined || !flags.has("--identities"))
      throw new Refusal("usage: text <file>... --identities <file> [--deny-b64 b]");
    // neutralise:cli-text-flags
    if (flags.has("--attestation") || flags.has("--trusted-ref"))
      throw new Refusal("text does not take --attestation or --trusted-ref");
    const options: ScanOptions = {
      identities: parseIdentities(
        readOperatorFile(flags.get("--identities")?.[0] ?? "", "identities file").toString("utf8"),
      ),
      denyLiterals: (flags.get("--deny-b64") ?? []).map(decodeDenyLiteral),
    };
    // Text that is not a git object (Actions logs): same content classes, file by file. The
    // output names a file and a class, never the matched bytes.
    const results = positional.slice(1).map((path) => {
      const bytes = readOperatorFile(path, "input file");
      let classes: string[];
      // neutralise:text-limit
      if (bytes.length > defaultMaximumBlobBytes) classes = ["resource-limit"];
      else classes = classesOfBytes(bytes, options);
      return { file: path.split("/").at(-1) ?? path, bytes: bytes.length, classes };
    });
    console.log(JSON.stringify({ files: results.length, results }, null, 2));
    return results.some((result) => result.classes.length > 0) ? 1 : 0;
  }
  // neutralise:cli-command
  if (command !== "scan") throw new Refusal("unknown command");
  {
    // neutralise:cli-scan-usage
    if (dir === undefined || positional.length !== 2 || !flags.has("--identities"))
      throw new Refusal(
        "usage: scan <dir> --identities <file> [--attestation f] [--trusted-ref r] [--deny-b64 b]",
      );
    requireDirectory(dir);
    const attestationPath = flags.get("--attestation")?.[0];
    const report = scanRepository(dir, {
      identities: parseIdentities(
        readOperatorFile(flags.get("--identities")?.[0] ?? "", "identities file").toString("utf8"),
      ),
      trustedRef: flags.get("--trusted-ref")?.[0],
      attestedRefs: attestationPath === undefined ? undefined : readAttestedRefs(attestationPath),
      denyLiterals: (flags.get("--deny-b64") ?? []).map(decodeDenyLiteral),
    });
    console.log(JSON.stringify({ counters: report.counters, findings: report.findings }, null, 2));
    return report.findings.length === 0 ? 0 : 1;
  }
}

function main(args: readonly string[]): number {
  try {
    return run(args);
  } catch (error) {
    // Exit 2 is "refused to run": distinct from 1 ("ran, found something"). Messages carry
    // flag names and fixed text, never an argument value.
    console.error(error instanceof Refusal ? error.message : "refused: unexpected failure");
    return 2;
  }
}

// exitCode, not exit(): exit() can cut a large manifest short when stdout is a pipe.
if (import.meta.main) process.exitCode = main(process.argv.slice(2));
