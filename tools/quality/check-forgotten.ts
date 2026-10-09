// Forgetting guard (ADR-0019). A dead choice that stays greppable comes back: an
// agent finds it, reads its `status: final` and resurfaces it as if it were live.
// `ecosystem/FORGOTTEN.yaml` records content evicted from the working tree by owner
// decision; this guard is the layer that makes the eviction hold.
//
// Three rules, all hard:
//   1. anti-resurrection — an evicted path that reappears in the tree;
//   2. anti-citation — a tracked file that names an evicted path, outside the
//      register's own allow-list, which would resurrect it by reference;
//   3. anti-wild-forgetting — an entry whose `recoverable_at` does not resolve, or
//      resolves to a commit that does not actually carry the evicted paths.
//
// Rule 3 is why eviction is not destruction: every entry must prove where its content
// still lives before the register is allowed to claim it forgotten.

import { concludeGate, GateReport } from "./gate-report";

export interface ForgottenEntry {
  id: string;
  evicted_paths: readonly string[];
  recoverable_at: string;
  /** Files the eviction removed, declared by the register: the volume one entry stands for. */
  file_count?: number;
}

export interface ForgottenRegister {
  entries: readonly ForgottenEntry[];
  citation_allowlist: readonly string[];
  /** Repository whose history anchors recoverable_at commits (hub archive since ADR-0020). */
  anchor_repository?: string;
}

export interface Finding {
  rule: "resurrection" | "citation" | "wild-forgetting";
  entry: string;
  detail: string;
}

// A citation counts whether or not it carries the trailing slash: `docs/gone/` and
// `docs/gone` name the same evicted tree. Illustrative paths only here — naming a real
// evicted path in this file would make the guard flag its own documentation.
function needle(path: string): string {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export function findResurrections(
  register: ForgottenRegister,
  trackedPaths: readonly string[],
): Finding[] {
  const findings: Finding[] = [];
  for (const entry of register.entries) {
    for (const evicted of entry.evicted_paths) {
      const prefix = evicted.endsWith("/") ? evicted : `${evicted}/`;
      for (const tracked of trackedPaths) {
        if (tracked === needle(evicted) || tracked.startsWith(prefix)) {
          findings.push({
            rule: "resurrection",
            entry: entry.id,
            detail: `${tracked} is forgotten content back in the tree`,
          });
        }
      }
    }
  }
  return findings;
}

export function findForbiddenCitations(
  register: ForgottenRegister,
  files: readonly { path: string; text: string }[],
): Finding[] {
  const allowed = new Set(register.citation_allowlist);
  const findings: Finding[] = [];
  for (const file of files) {
    if (allowed.has(file.path)) continue;
    for (const entry of register.entries) {
      for (const evicted of entry.evicted_paths) {
        if (file.text.includes(needle(evicted))) {
          findings.push({
            rule: "citation",
            entry: entry.id,
            detail: `${file.path} cites forgotten path "${needle(evicted)}"`,
          });
        }
      }
    }
  }
  return findings;
}

/** Resolves a commit to the paths it carries, or null when the object is absent. */
export type TreeResolver = (commit: string) => readonly string[] | null;

/**
 * Sentinel tree a resolver may return when the declared anchor repository is
 * unreachable (offline): presence is UNVERIFIED, not absent — the carries
 * check is skipped, and CI (which always has the network) verifies for real.
 */
export const OFFLINE_UNVERIFIED = "__offline_unverified__";

export function findWildForgetting(register: ForgottenRegister, resolve: TreeResolver): Finding[] {
  const findings: Finding[] = [];
  for (const entry of register.entries) {
    const tree = resolve(entry.recoverable_at);
    if (tree === null) {
      findings.push({
        rule: "wild-forgetting",
        entry: entry.id,
        detail: `recoverable_at ${entry.recoverable_at} does not resolve — forgotten content with no recorded home (a shallow clone also fails here: the guard needs fetch-depth 0)`,
      });
      continue;
    }
    if (tree.includes(OFFLINE_UNVERIFIED)) continue;
    for (const evicted of entry.evicted_paths) {
      const prefix = evicted.endsWith("/") ? evicted : `${evicted}/`;
      const carried = tree.some((path) => path === needle(evicted) || path.startsWith(prefix));
      if (!carried) {
        findings.push({
          rule: "wild-forgetting",
          entry: entry.id,
          detail: `recoverable_at ${entry.recoverable_at} does not carry "${evicted}"`,
        });
      }
    }
  }
  return findings;
}

/**
 * Wraps a resolver so each commit is resolved once.
 *
 * Measured on the register of 2026-10-08: four entries, three of them anchored
 * on the same commit, and the anchor repository is remote since the governance
 * split — so the gate issued three identical `gh api` calls to one URL. The key
 * is the commit and nothing else: a key that also carried the repository, or
 * the entry, would let one entry's tree answer for another entry's anchor and
 * hide an anchor that has become irresolvable.
 */
export function memoizeResolver(resolve: TreeResolver): TreeResolver {
  const seen = new Map<string, readonly string[] | null>();
  return (commit) => {
    const cached = seen.get(commit);
    if (cached !== undefined) return cached;
    if (seen.has(commit)) return null;
    const resolved = resolve(commit);
    seen.set(commit, resolved);
    return resolved;
  };
}

export const REGISTER_PATH = "ecosystem/FORGOTTEN.yaml";

/**
 * Why an empty register is a defect here and not a legitimate state.
 *
 * This repository has evicted content by owner decision since 2026-07-28
 * (ADR-0019 §4) and again on 2026-10-08 (ADR-0041 §8). An empty register
 * therefore cannot mean "nothing was ever forgotten"; it means the register was
 * emptied, or the gate stopped reading it. Either way every anti-resurrection
 * and anti-citation rule it carries silently stops applying — there is nothing
 * left to compare the tree against — while the gate keeps printing a green
 * line. Restoring evicted content is an owner decision that removes *its* entry
 * (ADR-0019 §2); it never removes all of them at once.
 */
export const EMPTY_REGISTER_NOTE =
  "the register declares no entry, so no eviction is enforced: every anti-resurrection and " +
  "anti-citation rule compares the tree against an empty set and holds vacuously. This " +
  "repository has evicted content by owner decision since 2026-07-28 (ADR-0019 §4), so an " +
  "empty register means it was emptied or is no longer being read, never that nothing was " +
  "forgotten. Restoring content removes one entry by owner decision (ADR-0019 §2), not all of them";

/**
 * The verdict: one assertion per register entry, named by that entry.
 *
 * Until 2026-10-08 success was a single `report.check(REGISTER_PATH, true, …)`
 * with a hardcoded `true`. One assertion stood for four entries and
 * fifty-seven evicted files, and `entries: []` produced that same true
 * assertion with exit 0 — the guard that forbids a resurrection could not
 * detect its own emptiness, while the eviction recorded on 2026-10-08 relies
 * on it. An entry that carries a finding fails under its own name, so the
 * failure says which eviction broke rather than only that the register did.
 */
export function buildReport(register: ForgottenRegister, findings: readonly Finding[]): GateReport {
  const report = new GateReport();
  if (register.entries.length === 0) {
    report.check(REGISTER_PATH, false, EMPTY_REGISTER_NOTE);
    return report;
  }

  const byEntry = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = byEntry.get(finding.entry);
    if (bucket === undefined) byEntry.set(finding.entry, [finding]);
    else bucket.push(finding);
  }

  for (const entry of register.entries) {
    const own = byEntry.get(entry.id) ?? [];
    if (own.length === 0) {
      const files = entry.file_count === undefined ? "" : `, ${entry.file_count} file(s) declared`;
      report.check(
        entry.id,
        true,
        `${entry.evicted_paths.length} evicted path(s)${files} stay out of the tree, uncited, and ` +
          `recoverable at ${entry.recoverable_at.slice(0, 8)}`,
      );
      continue;
    }
    for (const finding of own) {
      report.check(entry.id, false, `[${finding.rule}] ${finding.detail}`);
    }
  }

  // A finding whose entry is not in the register would otherwise be dropped on
  // the floor: nothing produces one today, and a silent loss is how a gate
  // starts lying.
  const declared = new Set(register.entries.map((entry) => entry.id));
  for (const finding of findings) {
    if (declared.has(finding.entry)) continue;
    report.check(
      finding.entry,
      false,
      `[${finding.rule}] ${finding.detail} (finding attributed to an entry absent from the register)`,
    );
  }

  const paths = register.entries.reduce((n, entry) => n + entry.evicted_paths.length, 0);
  const files = register.entries.reduce((n, entry) => n + (entry.file_count ?? 0), 0);
  // The success line names the entries, not only how many there are.
  //
  // An eviction silences other gates by construction: the files leave the
  // tree, so the gate that used to see them stops reporting on them, and
  // nothing in ITS output connects that new silence to a decision. This line
  // is where the connection lives — it is the only line a CI reader sees. Until
  // 2026-10-09 it carried the three counters and no name: the eviction of that
  // day moved them from 5/7/58 to 6/8/62, which told a reader that something
  // had been forgotten and never what. The names were already recorded, one per
  // assertion, but `GATE_VERBOSE` is the only way to read those and nobody sets
  // it in CI.
  //
  // Ids, never paths: rule 2 forbids a tracked file to name an evicted path, so
  // writing one here would make the guard flag its own source — which is why
  // every path in this file is illustrative. An id is not a path, and these are
  // read from the register at runtime, so this line stays correct for entries
  // that do not exist yet.
  //
  // No truncation threshold. Entries are appended, so any cap would hide the
  // most recent eviction — precisely the one whose arrival moved the counters,
  // and the only reason this line was changed. Measured on the register of
  // 2026-10-09: six ids are 211 characters, the whole success line 324. The
  // register grows by owner decision, a few entries a year, so a line that is
  // long before it is unreadable is the right trade. A reader who wants it
  // short can count; a reader who wants to know what was forgotten cannot
  // invent the name.
  report.volume(
    `${register.entries.length} register entr${register.entries.length === 1 ? "y" : "ies"}, ` +
      `${paths} evicted path(s), ${files} evicted file(s) declared: ` +
      register.entries.map((entry) => entry.id).join(", "),
  );
  return report;
}

export function parseRegister(source: string): ForgottenRegister {
  const parsed = Bun.YAML.parse(source) as Partial<ForgottenRegister>;
  if (!Array.isArray(parsed?.entries)) throw new Error("FORGOTTEN.yaml: missing `entries`");
  return {
    entries: parsed.entries,
    citation_allowlist: parsed.citation_allowlist ?? [],
    anchor_repository: parsed.anchor_repository,
  };
}

if (import.meta.main) {
  const register = parseRegister(await Bun.file(REGISTER_PATH).text());

  const tracked = (await new Response(Bun.spawn(["git", "ls-files"]).stdout).text())
    .split("\n")
    .filter(Boolean);

  // Text only: a binary blob cannot resurrect a path by reference, and reading the
  // whole tree as UTF-8 would be both slow and meaningless.
  const readable = tracked.filter((path) => /\.(md|ya?ml|json|ts|tsx|rs|toml|txt)$/.test(path));
  const files = await Promise.all(
    readable.map(async (path) => ({ path, text: await Bun.file(path).text() })),
  );

  // Local history first; since the governance split (ADR-0020) the anchors
  // may live in the hub archive — resolve them through the GitHub API when
  // `anchor_repository` is declared. Offline (or without `gh`), remote
  // verification is skipped with an explicit warning: CI has the network
  // and always verifies for real.
  const resolveOnce: TreeResolver = (commit) => {
    const probe = Bun.spawnSync(["git", "cat-file", "-e", `${commit}^{commit}`]);
    if (probe.exitCode === 0) {
      return new TextDecoder()
        .decode(Bun.spawnSync(["git", "ls-tree", "-r", "--name-only", commit]).stdout)
        .split("\n")
        .filter(Boolean);
    }
    const anchor = register.anchor_repository;
    if (anchor === undefined) return null;
    const remote = Bun.spawnSync([
      "gh",
      "api",
      `repos/${anchor}/git/trees/${commit}?recursive=1`,
      "--jq",
      ".tree[].path",
    ]);
    if (remote.exitCode === 0) {
      return new TextDecoder().decode(remote.stdout).split("\n").filter(Boolean);
    }
    const stderr = new TextDecoder().decode(remote.stderr);
    if (/HTTP 4\d\d/.test(stderr)) return null;
    console.warn(
      `WARN: recoverable_at ${commit} not resolvable offline (anchor ${anchor} unreachable) — CI verifies with the network.`,
    );
    return [OFFLINE_UNVERIFIED];
  };

  const findings = [
    ...findResurrections(register, tracked),
    ...findForbiddenCitations(register, files),
    ...findWildForgetting(register, memoizeResolver(resolveOnce)),
  ];

  const report = buildReport(register, findings);
  if (findings.length > 0) {
    console.error(
      "Forgotten content resurfaced. Restoring it is an owner decision that removes its entry from the register (ADR-0019).",
    );
  }
  concludeGate("Forgetting", report);
}
