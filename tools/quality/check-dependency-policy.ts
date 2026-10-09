// SPDX-FileCopyrightText: 2026 Libre AI contributors
// SPDX-License-Identifier: EUPL-1.2
//
// Dependency policy gate (decisions Y43, Y44, Y47 — 2026-10-09): executes the
// calling repository's own `deny.toml` against its committed Cargo graph(s)
// with cargo-deny — `bans`, `licenses` and `sources` — from the required check.
//
// Usage, from the root of the repository to examine:
//   bun node_modules/@libre-ai/governance/tools/quality/check-dependency-policy.ts \
//     [--root=<dir>] [--manifest-path=<repository-relative Cargo.toml>]...
//
// Why it lives in the governance package (Y47): it was copied into every Rust
// repository of the fleet, so a pin, a digest or a check list changed in one
// copy and drifted in the others. Consumers now run the copy of the
// governance generation they pin, like every other tool of tools/quality.
//
// Why `advisories` is not part of the verdict (Y44): bans, licences and
// sources are a pure function of the committed Cargo.lock and deny.toml, so
// their verdict is reproducible at constant commit. The advisory verdict
// depends on the RustSec database of the day — a required check asserting it
// turns red with nothing in the tree having changed. The FORMAT of every
// `[advisories] ignore` waiver is still enforced, independently of this
// script, by tools/quality/check-advisory-waivers.ts, which the source
// composition runs on every target before its checks.
//
// Where the binary comes from: the version and the per-platform archive and
// executable digests are declared once, in toolchains/cargo-deny.json of this
// package. The source composition installs the linux-x64 binary from that
// declaration (.github/composition/install-toolchains.sh) and exports its path
// as LIBRE_AI_CARGO_DENY. When that variable is set the binary is the
// composition's: it must exist and match the declared executable digest and
// version, and a mismatch FAILS without falling back to a download — a
// fallback would make the declaration decorative. When it is not set (a
// developer machine, a workflow outside the composition), the pinned archive
// is downloaded, its digest verified, and the extracted executable verified
// against the same declaration. `cargo install` is never used: it resolves
// against a mutable registry and would change the enforcing binary between two
// runs of the same commit.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** The checks whose verdict is a function of the tree alone (Y44). */
export const REQUIRED_CHECKS = ["bans", "licenses", "sources"] as const;

/** Set by the source composition to the path of the binary it installed. */
export const PROVIDED_BINARY_ENV = "LIBRE_AI_CARGO_DENY";

/** The declaration shipped with this package (`toolchains` is in `files`). */
export const POLICY_PATH = resolve(import.meta.dir, "..", "..", "toolchains", "cargo-deny.json");

const ARCHIVE_BYTE_LIMIT = 64 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const PLATFORM_KEYS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const;

export interface CargoDenyPlatform {
  readonly triple: string;
  readonly archiveName: string;
  readonly archiveUrl: string;
  readonly archiveSha256: string;
  readonly executableRelativePath: string;
  readonly executableSha256: string;
}

export interface CargoDenyPolicy {
  readonly version: string;
  readonly platforms: Readonly<Record<string, CargoDenyPlatform>>;
}

/**
 * Parse and check the declaration before trusting it: every URL and member
 * path is derived from version and triple, so a hand edit that changes one
 * without the other is refused rather than fetched.
 */
export function parsePolicy(text: string): CargoDenyPolicy {
  const raw = JSON.parse(text) as {
    tool?: unknown;
    version?: unknown;
    platforms?: Record<string, Partial<CargoDenyPlatform>>;
  };
  if (raw.tool !== "cargo-deny") throw new Error("cargo-deny policy: tool must be 'cargo-deny'");
  const version = raw.version;
  if (typeof version !== "string" || !VERSION.test(version)) {
    throw new Error("cargo-deny policy: version must be an exact x.y.z version");
  }
  const platforms: Record<string, CargoDenyPlatform> = {};
  for (const key of PLATFORM_KEYS) {
    const entry = raw.platforms?.[key];
    if (entry === undefined) throw new Error(`cargo-deny policy: platform ${key} is not declared`);
    const triple = entry.triple ?? "";
    const archiveName = `cargo-deny-${version}-${triple}.tar.gz`;
    const expected: CargoDenyPlatform = {
      triple,
      archiveName,
      archiveUrl: `https://github.com/EmbarkStudios/cargo-deny/releases/download/${version}/${archiveName}`,
      archiveSha256: entry.archiveSha256 ?? "",
      executableRelativePath: `cargo-deny-${version}-${triple}/cargo-deny`,
      executableSha256: entry.executableSha256 ?? "",
    };
    if (!/^[a-z0-9_]+-[a-z0-9_-]+$/.test(triple)) {
      throw new Error(`cargo-deny policy: ${key}.triple is not a target triple`);
    }
    for (const field of ["archiveName", "archiveUrl", "executableRelativePath"] as const) {
      if (entry[field] !== expected[field]) {
        throw new Error(`cargo-deny policy: ${key}.${field} must be ${expected[field]}`);
      }
    }
    for (const field of ["archiveSha256", "executableSha256"] as const) {
      if (!SHA256.test(expected[field])) {
        throw new Error(`cargo-deny policy: ${key}.${field} is not a sha256 digest`);
      }
    }
    platforms[key] = expected;
  }
  return { version, platforms };
}

export function loadPolicy(path: string = POLICY_PATH): CargoDenyPolicy {
  return parsePolicy(readRequired(path, "toolchains/cargo-deny.json"));
}

export function platformFor(
  policy: CargoDenyPolicy,
  platform: string,
  arch: string,
): CargoDenyPlatform {
  const entry = policy.platforms[`${platform}-${arch}`];
  if (entry === undefined) {
    throw new Error(`No pinned cargo-deny ${policy.version} archive for ${platform}-${arch}`);
  }
  return entry;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyDigest(bytes: Uint8Array, expected: string, label: string): void {
  const actual = sha256Of(bytes);
  if (actual !== expected) {
    throw new Error(`cargo-deny ${label} digest mismatch: expected ${expected}, got ${actual}`);
  }
}

/** Number of `[[package]]` entries in a Cargo.lock — the volume the gate examined. */
export function countLockedPackages(lockText: string): number {
  return lockText.split("\n").filter((line) => line.trim() === "[[package]]").length;
}

export interface Arguments {
  readonly root: string;
  readonly manifests: readonly string[];
}

export function parseArguments(argv: readonly string[], defaultRoot: string): Arguments {
  let root = defaultRoot;
  const manifests: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith("--root=")) {
      root = resolve(argument.slice("--root=".length));
    } else if (argument.startsWith("--manifest-path=")) {
      const manifest = argument.slice("--manifest-path=".length);
      if (manifest === "" || isAbsolute(manifest) || manifest.split(/[\\/]/).includes("..")) {
        throw new Error(`--manifest-path must be repository-relative: ${manifest}`);
      }
      manifests.push(manifest);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { root, manifests: manifests.length === 0 ? ["Cargo.toml"] : manifests };
}

function readRequired(path: string, label: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    // An unreadable declared source is a failure, never an empty pass.
    throw new Error(`UNREADABLE ${label} (${path}): ${(error as Error).message}`);
  }
}

/**
 * The binary the composition declares, verified — or `null` when nothing is
 * declared. A declared binary that is missing or differs is an error: the
 * caller must not fall back to downloading another one.
 */
export function providedBinary(
  environment: Readonly<Record<string, string | undefined>>,
  entry: CargoDenyPlatform,
): string | null {
  const declared = environment[PROVIDED_BINARY_ENV];
  if (declared === undefined || declared === "") return null;
  if (!isAbsolute(declared)) {
    throw new Error(`${PROVIDED_BINARY_ENV} must be an absolute path, got ${declared}`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(declared));
  } catch (error) {
    throw new Error(
      `${PROVIDED_BINARY_ENV} declares ${declared}, which cannot be read: ${(error as Error).message} — refusing to download a substitute`,
    );
  }
  verifyDigest(bytes, entry.executableSha256, `executable (${PROVIDED_BINARY_ENV})`);
  return declared;
}

function cacheDirectory(version: string): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, "libre-ai", "cargo-deny", version);
}

async function obtainArchive(version: string, entry: CargoDenyPlatform): Promise<Uint8Array> {
  const cached = join(cacheDirectory(version), entry.archiveName);
  if (existsSync(cached)) {
    const bytes = new Uint8Array(readFileSync(cached));
    if (sha256Of(bytes) === entry.archiveSha256) return bytes;
    rmSync(cached, { force: true });
  }
  const response = await fetch(entry.archiveUrl, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Cannot download ${entry.archiveUrl}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > ARCHIVE_BYTE_LIMIT) {
    throw new Error(`cargo-deny archive exceeds ${ARCHIVE_BYTE_LIMIT} bytes`);
  }
  verifyDigest(bytes, entry.archiveSha256, "archive");
  mkdirSync(dirname(cached), { recursive: true });
  const partial = `${cached}.${process.pid}.partial`;
  writeFileSync(partial, bytes);
  renameSync(partial, cached);
  return bytes;
}

function run(command: string, args: readonly string[], cwd: string): number {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

export function denyArguments(manifestPath: string, config: string): string[] {
  return [
    "--locked",
    "--color",
    "never",
    "--manifest-path",
    manifestPath,
    "--workspace",
    "check",
    "--config",
    config,
    "--show-stats",
    ...REQUIRED_CHECKS,
  ];
}

export async function main(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  // The repository examined is the caller's working directory, never this
  // package's location: consumers run the copy under node_modules.
  const { root, manifests } = parseArguments(argv, process.cwd());
  const config = join(root, "deny.toml");
  readRequired(config, "deny.toml");
  let lockedPackages = 0;
  for (const manifest of manifests) {
    const manifestPath = join(root, manifest);
    readRequired(manifestPath, manifest);
    const lock = join(dirname(manifestPath), "Cargo.lock");
    lockedPackages += countLockedPackages(readRequired(lock, `${dirname(manifest)}/Cargo.lock`));
  }

  const policy = loadPolicy();
  const entry = platformFor(policy, process.platform, process.arch);
  const provided = providedBinary(environment, entry);
  const scratch = provided === null ? mkdtempSync(join(tmpdir(), "cargo-deny-")) : null;
  try {
    let binary: string;
    let origin: string;
    if (provided !== null) {
      binary = provided;
      origin = `provided by the composition at ${provided}`;
    } else {
      const bytes = await obtainArchive(policy.version, entry);
      const tarball = join(scratch as string, entry.archiveName);
      writeFileSync(tarball, bytes);
      if (run("tar", ["-xzf", tarball, "-C", scratch as string], scratch as string) !== 0) {
        throw new Error("Cannot extract the cargo-deny archive");
      }
      binary = join(scratch as string, entry.executableRelativePath);
      verifyDigest(new Uint8Array(readFileSync(binary)), entry.executableSha256, "executable");
      origin = `downloaded, archive sha256 ${entry.archiveSha256}`;
    }
    const version = spawnSync(binary, ["--version"], { encoding: "utf8" });
    if (version.status !== 0 || version.stdout.trim() !== `cargo-deny ${policy.version}`) {
      throw new Error(
        `Unexpected cargo-deny binary: ${version.stdout ?? ""}${version.stderr ?? ""}`,
      );
    }

    for (const manifest of manifests) {
      console.log(`cargo-deny ${policy.version} check: ${manifest} with deny.toml`);
      const status = run(binary, denyArguments(join(root, manifest), config), root);
      if (status !== 0) {
        console.error(`Dependency policy FAILED for ${manifest} (cargo-deny exit ${status}).`);
        return 1;
      }
    }
    console.log(
      `Dependency policy verified: ${REQUIRED_CHECKS.join(", ")} hold for ` +
        `${manifests.length} manifest(s) and deny.toml read, ${lockedPackages} locked package(s) inspected ` +
        `(cargo-deny ${policy.version} ${origin}, executable sha256 ${entry.executableSha256}).`,
    );
    return 0;
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
