import { spawnSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { existsSync, readFileSync, writeSync } from "node:fs";
import {
  type FileHandle,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Key generation ceremony for the Ed25519 origin-signature key (WP-G2-Z01).
 * Owner-run, offline; docs/security/KEY-CEREMONY-RUNBOOK.md is the procedure.
 *
 * Usage:
 *   bun tools/security/keygen-ceremony.ts --out <dir> [--purpose <text>] [--passphrase-fd <n>]
 *   bun tools/security/keygen-ceremony.ts --dev-key [--purpose <text>]
 *   bun tools/security/keygen-ceremony.ts --public-key-only [--purpose <text>]
 *   bun tools/security/keygen-ceremony.ts --verify-sealed <file> --public-key <pem> [--passphrase-fd <n>]
 *
 * Exit codes: 0 success, 1 tool failure (write, unseal, mismatch, public key
 * shape, sealing cipher missing from the runtime), 2 usage, 4 refusal (CI
 * detected outside --dev-key, output under git, existing target, passphrase
 * refused).
 *
 * The passphrase is read from the controlling terminal without echo (twice,
 * both entries equal) or from an inherited descriptor (--passphrase-fd). It is
 * never accepted as an argument nor read from the environment: an argument is
 * visible to every process listing and an environment variable is inherited
 * by every child, and either one lands in shell history or CI logs.
 *
 * Standard output carries only the registry entry (JSON) to copy into
 * config/signing-keys.v1.json; every human-facing line goes to standard
 * error. The tool never writes the registry itself: registering a key is an
 * owner act.
 *
 * Importing this module runs nothing: the ceremony starts under
 * `import.meta.main` only, so the test imports the real functions.
 */

export interface RegistryEntry {
  id: string;
  algorithm: "Ed25519";
  publicKey: string;
  purpose: string;
  activatedAt: string;
  revokedAt: null;
}

export interface GeneratedKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/** File-system operations the ceremony performs on --out and --verify-sealed paths. */
export interface CeremonyFs {
  isDirectory(path: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  /** Creates `path`; fails if it already exists. */
  writeExclusive(path: string, data: Uint8Array, mode: number): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  /** Moves `from` to `to`; fails if `to` already exists. */
  renameNoClobber(from: string, to: string): Promise<void>;
  /** Removes `path`; absent is not an error. */
  remove(path: string): Promise<void>;
}

/** Everything `main` touches outside its arguments, injectable by the tests. */
export interface CeremonyIo {
  env: Readonly<Record<string, string | undefined>>;
  now(): Date;
  stdout(text: string): void;
  stderr(text: string): void;
  readPassphraseFromFd(fd: number): Promise<string>;
  /** Reads one line from the controlling terminal with echo disabled. */
  readPassphraseFromTerminal(prompt: string): Promise<string>;
  generateKeyPair(): GeneratedKeyPair;
  fs: CeremonyFs;
}

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_REFUSED = 4;

const CI_VARIABLES = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "TRAVIS", "BUILDKITE"];
const MINIMUM_PASSPHRASE_LENGTH = 32;
const DEFAULT_PURPOSE = "AgentContributorLineage v1, Proof v1 origin signatures";

// DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410 §4): SEQUENCE(42),
// SEQUENCE(5) { OID 1.3.101.112 }, BIT STRING(33) with 0 unused bits.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_SPKI_LENGTH = 44;

// Envelope layout, unchanged since the first version of this tool so an
// earlier envelope still unseals: salt(16) || nonce(12) || ciphertext || tag(16).
const SEAL_CIPHER = "chacha20-poly1305";
const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** Key identifier: lowercase hex SHA-256 of the 32 raw public-key bytes. */
export function deriveKeyId(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== 32) {
    throw new RangeError(`an Ed25519 public key is 32 bytes, got ${rawPublicKey.length}`);
  }
  return createHash("sha256").update(rawPublicKey).digest("hex");
}

function rawPublicKeyFromSpkiDer(der: Uint8Array): Uint8Array {
  if (der.length !== ED25519_SPKI_LENGTH) {
    throw new Error(`Ed25519 SPKI is ${ED25519_SPKI_LENGTH} bytes, got ${der.length}`);
  }
  if (!Buffer.from(der.subarray(0, ED25519_SPKI_PREFIX.length)).equals(ED25519_SPKI_PREFIX)) {
    throw new Error("SPKI prefix is not the Ed25519 one");
  }
  return Uint8Array.from(der.subarray(ED25519_SPKI_PREFIX.length));
}

/** Throws unless `pem` is exactly the 44-byte Ed25519 SPKI form. */
export function rawPublicKeyFromSpkiPem(pem: string): Uint8Array {
  const lines = pem.trim().split(/\r?\n/);
  if (
    lines.length < 3 ||
    lines[0] !== "-----BEGIN PUBLIC KEY-----" ||
    lines[lines.length - 1] !== "-----END PUBLIC KEY-----"
  ) {
    throw new Error("not a PUBLIC KEY PEM block");
  }
  const body = lines.slice(1, -1).join("");
  const der = Buffer.from(body, "base64");
  // Buffer's base64 decoder skips invalid characters silently: a round trip
  // is the only way to know the body was canonical base64.
  if (body.length === 0 || der.toString("base64") !== body) {
    throw new Error("PEM body is not canonical base64");
  }
  return rawPublicKeyFromSpkiDer(der);
}

function rawPublicKeyFromPrivatePem(pkcs8Pem: string): Uint8Array {
  const privateKey = createPrivateKey({ key: pkcs8Pem, format: "pem" });
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("sealed key is not an Ed25519 key");
  }
  // createPublicKey derives the public half when handed a private key.
  return rawPublicKeyFromSpkiDer(
    createPublicKey({ key: pkcs8Pem, format: "pem" }).export({ format: "der", type: "spki" }),
  );
}

function deriveSealingKey(passphrase: string, salt: Uint8Array): Buffer {
  return scryptSync(passphrase, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
}

/** scrypt (N=16384, r=8, p=1) then ChaCha20-Poly1305: salt || nonce || ciphertext || tag. */
export function sealPrivateKey(pkcs8Pem: string, passphrase: string): Uint8Array {
  const salt = randomBytes(SALT_LENGTH);
  const nonce = randomBytes(NONCE_LENGTH);
  const key = deriveSealingKey(passphrase, salt);
  try {
    const cipher = createCipheriv(SEAL_CIPHER, key, nonce, { authTagLength: TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(pkcs8Pem, "utf8"), cipher.final()]);
    return Buffer.concat([salt, nonce, ciphertext, cipher.getAuthTag()]);
  } finally {
    key.fill(0);
  }
}

/** Inverse of sealPrivateKey; throws on a wrong passphrase or an altered envelope. */
export function unsealPrivateKey(sealed: Uint8Array, passphrase: string): string {
  if (sealed.length <= SALT_LENGTH + NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("sealed envelope is too short");
  }
  const salt = sealed.subarray(0, SALT_LENGTH);
  const nonce = sealed.subarray(SALT_LENGTH, SALT_LENGTH + NONCE_LENGTH);
  const ciphertext = sealed.subarray(SALT_LENGTH + NONCE_LENGTH, sealed.length - TAG_LENGTH);
  const tag = sealed.subarray(sealed.length - TAG_LENGTH);
  const key = deriveSealingKey(passphrase, salt);
  try {
    const decipher = createDecipheriv(SEAL_CIPHER, key, nonce, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } finally {
    key.fill(0);
  }
}

export function registryEntry(input: {
  keyId: string;
  publicKeyPem: string;
  purpose: string;
  activatedAt: string;
}): RegistryEntry {
  return {
    id: input.keyId,
    algorithm: "Ed25519",
    publicKey: input.publicKeyPem.trim(),
    purpose: input.purpose,
    activatedAt: input.activatedAt,
    revokedAt: null,
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Nearest `.git` entry (directory, gitdir file or link) at `dir` or above, or
 * null. Walks the parents itself: asking git would trust a binary and a
 * configuration (GIT_DIR, GIT_CEILING_DIRECTORIES) the ceremony does not control.
 */
export async function findGitAncestor(dir: string): Promise<string | null> {
  let current: string;
  try {
    current = await realpath(resolve(dir));
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
    current = resolve(dir);
  }
  for (;;) {
    const candidate = join(current, ".git");
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT") && !hasErrorCode(error, "ENOTDIR")) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

type Mode =
  | { kind: "generate"; out: string; purpose: string; passphraseFd: number | null }
  | { kind: "dev-key"; purpose: string }
  | { kind: "public-key-only"; purpose: string }
  | { kind: "verify"; sealed: string; publicKey: string; passphraseFd: number | null };

const VALUE_OPTIONS = new Set([
  "--out",
  "--purpose",
  "--passphrase-fd",
  "--verify-sealed",
  "--public-key",
]);
const FLAG_OPTIONS = new Set(["--dev-key", "--public-key-only"]);

function parseArguments(argv: readonly string[]): Mode | { error: string } {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--passphrase" || argument.startsWith("--passphrase=")) {
      return {
        error: "a passphrase is never accepted as an argument; use the terminal or --passphrase-fd",
      };
    }
    if (FLAG_OPTIONS.has(argument)) {
      if (flags.has(argument)) return { error: `${argument} given twice` };
      flags.add(argument);
      continue;
    }
    if (VALUE_OPTIONS.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: `${argument} needs a value` };
      }
      if (values.has(argument)) return { error: `${argument} given twice` };
      values.set(argument, value);
      index += 1;
      continue;
    }
    // Never echo the argument: an operator who types a secret where an option
    // belongs (`--PASSPHRASE=…`, `--token=…`, a bare word) must not see it
    // copied to standard error, which ends up in terminal scrollback and logs.
    return { error: `unknown argument at position ${index + 1} (its text is not shown)` };
  }

  let passphraseFd: number | null = null;
  const fdText = values.get("--passphrase-fd");
  if (fdText !== undefined) {
    if (!/^\d+$/.test(fdText) || fdText === "1" || fdText === "2") {
      return { error: "--passphrase-fd takes a readable descriptor number other than 1 and 2" };
    }
    passphraseFd = Number(fdText);
  }
  const purpose = values.get("--purpose") ?? DEFAULT_PURPOSE;
  const sealed = values.get("--verify-sealed");
  const selectors = [flags.has("--dev-key"), flags.has("--public-key-only"), sealed !== undefined];
  if (selectors.filter(Boolean).length > 1) {
    return { error: "--dev-key, --public-key-only and --verify-sealed are exclusive" };
  }

  if (sealed !== undefined) {
    const publicKey = values.get("--public-key");
    if (publicKey === undefined) return { error: "--verify-sealed needs --public-key" };
    if (values.has("--out") || values.has("--purpose")) {
      return { error: "--verify-sealed takes neither --out nor --purpose" };
    }
    return { kind: "verify", sealed, publicKey, passphraseFd };
  }
  if (values.has("--public-key")) return { error: "--public-key belongs to --verify-sealed" };
  if (flags.has("--dev-key") || flags.has("--public-key-only")) {
    if (values.has("--out") || passphraseFd !== null) {
      return { error: "--dev-key and --public-key-only write nothing and read no passphrase" };
    }
    return { kind: flags.has("--dev-key") ? "dev-key" : "public-key-only", purpose };
  }
  const out = values.get("--out");
  if (out === undefined) return { error: "--out <directory> is required" };
  return { kind: "generate", out, purpose, passphraseFd };
}

const USAGE = [
  "usage: keygen-ceremony.ts --out <dir> [--purpose <text>] [--passphrase-fd <n>]",
  "       keygen-ceremony.ts --dev-key [--purpose <text>]",
  "       keygen-ceremony.ts --public-key-only [--purpose <text>]",
  "       keygen-ceremony.ts --verify-sealed <file> --public-key <pem> [--passphrase-fd <n>]",
].join("\n");

function stripOneLineEnding(text: string): string {
  if (text.endsWith("\r\n")) return text.slice(0, -2);
  if (text.endsWith("\n")) return text.slice(0, -1);
  return text;
}

type PassphraseResult = { ok: true; value: string } | { ok: false; code: number; reason: string };

async function acquirePassphrase(
  fd: number | null,
  io: CeremonyIo,
  choosing: boolean,
): Promise<PassphraseResult> {
  let value: string;
  try {
    if (fd !== null) {
      value = stripOneLineEnding(await io.readPassphraseFromFd(fd));
    } else {
      value = await io.readPassphraseFromTerminal("Passphrase: ");
      if (choosing) {
        const repeated = await io.readPassphraseFromTerminal("Repeat passphrase: ");
        if (repeated !== value) {
          return { ok: false, code: EXIT_REFUSED, reason: "the two entries differ" };
        }
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: EXIT_FAILURE, reason: `cannot read the passphrase: ${detail}` };
  }
  if (choosing && [...value].length < MINIMUM_PASSPHRASE_LENGTH) {
    return {
      ok: false,
      code: EXIT_REFUSED,
      reason: `a passphrase needs at least ${MINIMUM_PASSPHRASE_LENGTH} characters`,
    };
  }
  return { ok: true, value };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function printBanner(io: CeremonyIo, mode: Mode["kind"]): void {
  const lines = ["Ed25519 key ceremony (WP-G2-Z01): you hold the custody of the generated key."];
  if (mode === "dev-key") {
    lines.push("DEV MODE: ephemeral key, nothing written; never register it.");
  } else {
    lines.push(
      "Run offline only: no network interface, no remote access, no storage but --out.",
      "The private half is never printed and never written unsealed.",
    );
  }
  io.stderr(`${lines.join("\n")}\n\n`);
}

function generateChecked(io: CeremonyIo): { pair: GeneratedKeyPair; keyId: string } {
  const pair = io.generateKeyPair();
  const keyId = deriveKeyId(rawPublicKeyFromSpkiPem(pair.publicKeyPem));
  return { pair, keyId };
}

function printEntry(io: CeremonyIo, keyId: string, publicKeyPem: string, purpose: string): void {
  const entry = registryEntry({
    keyId,
    publicKeyPem,
    purpose,
    activatedAt: io.now().toISOString(),
  });
  io.stdout(`${JSON.stringify(entry, null, 2)}\n`);
}

async function runGenerate(mode: Extract<Mode, { kind: "generate" }>, io: CeremonyIo) {
  const outDir = resolve(mode.out);
  if (!(await io.fs.isDirectory(outDir))) {
    io.stderr(`--out ${outDir} is not an existing directory\n`);
    return EXIT_FAILURE;
  }
  let gitEntry: string | null;
  try {
    gitEntry = await findGitAncestor(outDir);
  } catch (error) {
    io.stderr(`cannot inspect the parents of --out: ${describe(error)}\n`);
    return EXIT_FAILURE;
  }
  if (gitEntry !== null) {
    io.stderr(`refused: --out is inside a git working tree (${gitEntry})\n`);
    return EXIT_REFUSED;
  }

  const passphrase = await acquirePassphrase(mode.passphraseFd, io, true);
  if (!passphrase.ok) {
    io.stderr(`refused: ${passphrase.reason}\n`);
    return passphrase.code;
  }

  let generated: { pair: GeneratedKeyPair; keyId: string };
  try {
    generated = generateChecked(io);
  } catch (error) {
    io.stderr(`generated public key has the wrong shape: ${describe(error)}\n`);
    return EXIT_FAILURE;
  }
  const { pair, keyId } = generated;
  const sealedPath = join(outDir, `${keyId}.sealed`);
  const publicPath = join(outDir, `${keyId}.pub.pem`);
  // Outside both final patterns, so an interrupted run never leaves a file
  // that looks like a finished envelope.
  const partialPath = join(outDir, `${keyId}.partial`);
  for (const target of [sealedPath, publicPath, partialPath]) {
    if (await io.fs.exists(target)) {
      io.stderr(`refused: ${target} already exists\n`);
      return EXIT_REFUSED;
    }
  }

  const written: string[] = [];
  try {
    const envelope = sealPrivateKey(pair.privateKeyPem, passphrase.value);
    await io.fs.writeExclusive(partialPath, envelope, 0o600);
    written.push(partialPath);

    const readBack = await io.fs.readFile(partialPath);
    const unsealedPublic = rawPublicKeyFromPrivatePem(unsealPrivateKey(readBack, passphrase.value));
    const generatedPublic = rawPublicKeyFromSpkiPem(pair.publicKeyPem);
    if (!Buffer.from(unsealedPublic).equals(Buffer.from(generatedPublic))) {
      throw new Error("the envelope read back does not hold the generated key");
    }

    await io.fs.renameNoClobber(partialPath, sealedPath);
    written.splice(written.indexOf(partialPath), 1, sealedPath);
    await io.fs.writeExclusive(publicPath, Buffer.from(pair.publicKeyPem, "utf8"), 0o644);
    written.push(publicPath);
  } catch (error) {
    io.stderr(`ceremony failed, removing what it wrote: ${describe(error)}\n`);
    for (const path of written.reverse()) {
      try {
        await io.fs.remove(path);
      } catch (removeError) {
        io.stderr(`could not remove ${path}: ${describe(removeError)}\n`);
      }
    }
    return EXIT_FAILURE;
  }

  io.stderr(
    [
      `key id: ${keyId}`,
      `sealed: ${sealedPath} (unsealed and checked against the public key before it was named)`,
      `public: ${publicPath}`,
      "Standard output holds the registry entry for config/signing-keys.v1.json.",
      "",
    ].join("\n"),
  );
  printEntry(io, keyId, pair.publicKeyPem, mode.purpose);
  return EXIT_OK;
}

async function runVerify(mode: Extract<Mode, { kind: "verify" }>, io: CeremonyIo) {
  let expected: Uint8Array;
  try {
    const pem = Buffer.from(await io.fs.readFile(resolve(mode.publicKey))).toString("utf8");
    expected = rawPublicKeyFromSpkiPem(pem);
  } catch (error) {
    io.stderr(`cannot read the public key: ${describe(error)}\n`);
    return EXIT_FAILURE;
  }
  // Verifying does not choose a passphrase: an envelope sealed under an
  // older, shorter one must still be checkable.
  const passphrase = await acquirePassphrase(mode.passphraseFd, io, false);
  if (!passphrase.ok) {
    io.stderr(`${passphrase.reason}\n`);
    return EXIT_FAILURE;
  }
  let unsealed: Uint8Array;
  try {
    const envelope = await io.fs.readFile(resolve(mode.sealed));
    unsealed = rawPublicKeyFromPrivatePem(unsealPrivateKey(envelope, passphrase.value));
  } catch (error) {
    io.stderr(
      `cannot unseal (wrong passphrase, altered envelope or missing cipher): ${describe(error)}\n`,
    );
    return EXIT_FAILURE;
  }
  if (!Buffer.from(unsealed).equals(Buffer.from(expected))) {
    io.stderr("MISMATCH: the envelope does not hold the key of --public-key\n");
    return EXIT_FAILURE;
  }
  io.stderr(`MATCH: the envelope holds key ${deriveKeyId(expected)}\n`);
  return EXIT_OK;
}

export async function main(argv: readonly string[], io: CeremonyIo): Promise<number> {
  const mode = parseArguments(argv);
  if ("error" in mode) {
    io.stderr(`${mode.error}\n${USAGE}\n`);
    return EXIT_USAGE;
  }
  const ciVariable = CI_VARIABLES.find((name) => io.env[name]);
  if (ciVariable !== undefined && mode.kind !== "dev-key") {
    io.stderr(
      `refused: ${ciVariable} is set. The ceremony runs offline on the owner's machine; ` +
        "pass --dev-key for an ephemeral test key.\n",
    );
    return EXIT_REFUSED;
  }
  if (mode.kind === "verify") return runVerify(mode, io);
  printBanner(io, mode.kind);
  if (mode.kind === "generate") return runGenerate(mode, io);

  let generated: { pair: GeneratedKeyPair; keyId: string };
  try {
    generated = generateChecked(io);
  } catch (error) {
    io.stderr(`generated public key has the wrong shape: ${describe(error)}\n`);
    return EXIT_FAILURE;
  }
  io.stderr(
    mode.kind === "dev-key"
      ? `dev key id: ${generated.keyId} (ephemeral, nothing written)\n`
      : `key id: ${generated.keyId} (public half only, the private half is discarded)\n`,
  );
  printEntry(io, generated.keyId, generated.pair.publicKeyPem, mode.purpose);
  return EXIT_OK;
}

const STTY_CANDIDATES = ["/bin/stty", "/usr/bin/stty"];

/**
 * Absolute path of stty, never a PATH lookup: the ceremony does not trust a
 * binary the environment chooses (same reason findGitAncestor does not run git).
 */
export function resolveStty(
  candidates: readonly string[] = STTY_CANDIDATES,
  isFile: (path: string) => boolean = (path) => existsSync(path),
): string {
  const found = candidates.find((path) => isAbsolute(path) && isFile(path));
  if (found === undefined) throw new Error(`no stty at ${candidates.join(" or ")}`);
  return found;
}

const RESTORE_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
type RestoreSignal = (typeof RESTORE_SIGNALS)[number];

export interface SignalSource {
  once(event: RestoreSignal, listener: () => void): unknown;
  removeListener(event: RestoreSignal, listener: () => void): unknown;
}

function exitOnSignal(signal: RestoreSignal): void {
  process.exit(128 + osConstants.signals[signal]);
}

/**
 * Runs `body` with the terminal altered, and calls `restore` exactly once:
 * when `body` settles, or on SIGINT/SIGTERM/SIGHUP before that. Without the
 * signal path, Ctrl-C at the passphrase prompt leaves the shell without echo.
 */
export async function withTerminalRestored<T>(
  restore: () => void,
  body: () => Promise<T>,
  source: SignalSource = process,
  onSignal: (signal: RestoreSignal) => void = exitOnSignal,
): Promise<T> {
  let restored = false;
  const restoreOnce = () => {
    if (restored) return;
    restored = true;
    restore();
  };
  const listeners = RESTORE_SIGNALS.map((signal) => {
    const listener = () => {
      restoreOnce();
      onSignal(signal);
    };
    source.once(signal, listener);
    return { signal, listener };
  });
  try {
    return await body();
  } finally {
    for (const { signal, listener } of listeners) source.removeListener(signal, listener);
    restoreOnce();
  }
}

async function readTerminalLine(handle: FileHandle): Promise<string> {
  const chunks: Buffer[] = [];
  const buffer = Buffer.alloc(256);
  let total = 0;
  for (;;) {
    // Asynchronous on purpose: a blocking read would keep the signal
    // listeners of withTerminalRestored from ever running.
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    total += bytesRead;
    if (buffer.subarray(0, bytesRead).includes(0x0a) || total > 4096) break;
  }
  buffer.fill(0);
  return stripOneLineEnding(Buffer.concat(chunks).toString("utf8"));
}

async function readHiddenFromTerminal(prompt: string): Promise<string> {
  const stty = resolveStty();
  const handle = await open("/dev/tty", "r+");
  try {
    const fd = handle.fd;
    // stty acts on its standard input: handing it the terminal descriptor
    // reads and sets the controlling terminal, without a dependency.
    const saved = spawnSync(stty, ["-g"], { stdio: [fd, "pipe", "ignore"], encoding: "utf8" });
    const state = saved.status === 0 ? saved.stdout.trim() : "";
    if (state === "") throw new Error("cannot read the terminal settings");
    await handle.write(prompt);
    return await withTerminalRestored(
      () => {
        spawnSync(stty, [state], { stdio: [fd, "ignore", "ignore"] });
        writeSync(fd, "\n");
      },
      async () => {
        const silenced = spawnSync(stty, ["-echo"], { stdio: [fd, "ignore", "ignore"] });
        if (silenced.status !== 0) throw new Error("cannot turn terminal echo off");
        return readTerminalLine(handle);
      },
    );
  } finally {
    await handle.close();
  }
}

const nodeFs: CeremonyFs = {
  async isDirectory(path) {
    try {
      return (await stat(path)).isDirectory();
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return false;
      throw error;
    }
  },
  async exists(path) {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return false;
      throw error;
    }
  },
  async writeExclusive(path, data, mode) {
    const handle = await open(path, "wx", mode);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(path, { force: true });
      throw error;
    }
    await handle.close();
  },
  async readFile(path) {
    return readFile(path);
  },
  // shortcut: check-then-rename leaves a window between the two calls, a
  // single-operator offline machine has no concurrent writer; a hard link
  // would close it but FAT32 removable media (runbook) has none.
  // Upgrade trigger: the ceremony runs where another process writes to --out.
  async renameNoClobber(from, to) {
    if (await nodeFs.exists(to)) throw new Error(`${to} already exists`);
    await rename(from, to);
  },
  async remove(path) {
    await rm(path, { force: true });
  },
};

export function createNodeIo(): CeremonyIo {
  return {
    env: process.env,
    now: () => new Date(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    readPassphraseFromFd: async (fd) => readFileSync(fd, "utf8"),
    readPassphraseFromTerminal: (prompt) => readHiddenFromTerminal(prompt),
    generateKeyPair: () => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      });
      return { privateKeyPem: privateKey, publicKeyPem: publicKey };
    },
    fs: nodeFs,
  };
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), createNodeIo());
}
