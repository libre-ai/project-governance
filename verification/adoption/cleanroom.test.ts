import { describe, expect, test } from "bun:test";
import {
  buildCleanroomEnv,
  detectDocumentationFrictions,
  extractExpectedDigest,
} from "./cleanroom";

/**
 * Positioning L3 — the reproduction loop must run without any private
 * assistance: no credential, no ambient identity, no machine-specific state.
 * These tests pin the deny-by-default environment contract and the two pure
 * helpers that anchor the loop to the repository's own documentation.
 */

describe("buildCleanroomEnv", () => {
  const hostileSource = {
    PATH: "/usr/bin:/bin",
    HOME: "/operator/original-home",
    GITHUB_TOKEN: "ghp_secret",
    OPENAI_API_KEY: "sk-secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
    GIT_AUTHOR_NAME: "Someone",
    NPM_TOKEN: "npm-secret",
    TMPDIR: "/tmp/t",
  };

  test("is deny-by-default: no credential or ambient identity survives", () => {
    const env = buildCleanroomEnv(hostileSource, { freshHome: "/scrub/home", toolchain: {} });
    const keys = Object.keys(env);
    for (const banned of [
      "GITHUB_TOKEN",
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "SSH_AUTH_SOCK",
      "GIT_AUTHOR_NAME",
      "NPM_TOKEN",
    ]) {
      expect(keys).not.toContain(banned);
    }
  });

  test("keeps PATH (toolchain lookup) and replaces HOME with the fresh one", () => {
    const env = buildCleanroomEnv(hostileSource, { freshHome: "/scrub/home", toolchain: {} });
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/scrub/home");
  });

  test("forbids interactive credential prompts so anonymous access is actually proven", () => {
    const env = buildCleanroomEnv(hostileSource, { freshHome: "/scrub/home", toolchain: {} });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  test("passes through explicitly provided toolchain homes only", () => {
    const env = buildCleanroomEnv(hostileSource, {
      freshHome: "/scrub/home",
      toolchain: {
        cargoHome: "/toolchain/cargo",
        rustupHome: "/toolchain/rustup",
        playwrightBrowsersPath: "/toolchain/pw",
      },
    });
    expect(env.CARGO_HOME).toBe("/toolchain/cargo");
    expect(env.RUSTUP_HOME).toBe("/toolchain/rustup");
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("/toolchain/pw");
  });

  test("omits toolchain variables that were not provided", () => {
    const env = buildCleanroomEnv(hostileSource, { freshHome: "/scrub/home", toolchain: {} });
    expect(Object.keys(env)).not.toContain("CARGO_HOME");
    expect(Object.keys(env)).not.toContain("RUSTUP_HOME");
    expect(Object.keys(env)).not.toContain("PLAYWRIGHT_BROWSERS_PATH");
  });

  test("a source without PATH still yields a usable env (empty PATH is refused)", () => {
    expect(() => buildCleanroomEnv({}, { freshHome: "/scrub/home", toolchain: {} })).toThrow(
      /PATH/,
    );
  });
});

describe("extractExpectedDigest", () => {
  test("finds the documented reproducible digest in the harness evidence", () => {
    const markdown = [
      "# WP-G2-Q01 reference-chain evidence",
      "",
      "- **Status:** `passed`",
      `- **Reproducible digest:** \`${"f".repeat(64)}\``,
    ].join("\n");
    expect(extractExpectedDigest(markdown)).toBe("f".repeat(64));
  });

  test("returns null when no digest is documented (a friction, not a crash)", () => {
    expect(extractExpectedDigest("# Evidence\n\nNothing anchored here.")).toBeNull();
  });

  test("ignores hex strings that are not presented as the reproducible digest", () => {
    const markdown = `Some commit ${"a".repeat(64)} mentioned in passing.`;
    expect(extractExpectedDigest(markdown)).toBeNull();
  });
});

describe("detectDocumentationFrictions", () => {
  const documentedEverything = "Run `bun install` first.";

  test("finds no documentation friction when every prerequisite is documented", () => {
    expect(
      detectDocumentationFrictions({ readme: documentedEverything, contributing: "" }),
    ).toEqual([]);
  });

  test("reports bun install as an implicit prerequisite when undocumented", () => {
    const frictions = detectDocumentationFrictions({
      readme: "# Repo\nrun bun run check",
      contributing: "run the gates",
    });
    const descriptions = frictions.map((f) => f.description).join(" | ");
    expect(frictions.every((f) => f.kind === "implicit-prerequisite")).toBe(true);
    expect(descriptions).toMatch(/bun install/i);
  });

  test("searches both README and CONTRIBUTING before declaring a gap", () => {
    const frictions = detectDocumentationFrictions({
      readme: "run `bun install`",
      contributing: "",
    });
    expect(frictions).toEqual([]);
  });
});
