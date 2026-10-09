/**
 * The contracts authority pin this crate reads, outside the Bun manifest.
 *
 * Until 2026-10-09 the pin was a root devDependency,
 * `@libre-ai/contracts-authority: github:libre-ai/schemas-and-contracts#<sha>`.
 * The composition links this repository into its consumers as a
 * `file:../project-governance` folder, and Bun resolves the development
 * dependencies of a `file:` folder: every consumer re-resolving its lockfile
 * inherited that entry — a git source written into application-development-
 * toolkit's `bun.lock`, and a `governance <-> contracts-authority` cycle that
 * made ai-work-supervision's frozen install spin forever. Nothing here executes
 * that package; two consumers read its files (the vendored-artefact drift gate
 * and the agent-run authorization test). So the pin moved to a data file the
 * composition never reads, and the files are fetched as an archive.
 *
 * Pin and integrity are unchanged: `integrity` is the very sha512 Bun recorded
 * in `bun.lock` for that git-dep, because Bun hashed the same archive this
 * module fetches (`codeload.github.com/<repository>/legacy.tar.gz/<commit>`).
 */
import { existsSync } from "node:fs";

export const PIN_PATH = "crates/ecosystem-engine/contracts-authority.pin.json";
export const CHECKOUT_DIR = ".tools/contracts-authority";
export const STAMP_PATH = `${CHECKOUT_DIR}/.pin`;
export const FETCH_COMMAND = "bun run fetch:contracts-authority";

export interface ContractsAuthorityPin {
  readonly repository: string;
  readonly commit: string;
  readonly integrity: string;
}

/** Reads and validates the pin; any defect is a named failure, never a default. */
export async function readPin(path: string = PIN_PATH): Promise<ContractsAuthorityPin> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`${path}: pin file is missing`);
  let raw: unknown;
  try {
    raw = await file.json();
  } catch (error) {
    throw new Error(`${path}: pin file is not valid JSON — ${(error as Error).message}`);
  }
  const pin = raw as Partial<Record<keyof ContractsAuthorityPin, unknown>>;
  if (typeof pin.repository !== "string" || !/^libre-ai\/[a-z0-9-]+$/.test(pin.repository)) {
    throw new Error(`${path}: "repository" must be a libre-ai repository name`);
  }
  if (typeof pin.commit !== "string" || !/^[0-9a-f]{40}$/.test(pin.commit)) {
    throw new Error(`${path}: "commit" must be a full 40-hex commit sha`);
  }
  if (typeof pin.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.integrity)) {
    throw new Error(`${path}: "integrity" must be a sha512 SRI digest`);
  }
  return { repository: pin.repository, commit: pin.commit, integrity: pin.integrity };
}

/** The stamp written after a verified extraction; the Rust test compares it too. */
export function stampFor(pin: ContractsAuthorityPin): string {
  return `${pin.repository}#${pin.commit} ${pin.integrity}\n`;
}

export type CheckoutState = "current" | "missing" | "stale";

export async function checkoutState(pin: ContractsAuthorityPin): Promise<CheckoutState> {
  if (!existsSync(`${CHECKOUT_DIR}/contracts`)) return "missing";
  const stamp = Bun.file(STAMP_PATH);
  if (!(await stamp.exists())) return "missing";
  return (await stamp.text()) === stampFor(pin) ? "current" : "stale";
}
