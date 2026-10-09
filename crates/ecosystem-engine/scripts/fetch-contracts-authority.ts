/**
 * Materialises the pinned contracts authority under `.tools/contracts-authority`
 * (see `./contracts-authority.ts` for why it is not a Bun dependency).
 *
 * The archive is verified against the pinned sha512 BEFORE extraction, and its
 * listing is checked for absolute or parent-relative entries before `tar` runs.
 * A current checkout (stamp equal to the pin) is left untouched, so the gates
 * that call this first cost one file read once it has run.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { CHECKOUT_DIR, checkoutState, readPin, STAMP_PATH, stampFor } from "./contracts-authority";

function fail(message: string): never {
  console.error(`Contracts authority fetch failed: ${message}`);
  process.exit(1);
}

function countFiles(root: string): number {
  let files = 0;
  for (const name of readdirSync(root)) {
    const path = `${root}/${name}`;
    files += statSync(path).isDirectory() ? countFiles(path) : 1;
  }
  return files;
}

const pin = await readPin().catch((error: Error) => fail(error.message));
const label = `${pin.repository}#${pin.commit.slice(0, 8)}`;
const state = await checkoutState(pin);
if (state === "current") {
  console.log(`Contracts authority ${label}: checkout current (${CHECKOUT_DIR})`);
  process.exit(0);
}

const url = `https://codeload.github.com/${pin.repository}/legacy.tar.gz/${pin.commit}`;
const response = await fetch(url).catch((error: Error) => fail(`${url}: ${error.message}`));
if (!response.ok) fail(`${url}: HTTP ${response.status}`);
const archive = new Uint8Array(await response.arrayBuffer());
const digest = `sha512-${new Bun.CryptoHasher("sha512").update(archive).digest("base64")}`;
if (digest !== pin.integrity) {
  fail(`${url}: integrity mismatch — pinned ${pin.integrity}, received ${digest}`);
}

mkdirSync(".tools", { recursive: true });
const staging = `${CHECKOUT_DIR}.staging-${process.pid}`;
const archivePath = `${staging}.tgz`;
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging);
await Bun.write(archivePath, archive);

/** Extracts into `staging` and returns the file count; throws on any defect. */
function extractVerified(): number {
  const listing = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  if (listing.status !== 0) throw new Error(`tar -t: ${listing.stderr.trim()}`);
  const unsafe = listing.stdout
    .split("\n")
    .filter((entry) => entry.startsWith("/") || entry.split("/").includes(".."));
  if (unsafe.length > 0) {
    throw new Error(`archive carries unsafe entries: ${unsafe.slice(0, 3).join(", ")}`);
  }
  const extract = spawnSync("tar", ["-xzf", archivePath, "--strip-components=1", "-C", staging], {
    encoding: "utf8",
  });
  if (extract.status !== 0) throw new Error(`tar -x: ${extract.stderr.trim()}`);
  const files = countFiles(staging);
  if (files === 0) throw new Error("the verified archive extracted no file");
  return files;
}

// Cleanup runs before any exit: `process.exit` inside a `try` would skip `finally`.
let outcome: { files: number } | { error: string };
try {
  const files = extractVerified();
  rmSync(CHECKOUT_DIR, { recursive: true, force: true });
  renameSync(staging, CHECKOUT_DIR);
  await Bun.write(STAMP_PATH, stampFor(pin));
  outcome = { files };
} catch (error) {
  outcome = { error: (error as Error).message };
} finally {
  rmSync(archivePath, { force: true });
  rmSync(staging, { recursive: true, force: true });
}
if ("error" in outcome) fail(outcome.error);
console.log(
  `Contracts authority ${label}: fetched (${state}), ${archive.byteLength} bytes, ` +
    `integrity verified, ${outcome.files} files extracted to ${CHECKOUT_DIR}`,
);
