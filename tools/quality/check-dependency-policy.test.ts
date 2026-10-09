// SPDX-FileCopyrightText: 2026 Libre AI contributors
// SPDX-License-Identifier: EUPL-1.2

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  countLockedPackages,
  denyArguments,
  loadPolicy,
  main,
  PROVIDED_BINARY_ENV,
  parseArguments,
  parsePolicy,
  platformFor,
  providedBinary,
  REQUIRED_CHECKS,
  sha256Of,
  verifyDigest,
} from "./check-dependency-policy";

const REPOSITORY = resolve(import.meta.dir, "..", "..");
const POLICY_TEXT = readFileSync(join(REPOSITORY, "toolchains", "cargo-deny.json"), "utf8");

function withScratch<T>(body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "dependency-policy-"));
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("toolchains/cargo-deny.json", () => {
  test("pins the CI runner archive to the fleet template digest", () => {
    const entry = platformFor(loadPolicy(), "linux", "x64");
    expect(entry.triple).toBe("x86_64-unknown-linux-musl");
    expect(entry.archiveSha256).toBe(
      "5ea64ae09959b5fe1072d898f95caaa89b374678ba6728d5e9ed1366745479b0",
    );
    expect(entry.archiveUrl).toBe(
      "https://github.com/EmbarkStudios/cargo-deny/releases/download/0.19.5/cargo-deny-0.19.5-x86_64-unknown-linux-musl.tar.gz",
    );
    expect(entry.executableRelativePath).toBe(
      "cargo-deny-0.19.5-x86_64-unknown-linux-musl/cargo-deny",
    );
  });

  test("the fleet template declares the same archive and digest as the policy", () => {
    const template = readFileSync(
      join(REPOSITORY, ".github", "workflows", "reusable-dependency-policy.yml"),
      "utf8",
    );
    const entry = platformFor(loadPolicy(), "linux", "x64");
    expect(template).toContain(`CARGO_DENY_ARCHIVE_URL: ${entry.archiveUrl}`);
    expect(template).toContain(`CARGO_DENY_ARCHIVE_SHA256: ${entry.archiveSha256}`);
  });

  test("refuses a platform without a pinned digest", () => {
    expect(() => platformFor(loadPolicy(), "win32", "x64")).toThrow("No pinned cargo-deny");
  });

  test("refuses a URL that does not follow from version and triple", () => {
    const raw = JSON.parse(POLICY_TEXT);
    raw.platforms["linux-x64"].archiveUrl = raw.platforms["linux-x64"].archiveUrl.replace(
      "EmbarkStudios",
      "attacker",
    );
    expect(() => parsePolicy(JSON.stringify(raw))).toThrow("linux-x64.archiveUrl must be");
  });

  test("refuses a missing platform and a malformed digest", () => {
    const missing = JSON.parse(POLICY_TEXT);
    delete missing.platforms["darwin-arm64"];
    expect(() => parsePolicy(JSON.stringify(missing))).toThrow("darwin-arm64 is not declared");
    const malformed = JSON.parse(POLICY_TEXT);
    malformed.platforms["linux-x64"].executableSha256 = "0";
    expect(() => parsePolicy(JSON.stringify(malformed))).toThrow("not a sha256 digest");
  });
});

describe("verifyDigest", () => {
  test("accepts matching bytes and rejects altered bytes", () => {
    const bytes = new TextEncoder().encode("archive");
    expect(() => verifyDigest(bytes, sha256Of(bytes), "archive")).not.toThrow();
    expect(() =>
      verifyDigest(new TextEncoder().encode("archivf"), sha256Of(bytes), "archive"),
    ).toThrow("digest mismatch");
  });
});

describe("countLockedPackages", () => {
  test("counts every [[package]] entry", () => {
    const lock = 'version = 4\n\n[[package]]\nname = "a"\n\n[[package]]\nname = "b"\n';
    expect(countLockedPackages(lock)).toBe(2);
    expect(countLockedPackages("version = 4\n")).toBe(0);
  });
});

describe("denyArguments", () => {
  test("checks bans, licenses and sources only — advisories are out of the verdict (Y44)", () => {
    const args = denyArguments("/repo/Cargo.toml", "/repo/deny.toml");
    expect(args.slice(-3)).toEqual(["bans", "licenses", "sources"]);
    expect(args).not.toContain("advisories");
    expect([...REQUIRED_CHECKS]).toEqual(["bans", "licenses", "sources"]);
    expect(args.slice(0, 2)).toEqual(["--locked", "--color"]);
  });
});

describe("parseArguments", () => {
  test("defaults to the root manifest", () => {
    expect(parseArguments([], "/repo")).toEqual({ root: "/repo", manifests: ["Cargo.toml"] });
  });

  test("refuses a manifest outside the repository", () => {
    expect(() => parseArguments(["--manifest-path=../x/Cargo.toml"], "/repo")).toThrow(
      "repository-relative",
    );
    expect(() => parseArguments(["--manifest-path=/x/Cargo.toml"], "/repo")).toThrow(
      "repository-relative",
    );
    expect(() => parseArguments(["--unknown"], "/repo")).toThrow("Unknown argument");
  });
});

describe("providedBinary", () => {
  const entry = platformFor(loadPolicy(), "linux", "x64");

  test("nothing declared means the caller may download", () => {
    expect(providedBinary({}, entry)).toBeNull();
    expect(providedBinary({ [PROVIDED_BINARY_ENV]: "" }, entry)).toBeNull();
  });

  test("a declared but missing binary fails instead of falling back", () => {
    withScratch((root) => {
      expect(() =>
        providedBinary({ [PROVIDED_BINARY_ENV]: join(root, "cargo-deny") }, entry),
      ).toThrow("refusing to download a substitute");
    });
  });

  test("a declared binary with another digest is refused", () => {
    withScratch((root) => {
      const path = join(root, "cargo-deny");
      writeFileSync(path, "not cargo-deny");
      expect(() => providedBinary({ [PROVIDED_BINARY_ENV]: path }, entry)).toThrow(
        "digest mismatch",
      );
    });
  });

  test("a declared binary matching the policy digest is used", () => {
    withScratch((root) => {
      const path = join(root, "cargo-deny");
      const bytes = new TextEncoder().encode("fixture binary");
      writeFileSync(path, bytes);
      const fixture = { ...entry, executableSha256: sha256Of(bytes) };
      expect(providedBinary({ [PROVIDED_BINARY_ENV]: path }, fixture)).toBe(path);
    });
  });

  test("a relative declaration is refused", () => {
    expect(() => providedBinary({ [PROVIDED_BINARY_ENV]: "cargo-deny" }, entry)).toThrow(
      "absolute path",
    );
  });
});

describe("main", () => {
  test("fails on a missing deny.toml instead of passing an empty graph", async () => {
    const root = mkdtempSync(join(tmpdir(), "dependency-policy-"));
    try {
      await expect(main([`--root=${root}`], {})).rejects.toThrow("UNREADABLE deny.toml");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("fails on a missing Cargo.lock", async () => {
    const root = mkdtempSync(join(tmpdir(), "dependency-policy-"));
    try {
      writeFileSync(join(root, "deny.toml"), "[licenses]\n");
      writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
      await expect(main([`--root=${root}`], {})).rejects.toThrow("UNREADABLE ./Cargo.lock");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a composition-declared binary that is missing fails before any download", async () => {
    const root = mkdtempSync(join(tmpdir(), "dependency-policy-"));
    try {
      writeFileSync(join(root, "deny.toml"), "[licenses]\n");
      writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
      writeFileSync(join(root, "Cargo.lock"), "version = 4\n");
      const environment = { [PROVIDED_BINARY_ENV]: join(root, "absent", "cargo-deny") };
      await expect(main([`--root=${root}`], environment)).rejects.toThrow(
        "refusing to download a substitute",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("advisory waiver format (#56) stays enforced although advisories left the verdict", () => {
  test("the composition runs check-advisory-waivers on the target before its checks", () => {
    const workflow = readFileSync(
      join(REPOSITORY, ".github", "workflows", "validate-composition.yml"),
      "utf8",
    );
    const waivers = workflow.indexOf("bun tooling/tools/quality/check-advisory-waivers.ts");
    const checks = workflow.indexOf("--phase check");
    expect(waivers).toBeGreaterThan(-1);
    expect(checks).toBeGreaterThan(waivers);
  });

  test("this repository's own check runs it too", () => {
    const manifest = JSON.parse(readFileSync(join(REPOSITORY, "package.json"), "utf8"));
    expect(manifest.scripts.check).toContain("check:advisory-waivers");
    expect(manifest.scripts["check:advisory-waivers"]).toContain("check-advisory-waivers.ts");
  });
});
