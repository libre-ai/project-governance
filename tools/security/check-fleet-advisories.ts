import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndex, PRIVATE_CROSS_REPOSITORY_NOTE } from "../../ecosystem/build-index";
import { RETRY_DELAYS_MS } from "../../ecosystem/github-fleet";
import { acquireCargoDeny, type VerifiedCargoDeny } from "../quality/check-dependency-policy";
import { concludeGate, GateReport } from "../quality/gate-report";
import {
  bunVolumeHolds,
  bunVolumeLine,
  type ContentsRead,
  classifyContentsRead,
  examineBunRepository,
  selectPublicAdvisoryRepositories,
  tallyBun,
} from "./advisories";
import {
  cargoLockPaths,
  denyAdvisoryArguments,
  examineCheckout,
  readCheckoutWaivers,
  rustVolumeLine,
} from "./rust-advisories";

// ADR-0021 D1 — the periodic fleet control that owns the state of the world.
//
// The 2026-08-04 incident it descends from: a high advisory covered the
// dependency pin of 30 of the 31 fleet repositories, and exactly one of them
// ran any audit at all. The fleet was warned by the only repository that was
// looking. This control audits every living repository's lockfile on a
// schedule and NOTIFIES — it never blocks a pull request; what a pull request
// introduces is the delta gate's question (D2, check-audit-delta).
//
// Archived repositories are skipped by construction: the archived hub carries
// the vulnerable pin in read-only history and cannot be corrected, and D30
// says no control counts it as an actionable red.
//
// Two halves, one verdict and one notification path (I-26: a periodic control
// notifies, it never blocks a merge): the Bun half below, and since 2026-10-09
// the Rust half — every tracked Cargo.lock of the served branch examined with
// cargo-deny `check advisories` (tools/security/rust-advisories.ts). Before it,
// decision Y44 had taken RustSec out of the required check and nothing looked
// at the fleet's Cargo graphs at all.
//
// `bun audit` needs package.json AND bun.lock, nothing else — verified
// empirically before this was written: the pair in an empty directory
// reproduces the advisory listing without node_modules or an install, and the
// lockfile alone is refused ("No package.json was found").

function gh(args: string[]): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, stdout: new TextDecoder().decode(result.stdout) };
}

const report = new GateReport();
const inventory = buildIndex(
  await Bun.file(new URL("../../ecosystem/repositories.v1.yaml", import.meta.url)).text(),
);
const repositories = selectPublicAdvisoryRepositories(inventory.repositories).sort();
for (const entry of inventory.repositories.filter(
  (candidate) => candidate.visibility === "private",
)) {
  report.check(entry.repository, true, PRIVATE_CROSS_REPOSITORY_NOTE);
}

// --- Bun: package.json + bun.lock of the served branch ---
//
// No `?ref=`: the contents API then reads the repository's served branch.
// A 404 is the forge's answer that the file is not there; anything else —
// 403, quota, 5xx, network, a malformed body — is a question left
// unanswered, retried and then reported as a failure, never as "no
// package.json" (classifyContentsRead). A 404 for a repository that no longer
// resolves at all is not swallowed by this half either: the Rust half below
// reads the same repository's served tree and fails on it.

function readContents(repository: string, path: string): ContentsRead {
  let read: ContentsRead = { kind: "unreadable", detail: "never attempted" };
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const call = Bun.spawnSync(
      [
        "gh",
        "api",
        `repos/${repository}/contents/${path}`,
        "-H",
        "Accept: application/vnd.github.raw",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    read = classifyContentsRead(
      call.exitCode,
      new TextDecoder().decode(call.stdout),
      new TextDecoder().decode(call.stderr),
    );
    if (read.kind !== "unreadable") return read;
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait !== undefined) Bun.sleepSync(wait);
  }
  return read;
}

function runBunAudit(repository: string, manifest: string, lockfile: string) {
  const name = repository.split("/").at(-1) ?? "repository";
  const dir = mkdtempSync(join(tmpdir(), `fleet-audit-${name}-`));
  try {
    writeFileSync(join(dir, "package.json"), manifest);
    writeFileSync(join(dir, "bun.lock"), lockfile);
    const audit = Bun.spawnSync(["bun", "audit"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    return {
      exitCode: audit.exitCode,
      output: new TextDecoder().decode(audit.stdout) + new TextDecoder().decode(audit.stderr),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const bunExaminations = repositories.map((repository) =>
  examineBunRepository(
    repository,
    (path) => readContents(repository, path),
    (manifest, lockfile) => runBunAudit(repository, manifest, lockfile),
  ),
);
for (const examination of bunExaminations) {
  report.check(examination.repository, examination.ok, examination.note);
}
const bunTally = tallyBun(repositories.length, bunExaminations);
const bunVolume = bunVolumeLine(bunTally);
if (!bunVolumeHolds(bunTally)) {
  report.check("Bun volume", false, bunVolume);
}
console.log(`Bun advisories: ${bunVolume}`);

// --- Rust: every tracked Cargo.lock of the served branch (I-26, after Y44) ---
//
// The served branch is read through the tree of `HEAD` — never a branch name
// written here — and the checkout is a shallow clone of that same HEAD, so the
// lockfile, its Cargo.toml and the deny.toml that governs it are read together
// from one commit. See rust-advisories.ts for what counts as covered.

let cargoDeny: VerifiedCargoDeny | null = null;
let cargoDenyFailure: string | null = null;
const today = new Date().toISOString().slice(0, 10);
const rust = {
  repositories: 0,
  declared: 0,
  lockfiles: 0,
  shadowed: 0,
  failed: 0,
  packages: 0,
  advisories: 0,
};

for (const repository of repositories) {
  const tree = gh([
    "api",
    `repos/${repository}/git/trees/HEAD?recursive=1`,
    "--jq",
    '{truncated: .truncated, paths: [.tree[] | select(.type == "blob") | .path]}',
  ]);
  if (!tree.ok) {
    report.check(
      `${repository} (Rust)`,
      false,
      "served tree unreadable — Cargo.lock surface unknown",
    );
    continue;
  }
  let listing: { truncated: boolean; paths: string[] };
  try {
    listing = JSON.parse(tree.stdout) as { truncated: boolean; paths: string[] };
  } catch (error) {
    report.check(
      `${repository} (Rust)`,
      false,
      `served tree unparseable — ${(error as Error).message}`,
    );
    continue;
  }
  if (listing.truncated) {
    report.check(
      `${repository} (Rust)`,
      false,
      "served tree listing truncated — Cargo.lock surface unknown",
    );
    continue;
  }
  const declared = cargoLockPaths(listing.paths);
  if (declared.length === 0) {
    report.check(
      `${repository} (Rust)`,
      true,
      "no tracked Cargo.lock — no Rust dependency surface",
    );
    continue;
  }
  rust.repositories += 1;

  if (cargoDeny === null && cargoDenyFailure === null) {
    try {
      cargoDeny = await acquireCargoDeny();
      console.log(`Rust advisories: cargo-deny ${cargoDeny.version} ${cargoDeny.origin}`);
    } catch (error) {
      cargoDenyFailure = (error as Error).message;
    }
  }
  rust.declared += declared.length;
  const failAll = (note: string) => {
    rust.failed += declared.length;
    for (const lock of declared) report.check(`${repository}:${lock}`, false, note);
    console.log(
      `Rust advisories ${repository}: ${declared.length} Cargo.lock declared — 0 examined, ${declared.length} FAILED (${note})`,
    );
  };
  if (cargoDeny === null) {
    failAll(`cargo-deny not verified — ${cargoDenyFailure}`);
    continue;
  }

  const name = repository.split("/").at(-1) ?? "repository";
  const checkout = mkdtempSync(join(tmpdir(), `fleet-rust-${name}-`));
  try {
    const clone = Bun.spawnSync(
      ["git", "clone", "--quiet", "--depth", "1", `https://github.com/${repository}.git`, checkout],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (clone.exitCode !== 0) {
      failAll("served branch could not be cloned");
      continue;
    }
    let waivers: ReturnType<typeof readCheckoutWaivers>;
    try {
      waivers = readCheckoutWaivers(checkout, today);
    } catch (error) {
      failAll(`waivers unreadable — ${(error as Error).message}`);
      continue;
    }
    const { tracked, coverage } = waivers;
    const binary = cargoDeny.binary;
    const examinations = examineCheckout(
      checkout,
      declared,
      tracked,
      (manifestPath, configPath, cwd) => {
        const run = Bun.spawnSync([binary, ...denyAdvisoryArguments(manifestPath, configPath)], {
          cwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        return {
          exitCode: run.exitCode,
          output: new TextDecoder().decode(run.stderr) + new TextDecoder().decode(run.stdout),
        };
      },
      coverage,
    );
    let packages = 0;
    const found: string[] = [];
    for (const examination of examinations) {
      report.check(`${repository}:${examination.lock}`, examination.ok, examination.note);
      if (examination.answered && !examination.shadowed) packages += examination.packages;
      found.push(...examination.uncovered);
    }
    // declared = examined + shadowed + failed: the three counters sum to the
    // lockfiles the forge lists, so none is dropped without being said.
    const examined = examinations.filter((e) => e.answered && !e.shadowed).length;
    const shadowed = examinations.filter((e) => e.shadowed).length;
    const failedCount = examinations.filter((e) => !e.answered).length;
    rust.lockfiles += examined;
    rust.shadowed += shadowed;
    rust.failed += failedCount;
    rust.packages += packages;
    rust.advisories += found.length;
    console.log(
      `Rust advisories ${repository}: ${declared.length} Cargo.lock declared — ${examined} examined, ` +
        `${shadowed} shadowed by an enclosing workspace, ${failedCount} FAILED; ` +
        `${packages} package(s) examined, ${found.length} uncovered advisory(ies)` +
        (found.length > 0 ? ` [${found.join("; ")}]` : ""),
    );
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}
cargoDeny?.dispose();

const rustVolume = rustVolumeLine({ ...rust, examined: rust.lockfiles });
if (rust.declared !== rust.lockfiles + rust.shadowed + rust.failed) {
  report.check("Rust volume", false, rustVolume);
}
// Printed whatever the verdict: a failing run must still say what it read.
const fleetVolume = `${repositories.length} public living repositories; ${bunVolume}; ${rustVolume}`;
console.log(`Fleet advisories volume — ${fleetVolume}`);
report.volume(fleetVolume);
concludeGate("Fleet advisories", report);
