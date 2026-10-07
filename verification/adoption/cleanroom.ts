/**
 * Blank-room environment for the adoption reproduction loop (positioning L3).
 *
 * The loop must prove that anonymous public access is SUFFICIENT to build and
 * verify the project. Any credential or ambient identity that leaks into the
 * child environment would silently invalidate that proof (a git credential
 * helper could authenticate the clone, a token could unlock a private
 * registry). The environment is therefore built deny-by-default:
 *
 * Removed (everything not explicitly listed below), notably:
 * - tokens and API keys (GITHUB_TOKEN, *_API_KEY, NPM_TOKEN, cloud creds...);
 * - SSH agent access (SSH_AUTH_SOCK) and git identity/config overrides;
 * - the real HOME — replaced by a fresh temporary one, which removes
 *   ~/.netrc, ~/.gitconfig (credential helpers), ~/.npmrc, ~/.bun caches.
 *
 * Kept, and why:
 * - PATH: it locates the PUBLIC toolchain binaries (git, bun) an adopter is
 *   documented — or should be documented — to install;
 * - explicit toolchain homes (CARGO_HOME, RUSTUP_HOME,
 *   PLAYWRIGHT_BROWSERS_PATH): opportunistic passthrough kept for a future
 *   chain step that needs them — governance's current FOUNDATION_CHAIN
 *   (verification/harness/reference-chain.ts) spawns neither `cargo` nor a
 *   browser engine, so these currently resolve to nothing on a bare runner;
 *   pre-installed public toolchains are prerequisites, not private
 *   assistance, so passthrough (when present) does not weaken the
 *   credential boundary.
 */

import type { FrictionEntry } from "./attestation";

export interface ToolchainPassthrough {
  readonly cargoHome?: string;
  readonly rustupHome?: string;
  readonly playwrightBrowsersPath?: string;
}

export interface CleanroomOptions {
  /** Fresh, empty directory that becomes HOME for every child process. */
  readonly freshHome: string;
  readonly toolchain: ToolchainPassthrough;
}

export function buildCleanroomEnv(
  source: Readonly<Record<string, string | undefined>>,
  options: CleanroomOptions,
): Record<string, string> {
  const path = source.PATH;
  if (path === undefined || path.length === 0) {
    throw new Error("cleanroom requires a PATH to locate the public toolchain binaries");
  }
  const env: Record<string, string> = {
    PATH: path,
    HOME: options.freshHome,
    // Refuse interactive credential prompts: if anything asks for auth, the
    // run must fail loudly instead of borrowing the operator's identity.
    GIT_TERMINAL_PROMPT: "0",
    // Stable, parseable output across terminals and CI.
    NO_COLOR: "1",
  };
  if (source.TMPDIR !== undefined) {
    env.TMPDIR = source.TMPDIR;
  }
  if (options.toolchain.cargoHome !== undefined) {
    env.CARGO_HOME = options.toolchain.cargoHome;
  }
  if (options.toolchain.rustupHome !== undefined) {
    env.RUSTUP_HOME = options.toolchain.rustupHome;
  }
  if (options.toolchain.playwrightBrowsersPath !== undefined) {
    env.PLAYWRIGHT_BROWSERS_PATH = options.toolchain.playwrightBrowsersPath;
  }
  return env;
}

/**
 * Locates the reproducible digest documented in the reference-chain evidence
 * (`verification/harness/wp-g2-q01-reference-chain-evidence.md`). Reading it
 * from the CLONE keeps the published documentation the single source of
 * truth: hardcoding the digest here would fork it.
 */
export function extractExpectedDigest(evidenceMarkdown: string): string | null {
  const match = evidenceMarkdown.match(/reproducible digest[:*\s]*`([a-f0-9]{64})`/i);
  return match?.[1] ?? null;
}

export interface PublicDocs {
  readonly readme: string;
  readonly contributing: string;
}

interface PrerequisiteProbe {
  readonly step: string;
  readonly documentedWhen: RegExp;
  readonly description: string;
}

// Each probe encodes one prerequisite the loop KNOWS it needed; if neither
// README nor CONTRIBUTING mentions it, an unassisted adopter has to guess —
// that is exactly the friction the attestation exists to surface.
//
// Two probes (Playwright browsers, Rust toolchain) were retired 2026-08-19
// along with the FOUNDATION_CHAIN steps they described (verification/harness/
// reference-chain.ts's module doc has the migration citations): governance's
// post-γ reference chain never spawns `cargo` or a browser engine, so
// asserting either as an "implicit prerequisite" would itself be a false
// friction entry — worse than no entry, since the attestation's friction log
// is read as the objective backlog.
const PREREQUISITE_PROBES: readonly PrerequisiteProbe[] = [
  {
    step: "install",
    documentedWhen: /bun install/i,
    description:
      "Dependency installation is undocumented: neither README.md nor CONTRIBUTING.md states that `bun install` must run before the gates.",
  },
];

/**
 * Cross-checks the prerequisites the loop exercised against what the public
 * documents actually say. Pure by design so the check is testable without a
 * clone: callers pass the README and CONTRIBUTING contents they fetched.
 */
export function detectDocumentationFrictions(docs: PublicDocs): FrictionEntry[] {
  const corpus = `${docs.readme}\n${docs.contributing}`;
  const frictions: FrictionEntry[] = [];
  for (const probe of PREREQUISITE_PROBES) {
    if (!probe.documentedWhen.test(corpus)) {
      frictions.push({
        step: probe.step,
        kind: "implicit-prerequisite",
        description: probe.description,
      });
    }
  }
  return frictions;
}
