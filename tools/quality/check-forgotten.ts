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

export interface ForgottenEntry {
  id: string;
  evicted_paths: readonly string[];
  recoverable_at: string;
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
  const REGISTER = "ecosystem/FORGOTTEN.yaml";
  const register = parseRegister(await Bun.file(REGISTER).text());

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
  const resolve: TreeResolver = (commit) => {
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
    ...findWildForgetting(register, resolve),
  ];

  const { concludeGate, GateReport } = await import("./gate-report");
  const report = new GateReport();
  for (const finding of findings) {
    report.check(finding.entry, false, `[${finding.rule}] ${finding.detail}`);
  }
  if (findings.length > 0) {
    console.error(
      "Forgotten content resurfaced. Restoring it is an owner decision that removes its entry from the register (ADR-0019).",
    );
  } else {
    const paths = register.entries.reduce((n, entry) => n + entry.evicted_paths.length, 0);
    // An empty register is a legitimate state only if it is really empty —
    // asserting it keeps the entry count in the verdict either way.
    report.check(
      "ecosystem/FORGOTTEN.yaml",
      true,
      `${register.entries.length} entries covering ${paths} evicted paths stay out of the tree, uncited and recoverable`,
    );
  }
  concludeGate("Forgetting", report);
}
