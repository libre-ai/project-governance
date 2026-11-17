import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  getCiphers,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { EventEmitter } from "node:events";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import {
  type CeremonyFs,
  type CeremonyIo,
  createNodeIo,
  deriveKeyId,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_USAGE,
  findGitAncestor,
  type GeneratedKeyPair,
  main,
  rawPublicKeyFromSpkiPem,
  registryEntry,
  resolveStty,
  sealPrivateKey,
  unsealPrivateKey,
  withTerminalRestored,
} from "./keygen-ceremony";

/**
 * Every key below is a throwaway test key built in memory; nothing here is,
 * or may become, a production key.
 *
 * Expected values come from outside the code under test:
 * - RFC 8032 §7.1 TEST 1 gives the seed and the public key;
 * - the expected identifier is `ed25519-` (signing-keys.v1, rule K3) and the
 *   SHA-256 of those 32 public bytes computed by an independent tool:
 *   printf d75a9801…511a | xxd -r -p | shasum -a 256
 * - the Ed25519 SPKI prefix is RFC 8410 §4;
 * - the registry entry is judged by the signing-keys.v1 schema of the contracts
 *   authority, copied byte for byte under ./fixtures/signing-keys-v1 (origin.json
 *   names the repository, the commit and each file's SHA-256).
 */
const RFC8032_TEST1_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC8032_TEST1_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const RFC8032_TEST1_KEY_ID =
  "ed25519-21fe31dfa154a261626bf854046fd2271b7bed4b6abe45aa58877ef47f9721b9";
const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

// Required members of a signing-keys.v1 key, from the contract (SEMANTICS.md, registry table).
const REGISTRY_KEY_MEMBERS = [
  "activatedAt",
  "algorithm",
  "artifactTypes",
  "publicKey",
  "purpose",
  "revokedAt",
  "signingKeyId",
  "witness",
];

const CONTRACT_DIR = join(import.meta.dir, "fixtures", "signing-keys-v1");
interface ContractOrigin {
  commit: string;
  files: { path: string; source: string; sha256: string }[];
}
const CONTRACT_ORIGIN: ContractOrigin = JSON.parse(
  readFileSync(join(CONTRACT_DIR, "origin.json"), "utf8"),
);

/** Validator of a whole signing-keys.v1 registry, built from the vendored contract. */
function registryValidator(): (registry: unknown) => boolean {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const file of CONTRACT_ORIGIN.files) {
    ajv.addSchema(JSON.parse(readFileSync(join(CONTRACT_DIR, file.path), "utf8")));
  }
  const validate = ajv.getSchema(
    "https://contracts.libre-ai.fr/schemas/signing-keys.v1.schema.json",
  );
  if (validate === undefined) throw new Error("signing-keys.v1 schema not loaded");
  return (registry) => validate(registry) === true;
}
const isValidRegistry = registryValidator();
const registryOf = (...keys: unknown[]) => ({
  schemaVersion: "libre-ai.signing-keys.v1",
  keys,
});

const PASSPHRASE = "test-only passphrase, forty characters!!";
const OTHER_PASSPHRASE = "another test-only passphrase, also long enough";

// Sealing is AES-256-GCM, present in every runtime this repository uses, so
// every sealing case runs. ChaCha20-Poly1305 only serves reading an envelope
// of the first, unversioned format; Bun's node:crypto (BoringSSL) lacks it, so
// that one case runs only where the cipher exists, and its reverse case
// asserts the named refusal where it does not.
const LEGACY_CIPHER_AVAILABLE = getCiphers().includes("chacha20-poly1305");
const LEGACY_SKIP_NOTICE =
  "legacy envelope read skipped: 1, cipher chacha20-poly1305 unavailable in this runtime";

// Envelope format, from the runbook (docs/security/KEY-CEREMONY-RUNBOOK.md,
// "Format de l'enveloppe"), written here independently of the tool:
// version(1) = 0x01 || salt(16) || nonce(12) || ciphertext || tag(16),
// AES-256-GCM under scrypt(N=16384, r=8, p=1, 32 bytes), header as AAD.
const SPEC_VERSION = 0x01;
const SPEC_HEADER_LENGTH = 1 + 16 + 12;

function specSeal(privateKeyPem: string, passphrase: string, withAad = true): Buffer {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const header = Buffer.concat([Buffer.from([SPEC_VERSION]), salt, nonce]);
  const key = scryptSync(passphrase, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  if (withAad) cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(privateKeyPem, "utf8"), cipher.final()]);
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()]);
}

function specUnseal(envelope: Uint8Array, passphrase: string): string {
  const bytes = Buffer.from(envelope);
  const header = bytes.subarray(0, SPEC_HEADER_LENGTH);
  const key = scryptSync(passphrase, bytes.subarray(1, 17), 32, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(17, 29), {
    authTagLength: 16,
  });
  decipher.setAAD(header);
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([
    decipher.update(bytes.subarray(SPEC_HEADER_LENGTH, bytes.length - 16)),
    decipher.final(),
  ]).toString("utf8");
}

/** The `code` of the error `body` throws, or null when it does not throw. */
function thrownCode(body: () => unknown): string | null {
  try {
    body();
  } catch (error) {
    return error instanceof Error && "code" in error ? String(error.code) : "no code";
  }
  return null;
}

const CI_VARIABLES = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI", "TRAVIS", "BUILDKITE"];
const TOOL = join(import.meta.dir, "keygen-ceremony.ts");

function rfcKeyPair(): GeneratedKeyPair {
  const privateKey = createPrivateKey({
    key: Buffer.from(PKCS8_ED25519_PREFIX + RFC8032_TEST1_SEED, "hex"),
    format: "der",
    type: "pkcs8",
  });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return {
    privateKeyPem,
    publicKeyPem: createPublicKey({ key: privateKeyPem, format: "pem" })
      .export({ format: "pem", type: "spki" })
      .toString(),
  };
}

function randomKeyPair(): GeneratedKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

function pemOf(der: Uint8Array): string {
  const body = Buffer.from(der).toString("base64");
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

const temporary: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "keygen-ceremony-test-"));
  temporary.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  io: CeremonyIo;
  stdout(): string;
  stderr(): string;
  calls: string[];
}

function harness(
  options: {
    env?: Record<string, string>;
    fd?: string;
    terminal?: string[];
    now?: Date;
    keyPair?: GeneratedKeyPair;
    wrapFs?: (base: CeremonyFs) => CeremonyFs;
  } = {},
): Harness {
  let out = "";
  let err = "";
  const calls: string[] = [];
  const base = createNodeIo().fs;
  const recorded: CeremonyFs = {
    isDirectory: (path) => base.isDirectory(path),
    exists: (path) => base.exists(path),
    async writeExclusive(path, data, mode) {
      calls.push(`write ${basename(path)}`);
      await base.writeExclusive(path, data, mode);
    },
    async readFile(path) {
      calls.push(`read ${basename(path)}`);
      return base.readFile(path);
    },
    async renameNoClobber(from, to) {
      calls.push(`rename ${basename(from)} ${basename(to)}`);
      await base.renameNoClobber(from, to);
    },
    async remove(path) {
      calls.push(`remove ${basename(path)}`);
      await base.remove(path);
    },
  };
  const terminal = [...(options.terminal ?? [])];
  const io: CeremonyIo = {
    env: options.env ?? {},
    now: () => options.now ?? new Date("2026-11-17T10:00:00.000Z"),
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    readPassphraseFromFd: async () => {
      if (options.fd === undefined) throw new Error("no descriptor in this test");
      return options.fd;
    },
    readPassphraseFromTerminal: async () => {
      const next = terminal.shift();
      if (next === undefined) throw new Error("no terminal entry left");
      return next;
    },
    generateKeyPair: () => options.keyPair ?? rfcKeyPair(),
    fs: options.wrapFs ? options.wrapFs(recorded) : recorded,
  };
  return { io, stdout: () => out, stderr: () => err, calls };
}

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !CI_VARIABLES.includes(name)) env[name] = value;
  }
  return { ...env, ...extra };
}

function runTool(args: string[], passphraseFile: string, extraEnv: Record<string, string>) {
  const fd = openSync(passphraseFile, "r");
  try {
    return spawnSync(process.execPath, [TOOL, ...args], {
      stdio: ["ignore", "pipe", "pipe", fd],
      env: cleanEnv(extraEnv),
      encoding: "utf8",
    });
  } finally {
    closeSync(fd);
  }
}

function assertNoSecret(text: string, passphrase: string, seedHex: string): void {
  const seed = Buffer.from(seedHex, "hex");
  expect(text).not.toContain("PRIVATE KEY");
  expect(text).not.toContain(passphrase);
  expect(text.toLowerCase()).not.toContain(seedHex.toLowerCase());
  expect(text).not.toContain(seed.toString("base64"));
  expect(text).not.toContain(seed.toString("base64url"));
}

describe("module surface", () => {
  test("importing the module prints nothing and writes nothing", () => {
    const cwd = freshDir();
    const before = readdirSync(cwd);
    const result = spawnSync(process.execPath, ["-e", `await import(${JSON.stringify(TOOL)});`], {
      cwd,
      env: cleanEnv(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(readdirSync(cwd)).toEqual(before);
  });

  test("deriveKeyId is ed25519- and the SHA-256 of the RFC 8032 TEST 1 public key (K3)", () => {
    expect(deriveKeyId(Buffer.from(RFC8032_TEST1_PUBLIC, "hex"))).toBe(RFC8032_TEST1_KEY_ID);
    expect(() => deriveKeyId(new Uint8Array(31))).toThrow();
  });

  test("the printed identifier does not depend on the clock", async () => {
    const ids: string[] = [];
    for (const now of [new Date("2026-01-01T00:00:00Z"), new Date("2027-06-15T23:59:59Z")]) {
      const h = harness({ now });
      expect(await main(["--dev-key"], h.io)).toBe(EXIT_OK);
      ids.push(JSON.parse(h.stdout()).signingKeyId);
    }
    expect(ids).toEqual([RFC8032_TEST1_KEY_ID, RFC8032_TEST1_KEY_ID]);
  });

  test("rawPublicKeyFromSpkiPem accepts the Ed25519 SPKI form and nothing else", () => {
    const { publicKeyPem, privateKeyPem } = randomKeyPair();
    const raw = rawPublicKeyFromSpkiPem(publicKeyPem);
    expect(raw.length).toBe(32);
    expect(Buffer.from(rawPublicKeyFromSpkiPem(rfcKeyPair().publicKeyPem)).toString("hex")).toBe(
      RFC8032_TEST1_PUBLIC,
    );

    const x25519 = generateKeyPairSync("x25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    }).publicKey;
    const der = Buffer.from("302a300506032b6570032100", "hex");
    const valid = Buffer.concat([der, raw]);
    const tooLong = Buffer.concat([valid, Buffer.from([0])]);
    const alteredPrefix = Buffer.from(valid);
    alteredPrefix[7] = 0x71;

    expect(() => rawPublicKeyFromSpkiPem(pemOf(valid))).not.toThrow();
    expect(() => rawPublicKeyFromSpkiPem(x25519)).toThrow();
    expect(() => rawPublicKeyFromSpkiPem(pemOf(tooLong))).toThrow();
    expect(() => rawPublicKeyFromSpkiPem(pemOf(alteredPrefix))).toThrow();
    expect(() => rawPublicKeyFromSpkiPem(privateKeyPem)).toThrow();
  });

  test("findGitAncestor finds nothing above a plain temporary directory", async () => {
    expect(await findGitAncestor(freshDir())).toBeNull();
  });
});

describe("registry entry: the signing-keys.v1 contract", () => {
  const ENTRY_INPUT = {
    signingKeyId: RFC8032_TEST1_KEY_ID,
    publicKeyPem: rfcKeyPair().publicKeyPem,
    purpose: "test",
    artifactTypes: [],
    activatedAt: "2026-11-17T10:00:00.000Z",
    signatory: "key-custodian",
    witnessComment: "test key",
  } as const;

  test("the vendored contract files are byte-identical to the ones origin.json records", () => {
    expect(CONTRACT_ORIGIN.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(CONTRACT_ORIGIN.files.map((file) => file.path).sort()).toEqual(
      readdirSync(CONTRACT_DIR)
        .filter((name) => name !== "origin.json")
        .sort(),
    );
    for (const file of CONTRACT_ORIGIN.files) {
      const digest = createHash("sha256")
        .update(readFileSync(join(CONTRACT_DIR, file.path)))
        .digest("hex");
      expect([file.path, digest]).toEqual([file.path, file.sha256]);
    }
  });

  test("the contract schema discriminates: a key named `id`, or a signatory address, is refused", () => {
    const entry = registryEntry(ENTRY_INPUT);
    expect(isValidRegistry(registryOf(entry))).toBe(true);
    const { signingKeyId, ...rest } = entry;
    expect(isValidRegistry(registryOf({ id: signingKeyId, ...rest }))).toBe(false);
    expect(
      isValidRegistry(
        registryOf({ ...entry, witness: { ...entry.witness, signatory: "owner@example.org" } }),
      ),
    ).toBe(false);
  });

  test("registryEntry carries exactly the required members of a key, revokedAt null", () => {
    const entry = registryEntry({ ...ENTRY_INPUT, artifactTypes: ["release", "evidence"] });
    expect(Object.keys(entry).sort()).toEqual(REGISTRY_KEY_MEMBERS);
    expect(Object.keys(entry.witness).sort()).toEqual(["attestedAt", "comment", "signatory"]);
    expect(entry.algorithm).toBe("Ed25519");
    expect(entry.revokedAt).toBeNull();
    expect(entry.artifactTypes).toEqual(["release", "evidence"]);
    expect(isValidRegistry(registryOf(entry))).toBe(true);
  });

  test("registryEntry refuses what the contract refuses", () => {
    expect(() => registryEntry({ ...ENTRY_INPUT, signatory: "owner@example.org" })).toThrow();
    expect(() => registryEntry({ ...ENTRY_INPUT, signatory: "Key-Custodian" })).toThrow();
    expect(() => registryEntry({ ...ENTRY_INPUT, purpose: "" })).toThrow();
    expect(() => registryEntry({ ...ENTRY_INPUT, purpose: "p".repeat(257) })).toThrow();
    expect(() =>
      registryEntry({ ...ENTRY_INPUT, artifactTypes: ["release", "release"] }),
    ).toThrow();
  });

  for (const mode of [["--dev-key"], ["--public-key-only"]] as const) {
    test(`${mode[0]}: the printed entry validates signing-keys.v1, and no secret`, async () => {
      const h = harness();
      expect(await main([...mode, "--purpose", "test"], h.io)).toBe(EXIT_OK);
      const printed = JSON.parse(h.stdout());
      expect(Object.keys(printed).sort()).toEqual(REGISTRY_KEY_MEMBERS);
      expect(printed.signingKeyId).toBe(RFC8032_TEST1_KEY_ID);
      expect(printed.revokedAt).toBeNull();
      expect(printed.artifactTypes).toEqual([]);
      expect(printed.witness.signatory).toBe("key-custodian");
      expect(isValidRegistry(registryOf(printed))).toBe(true);
      assertNoSecret(h.stdout() + h.stderr(), PASSPHRASE, RFC8032_TEST1_SEED);
    });
  }

  test("--artifact-types and --signatory reach the printed entry", async () => {
    const h = harness();
    const args = [
      "--dev-key",
      "--artifact-types",
      "release,evidence",
      "--signatory",
      "release-key-custodian",
    ];
    expect(await main(args, h.io)).toBe(EXIT_OK);
    const printed = JSON.parse(h.stdout());
    expect(printed.artifactTypes).toEqual(["release", "evidence"]);
    expect(printed.witness.signatory).toBe("release-key-custodian");
    expect(isValidRegistry(registryOf(printed))).toBe(true);
  });

  for (const [shape, args, secret] of [
    ["signatory address", ["--signatory", "owner@example.org"], "owner@example.org"],
    ["signatory capitalised", ["--signatory", "Owner"], "Owner"],
    ["unknown artifact type", ["--artifact-types", "release,firmware"], "firmware"],
    ["repeated artifact type", ["--artifact-types", "build,build"], "build,build"],
    ["empty purpose", ["--purpose", ""], null],
  ] as const) {
    test(`${shape}: 2, nothing printed, the value is not echoed`, async () => {
      const h = harness();
      expect(await main(["--dev-key", ...args], h.io)).toBe(EXIT_USAGE);
      expect(h.stdout()).toBe("");
      if (secret !== null) expect(h.stderr()).not.toContain(secret);
    });
  }

  test("--verify-sealed takes no entry option", async () => {
    for (const option of ["--purpose", "--artifact-types", "--signatory"]) {
      const h = harness();
      const args = ["--verify-sealed", "x.sealed", "--public-key", "x.pem", option, "release"];
      expect([option, await main(args, h.io)]).toEqual([option, EXIT_USAGE]);
    }
  });
});

describe("refusals: exact code, nothing left in --out", () => {
  function gitInit(dir: string): void {
    const result = spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
    expect(result.status).toBe(0);
  }

  async function refused(
    args: (out: string) => string[],
    expected: number,
    options: Parameters<typeof harness>[0] = {},
    prepare: (out: string) => string = (out) => out,
  ): Promise<{ out: string; h: Harness }> {
    const out = prepare(freshDir());
    const before = readdirSync(out);
    const h = harness({ fd: PASSPHRASE, ...options });
    expect(await main(args(out), h.io)).toBe(expected);
    expect(readdirSync(out)).toEqual(before);
    expect(h.stdout()).toBe("");
    return { out, h };
  }

  test("(1) CI=true without --dev-key", async () => {
    await refused((out) => ["--out", out, "--passphrase-fd", "3"], EXIT_REFUSED, {
      env: { CI: "true" },
    });
  });

  test("(2) --out is a repository root", async () => {
    await refused(
      (out) => ["--out", out, "--passphrase-fd", "3"],
      EXIT_REFUSED,
      {},
      (dir) => {
        gitInit(dir);
        return dir;
      },
    );
  });

  test("(3) --out is a subdirectory of a repository", async () => {
    await refused(
      (out) => ["--out", out, "--passphrase-fd", "3"],
      EXIT_REFUSED,
      {},
      (dir) => {
        gitInit(dir);
        const sub = join(dir, "a", "b");
        mkdirSync(sub, { recursive: true });
        return sub;
      },
    );
  });

  test("(4) --out under a parent holding a .git file (gitdir)", async () => {
    await refused(
      (out) => ["--out", out, "--passphrase-fd", "3"],
      EXIT_REFUSED,
      {},
      (dir) => {
        writeFileSync(join(dir, ".git"), "gitdir: ./elsewhere\n");
        const sub = join(dir, "keys");
        mkdirSync(sub);
        return sub;
      },
    );
  });

  test("(5) the <id>.sealed target exists: refused, content unchanged", async () => {
    const { out } = await refused(
      (dir) => ["--out", dir, "--passphrase-fd", "3"],
      EXIT_REFUSED,
      {},
      (dir) => {
        writeFileSync(join(dir, `${RFC8032_TEST1_KEY_ID}.sealed`), "earlier envelope");
        return dir;
      },
    );
    expect(readFileSync(join(out, `${RFC8032_TEST1_KEY_ID}.sealed`), "utf8")).toBe(
      "earlier envelope",
    );
  });

  test("(6) a 31-character passphrase", async () => {
    await refused((out) => ["--out", out, "--passphrase-fd", "3"], EXIT_REFUSED, {
      fd: "a".repeat(31),
    });
  });

  test("(7) two different terminal entries", async () => {
    await refused((out) => ["--out", out], EXIT_REFUSED, {
      terminal: [PASSPHRASE, OTHER_PASSPHRASE],
    });
  });

  test("(8) --passphrase x", async () => {
    await refused((out) => ["--out", out, "--passphrase", "x"], EXIT_USAGE);
  });

  test("(9) --passphrase=x", async () => {
    await refused((out) => ["--out", out, "--passphrase=x"], EXIT_USAGE);
  });

  test("(10) --out missing outside --dev-key", async () => {
    await refused(() => ["--passphrase-fd", "3"], EXIT_USAGE);
  });

  test("(11) the envelope write fails: 1, no public file", async () => {
    await refused((out) => ["--out", out, "--passphrase-fd", "3"], EXIT_FAILURE, {
      wrapFs: (base) => ({
        ...base,
        async writeExclusive(path, data, mode) {
          if (path.endsWith(".partial")) throw new Error("injected write failure");
          await base.writeExclusive(path, data, mode);
        },
      }),
    });
  });

  test("(12) the envelope read back does not unseal: 1, temporary file removed", async () => {
    const { h } = await refused((out) => ["--out", out, "--passphrase-fd", "3"], EXIT_FAILURE, {
      wrapFs: (base) => ({
        ...base,
        async writeExclusive(path, data, mode) {
          const copy = Buffer.from(data);
          if (path.endsWith(".partial")) copy[copy.length - 1] = (copy.at(-1) ?? 0) ^ 0x01;
          await base.writeExclusive(path, copy, mode);
        },
      }),
    });
    expect(h.calls).toContain(`remove ${RFC8032_TEST1_KEY_ID}.partial`);
    expect(h.calls.some((call) => call.includes(".pub.pem"))).toBe(false);
  });
});

describe("passphrase intake through the real process", () => {
  test("the descriptor is read and the environment is not", () => {
    const out = freshDir();
    const passphraseFile = join(freshDir(), "passphrase");
    writeFileSync(passphraseFile, `${"b".repeat(31)}\n`);
    // A valid passphrase in the environment must not rescue a short one on the descriptor.
    const result = runTool(["--out", out, "--passphrase-fd", "3"], passphraseFile, {
      KEYGEN_TEST_PASSPHRASE: PASSPHRASE,
    });
    expect(result.status).toBe(EXIT_REFUSED);
    expect(result.stderr).toContain("at least 32 characters");
    expect(readdirSync(out)).toEqual([]);
  });

  test("the envelope unseals with the descriptor phrase, not the environment one", () => {
    const out = freshDir();
    const passphraseFile = join(freshDir(), "passphrase");
    writeFileSync(passphraseFile, `${OTHER_PASSPHRASE}\n`);
    const result = runTool(["--out", out, "--passphrase-fd", "3"], passphraseFile, {
      KEYGEN_TEST_PASSPHRASE: PASSPHRASE,
    });
    expect(result.status).toBe(EXIT_OK);
    const entry = JSON.parse(result.stdout);
    expect(isValidRegistry(registryOf(entry))).toBe(true);
    const sealed = readFileSync(join(out, `${entry.signingKeyId}.sealed`));
    const privatePem = unsealPrivateKey(sealed, OTHER_PASSPHRASE);
    expect(() => unsealPrivateKey(sealed, PASSPHRASE)).toThrow();
    const seed = createPrivateKey(privatePem)
      .export({ format: "der", type: "pkcs8" })
      .subarray(-32)
      .toString("hex");
    assertNoSecret(result.stdout + result.stderr, OTHER_PASSPHRASE, seed);
  });
});

describe("sealing", () => {
  test("seal then unseal returns the key; another passphrase throws", () => {
    const { privateKeyPem } = randomKeyPair();
    const sealed = sealPrivateKey(privateKeyPem, PASSPHRASE);
    expect(unsealPrivateKey(sealed, PASSPHRASE)).toBe(privateKeyPem);
    expect(() => unsealPrivateKey(sealed, OTHER_PASSPHRASE)).toThrow();
  });

  test("nominal run: envelope checked and named before the public file, no secret printed", async () => {
    const out = freshDir();
    const h = harness({ fd: `${PASSPHRASE}\n` });
    expect(await main(["--out", out, "--passphrase-fd", "3"], h.io)).toBe(EXIT_OK);
    const id = RFC8032_TEST1_KEY_ID;
    expect(h.calls).toEqual([
      `write ${id}.partial`,
      `read ${id}.partial`,
      `rename ${id}.partial ${id}.sealed`,
      `write ${id}.pub.pem`,
    ]);
    expect(readdirSync(out).sort()).toEqual([`${id}.pub.pem`, `${id}.sealed`]);
    expect(statSync(join(out, `${id}.sealed`)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(h.stdout()).signingKeyId).toBe(id);
    expect(isValidRegistry(registryOf(JSON.parse(h.stdout())))).toBe(true);
    assertNoSecret(h.stdout() + h.stderr(), PASSPHRASE, RFC8032_TEST1_SEED);
  });

  test("--verify-sealed: 0 on the right public key, 1 on another or a wrong phrase", async () => {
    const out = freshDir();
    expect(await main(["--out", out, "--passphrase-fd", "3"], harness({ fd: PASSPHRASE }).io)).toBe(
      EXIT_OK,
    );
    const sealed = join(out, `${RFC8032_TEST1_KEY_ID}.sealed`);
    const right = join(out, `${RFC8032_TEST1_KEY_ID}.pub.pem`);
    const other = join(freshDir(), "other.pub.pem");
    writeFileSync(other, randomKeyPair().publicKeyPem);
    const verify = (pem: string, phrase: string) =>
      main(
        ["--verify-sealed", sealed, "--public-key", pem, "--passphrase-fd", "3"],
        harness({ fd: phrase }).io,
      );
    expect(await verify(right, PASSPHRASE)).toBe(EXIT_OK);
    expect(await verify(other, PASSPHRASE)).toBe(EXIT_FAILURE);
    expect(await verify(right, OTHER_PASSPHRASE)).toBe(EXIT_FAILURE);
  });

  test.skipIf(!LEGACY_CIPHER_AVAILABLE)(
    "an envelope sealed the way the first version of the tool did still verifies",
    async () => {
      // Verbatim sealing routine of the tool before this lot, renamed only
      // (`git show <base>:tools/security/keygen-ceremony.ts`, function
      // sealPrivateKey): the reference format, including its createCipheriv
      // call without options, which leaves the tag length to the runtime default.
      function legacySeal(privateKeyPem: string, passphrase: string): Buffer {
        const salt = randomBytes(16);
        const iv = randomBytes(12);

        // Derive a 32-byte key from the passphrase using scrypt.
        // N=16384, r=8, p=1 is a reasonable balance for modern machines.
        const derivedKey = scryptSync(passphrase, salt, 32, {
          N: 16384,
          r: 8,
          p: 1,
          maxmem: 64 * 1024 * 1024, // 64 MB max memory
        });

        // Encrypt the private key with ChaCha20-Poly1305.
        const cipher = createCipheriv("chacha20-poly1305", derivedKey, iv);
        const ciphertext = cipher.update(privateKeyPem, "utf8");
        const finalCiphertext = Buffer.concat([ciphertext, cipher.final()]);
        const authTag = cipher.getAuthTag();

        // Return: salt || iv || ciphertext || authTag
        return Buffer.concat([salt, iv, finalCiphertext, authTag]);
      }
      const dir = freshDir();
      const pair = randomKeyPair();
      // The first version sealed under a short environment phrase: verifying
      // must not apply the 32-character rule meant for choosing one.
      const legacyPhrase = "short legacy phrase";
      writeFileSync(join(dir, "legacy.bin"), legacySeal(pair.privateKeyPem, legacyPhrase));
      writeFileSync(join(dir, "legacy.pub.pem"), pair.publicKeyPem);
      const code = await main(
        [
          "--verify-sealed",
          join(dir, "legacy.bin"),
          "--public-key",
          join(dir, "legacy.pub.pem"),
          "--passphrase-fd",
          "3",
        ],
        harness({ fd: legacyPhrase }).io,
      );
      expect(code).toBe(EXIT_OK);
    },
  );

  test.skipIf(LEGACY_CIPHER_AVAILABLE)(
    "without chacha20-poly1305, an unversioned envelope is refused by name",
    async () => {
      // 163 bytes is the only size the first version produced (16 + 12 +
      // 119-byte Ed25519 PKCS#8 PEM + 16); the content is never decrypted.
      const legacyShaped = randomBytes(16 + 12 + 119 + 16);
      expect(thrownCode(() => unsealPrivateKey(legacyShaped, PASSPHRASE))).toBe(
        "SEAL_LEGACY_CIPHER_UNAVAILABLE",
      );
      const dir = freshDir();
      writeFileSync(join(dir, "legacy.bin"), legacyShaped);
      writeFileSync(join(dir, "key.pub.pem"), rfcKeyPair().publicKeyPem);
      const h = harness({ fd: PASSPHRASE });
      const code = await main(
        [
          "--verify-sealed",
          join(dir, "legacy.bin"),
          "--public-key",
          join(dir, "key.pub.pem"),
          "--passphrase-fd",
          "3",
        ],
        h.io,
      );
      expect(code).toBe(EXIT_FAILURE);
      expect(h.stderr()).toContain("SEAL_LEGACY_CIPHER_UNAVAILABLE");
    },
  );
});

describe("envelope format: version 0x01, AES-256-GCM, header authenticated", () => {
  test("the tool's envelope follows the documented layout, read by an independent decoder", () => {
    const { privateKeyPem } = randomKeyPair();
    const sealed = Buffer.from(sealPrivateKey(privateKeyPem, PASSPHRASE));
    expect(sealed[0]).toBe(SPEC_VERSION);
    expect(sealed.length).toBe(SPEC_HEADER_LENGTH + Buffer.byteLength(privateKeyPem) + 16);
    expect(specUnseal(sealed, PASSPHRASE)).toBe(privateKeyPem);
  });

  test("an envelope built from the documented format unseals; without the header as AAD it does not", () => {
    const { privateKeyPem } = randomKeyPair();
    expect(unsealPrivateKey(specSeal(privateKeyPem, PASSPHRASE), PASSPHRASE)).toBe(privateKeyPem);
    expect(
      thrownCode(() => unsealPrivateKey(specSeal(privateKeyPem, PASSPHRASE, false), PASSPHRASE)),
    ).toBe("SEAL_AUTH_FAILED");
  });

  test("altering one header byte (version, salt, nonce) is refused", () => {
    const sealed = Buffer.from(sealPrivateKey(randomKeyPair().privateKeyPem, PASSPHRASE));
    const cases: [string, number, string][] = [
      ["version", 0, "SEAL_UNKNOWN_VERSION"],
      ["salt, first byte", 1, "SEAL_AUTH_FAILED"],
      ["salt, last byte", 16, "SEAL_AUTH_FAILED"],
      ["nonce, first byte", 17, "SEAL_AUTH_FAILED"],
      ["nonce, last byte", 28, "SEAL_AUTH_FAILED"],
    ];
    for (const [where, offset, expected] of cases) {
      const altered = Buffer.from(sealed);
      altered[offset] = (altered[offset] ?? 0) ^ 0x01;
      expect([where, thrownCode(() => unsealPrivateKey(altered, PASSPHRASE))]).toEqual([
        where,
        expected,
      ]);
    }
  });

  test("an unknown version byte is refused by name, by the function and by --verify-sealed", async () => {
    const pair = rfcKeyPair();
    const sealed = Buffer.from(sealPrivateKey(pair.privateKeyPem, PASSPHRASE));
    for (const version of [0x00, 0x02, 0xff]) {
      const other = Buffer.from(sealed);
      other[0] = version;
      expect([version, thrownCode(() => unsealPrivateKey(other, PASSPHRASE))]).toEqual([
        version,
        "SEAL_UNKNOWN_VERSION",
      ]);
    }
    const dir = freshDir();
    const unknown = Buffer.from(sealed);
    unknown[0] = 0x02;
    writeFileSync(join(dir, "unknown.sealed"), unknown);
    writeFileSync(join(dir, "key.pub.pem"), pair.publicKeyPem);
    const h = harness({ fd: PASSPHRASE });
    const code = await main(
      [
        "--verify-sealed",
        join(dir, "unknown.sealed"),
        "--public-key",
        join(dir, "key.pub.pem"),
        "--passphrase-fd",
        "3",
      ],
      h.io,
    );
    expect(code).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain("SEAL_UNKNOWN_VERSION");
  });

  test("two sealings of the same key under the same phrase draw distinct nonces and salts", () => {
    const { privateKeyPem } = randomKeyPair();
    const first = Buffer.from(sealPrivateKey(privateKeyPem, PASSPHRASE));
    const second = Buffer.from(sealPrivateKey(privateKeyPem, PASSPHRASE));
    expect(first.subarray(17, 29).equals(second.subarray(17, 29))).toBe(false);
    expect(first.subarray(1, 17).equals(second.subarray(1, 17))).toBe(false);
  });

  test("an envelope shorter than header and tag is refused by name", () => {
    expect(
      thrownCode(() => unsealPrivateKey(new Uint8Array(SPEC_HEADER_LENGTH + 16), PASSPHRASE)),
    ).toBe("SEAL_TOO_SHORT");
  });

  test("only an Ed25519 PKCS#8 PEM in its canonical form is sealed", () => {
    const { privateKeyPem } = randomKeyPair();
    const x25519 = generateKeyPairSync("x25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    }).privateKey;
    expect(() => sealPrivateKey(x25519, PASSPHRASE)).toThrow();
    expect(() => sealPrivateKey(privateKeyPem.trimEnd(), PASSPHRASE)).toThrow();
  });
});

describe("usage errors never echo an argument", () => {
  const SECRET = "hunter2-secret";
  for (const [shape, args] of [
    ["--NAME=value, upper case", [`--PASSPHRASE=${SECRET}`]],
    ["--name=value, unknown name", [`--token=${SECRET}`]],
    ["--name=value, known name", [`--out=${SECRET}`]],
    ["positional word", ["--dev-key", SECRET]],
    ["unknown --word", [`--${SECRET}`]],
  ] as const) {
    test(`${shape}: 2, the argument text is absent from stderr`, async () => {
      const h = harness();
      expect(await main(args, h.io)).toBe(EXIT_USAGE);
      expect(h.stderr()).toContain(`position ${args.length}`);
      expect(h.stderr()).not.toContain(SECRET);
      expect(h.stdout()).toBe("");
    });
  }
});

describe("terminal handling", () => {
  test("resolveStty returns an absolute candidate and never falls back to PATH", () => {
    expect(resolveStty(["/nowhere/stty", "/bin/stty"], (path) => path === "/bin/stty")).toBe(
      "/bin/stty",
    );
    expect(resolveStty(["stty", "/nowhere/stty"], () => true)).toBe("/nowhere/stty");
    expect(() => resolveStty(["stty"], () => true)).toThrow();
    expect(() => resolveStty(["/nowhere/stty"], () => false)).toThrow();
  });

  test("withTerminalRestored restores once on a signal, before the handler exits", async () => {
    const source = new EventEmitter();
    const events: string[] = [];
    let release: (value: string) => void = () => {};
    const pending = withTerminalRestored(
      () => events.push("restore"),
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
      source,
      (signal) => events.push(`exit ${signal}`),
    );
    source.emit("SIGINT");
    expect(events).toEqual(["restore", "exit SIGINT"]);
    release("line");
    expect(await pending).toBe("line");
    expect(events).toEqual(["restore", "exit SIGINT"]);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      expect(source.listenerCount(signal)).toBe(0);
    }
  });

  test("withTerminalRestored restores when the body throws, and drops its listeners", async () => {
    const source = new EventEmitter();
    let restores = 0;
    await expect(
      withTerminalRestored(
        () => {
          restores += 1;
        },
        async () => {
          throw new Error("read failed");
        },
        source,
        () => {},
      ),
    ).rejects.toThrow("read failed");
    expect(restores).toBe(1);
    expect(source.listenerCount("SIGINT")).toBe(0);
  });
});

// bun test reports skips as a bare count: the one case that depends on the
// runtime says by name whether it ran, in a test title and on stderr.
test(LEGACY_CIPHER_AVAILABLE ? "legacy envelope read: ran" : LEGACY_SKIP_NOTICE, () => {
  expect(typeof LEGACY_CIPHER_AVAILABLE).toBe("boolean");
});

afterAll(() => {
  if (!LEGACY_CIPHER_AVAILABLE) console.warn(LEGACY_SKIP_NOTICE);
});
