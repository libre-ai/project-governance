// Repository names retired by the authority consolidation are never referenced
// operationally again (ADR-0041, the 2026-10-07 consolidation).
//
// `check-retired-names.ts` guards a DIFFERENT list — retired *tooling* names
// (ADR-0008 §3, LEXICON §6.1) — and a different surface: workspace directories
// and manifest `name` fields. Neither it nor any other gate looked at a
// reference to a retired REPOSITORY. The consolidation's renames were encoded
// in exactly two places, both narrow: the authority-pointer regex of
// `ecosystem/check-context-conformance.ts` (two current names, as an
// allow-list) and `RETIRED_AUTHORITY` of `ecosystem/check-fleet-pins.ts` (one
// name, in `uses:` lines only). That gap is the one that let `llms.txt` — the
// machine entry point — route 21 of its 34 URLs at a deleted repository and
// serve a 37-entry inventory for twenty-six days.
//
// WHAT IS SCANNED, and why prose is not. The doctrine of this repository
// explicitly permits a historical mention: the context template's line stating
// that historical responsibilities remain with a named former repository, and
// no transfer is inferred, is legitimate text. So the guard looks only for
// forms that are supposed to RESOLVE or to be CONSUMED — an owner-qualified
// GitHub or raw-content URL, a workflow step reference, a GitHub-protocol git
// dependency, and the value of one of the structured keys listed in
// `OPERATIONAL_KEYS`. Measured on the served branch at 2026-10-08: a pattern
// that also caught prose reported 310 occurrences on 286 lines of 76 non-test
// sources, none of them actionable; the four forms below report 62 lines.
//
// WHAT IS DELIBERATELY ABSENT from the scan. Test sources and fixtures: a
// fixture naming a retired repository is sample input, and this gate's own
// tests must be able to write the forms it detects. The consequence is stated
// rather than hidden — a real operational reference inside a test file is not
// caught here.
//
// WHY THIS GUARD DOES NOT NEED TO EXEMPT ITS OWN LIST. `check-resolved-refs.ts`
// had to describe its forms without reproducing them, because its patterns
// match the very strings its documentation wanted to quote. The list below is
// made of BARE repository names and every form requires an owner-qualified
// prefix, so the data cannot match itself. Only prose examples could, which is
// why the forms above are described and not written out.

export const RETIRED_REPOSITORY_NAMES = [
  "governance",
  "contracts",
  "authz-biscuit",
  "orchestrator",
  "harness",
  "sdk-rs",
  "sdk-ts",
  "envelope",
  "auth",
  "data",
  "ui",
  "starter",
  "knowledge",
  "classification",
  "ecosystem-engine",
  "db-inspect",
] as const;

// `libre-ai` itself is absent by design: the hub is archived read-only, not
// retired, and `ecosystem/FORGOTTEN.yaml` anchors its recovery commits there.
// `website` is absent for the reason ADR-0020 §2.4 already records for the
// tooling list: its name was regularised, not retired.

const ORGANISATION = "libre-ai";

/**
 * Structured keys whose value names a repository the reader is expected to
 * reach. A key outside this set is prose as far as this guard is concerned.
 */
export const OPERATIONAL_KEYS = [
  "repository",
  "repo",
  "pinned",
  "tooling_ref",
  "anchor_repository",
  "depends_on",
  "source",
  "template_repository",
  "home",
  "upstream",
] as const;

export type OperationalForm =
  | "resolvable-url"
  | "workflow-uses"
  | "git-dependency"
  | "structured-field";

export interface RetiredReference {
  readonly path: string;
  readonly line: number;
  readonly name: string;
  readonly form: OperationalForm;
}

/**
 * Files allowed to carry an operational form, each with the reason it is
 * allowed — data, like the `citation_allowlist` of `ecosystem/FORGOTTEN.yaml`.
 * An entry ending in `/` authorises a whole subtree. A bare path with no
 * reason is refused by `assertAllowlistReasons`: an authorisation without a
 * reason is how an allow-list becomes a place to hide findings.
 */
export const HISTORICAL_ALLOWLIST: readonly { readonly path: string; readonly reason: string }[] = [
  {
    path: "docs/adr/",
    reason:
      "an accepted ADR records the state at its date; rewriting a name inside one would falsify the decision it is. Superseding happens in a later ADR, never by edit",
  },
  {
    path: "docs/superpowers/plans/",
    reason: "dated plans, closed at their date, kept as the record of what was planned",
  },
  {
    path: "distribution/evidence/",
    reason:
      "dated evidence artefacts, each named for the day it was produced; their content is a measurement and is not re-measured by renaming it",
  },
  {
    path: "ecosystem/cards/method.project.v1.yaml",
    reason:
      "two dated evidence citations (2026-08-19) of pull requests merged in a since-deleted repository. They sit inside YAML folded scalars, where a line marker would become part of the evidence text, so the authorisation is recorded here instead of on the line",
  },
];

/** A line may authorise itself, but only with a reason written after the marker. */
export const AUTHORIZATION_MARKER = "retired-repository-ok:";

/**
 * True only when the marker is present AND followed by a non-empty reason. A
 * bare marker is not an authorisation: it says that someone knew, not why.
 */
export function isAuthorizedLine(line: string): boolean {
  const at = line.indexOf(AUTHORIZATION_MARKER);
  if (at < 0) return false;
  return line.slice(at + AUTHORIZATION_MARKER.length).trim().length > 0;
}

export function isAllowlisted(path: string): boolean {
  return HISTORICAL_ALLOWLIST.some((entry) =>
    entry.path.endsWith("/") ? path.startsWith(entry.path) : path === entry.path,
  );
}

/** Every allow-list entry carries a reason; the gate refuses to run otherwise. */
export function assertAllowlistReasons(
  entries: readonly { readonly path: string; readonly reason: string }[] = HISTORICAL_ALLOWLIST,
): string[] {
  return entries.filter((entry) => entry.reason.trim().length === 0).map((entry) => entry.path);
}

/**
 * A test source, excluded from the scan: a fixture naming a retired repository
 * is sample input, and this guard's own tests must be able to write the forms
 * it detects.
 */
export function isTestSource(path: string): boolean {
  return /(^|\/)(tests?|fixtures?|__tests__)\//.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path);
}

function patterns(): readonly { readonly form: OperationalForm; readonly source: string }[] {
  const names = RETIRED_REPOSITORY_NAMES.join("|");
  const owner = `${ORGANISATION}/(${names})`;
  const end = String.raw`(?=[/@?#\s"'\`)\],;:.]|$)`;
  const keys = OPERATIONAL_KEYS.join("|");
  return [
    {
      form: "resolvable-url",
      source: String.raw`https?://(?:github\.com|raw\.githubusercontent\.com)/${owner}${end}`,
    },
    { form: "workflow-uses", source: String.raw`^[ \t]*(?:-[ \t]+)?uses:[ \t]*${owner}${end}` },
    { form: "git-dependency", source: String.raw`github:${owner}${end}` },
    {
      form: "structured-field",
      source:
        String.raw`^[ \t]*(?:-[ \t]+)?["']?(?:${keys})["']?[ \t]*[:=][ \t]*["']?` +
        String.raw`(?:https?://(?:github\.com|raw\.githubusercontent\.com)/)?${owner}${end}`,
    },
  ];
}

/**
 * Pure: takes the files, returns the operational references. No filesystem, no
 * network, no git — so every form above is testable on a string.
 */
export function findOperationalReferences(
  files: readonly { readonly path: string; readonly text: string }[],
): RetiredReference[] {
  const compiled = patterns().map((pattern) => ({
    form: pattern.form,
    regex: new RegExp(pattern.source, "g"),
  }));
  const seen = new Set<string>();
  const references: RetiredReference[] = [];
  for (const file of files) {
    if (isTestSource(file.path) || isAllowlisted(file.path)) continue;
    const lines = file.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (isAuthorizedLine(line)) continue;
      for (const { form, regex } of compiled) {
        regex.lastIndex = 0;
        for (const match of line.matchAll(regex)) {
          const name = match[1] as string;
          const key = `${file.path}:${index + 1}:${name}:${form}`;
          if (seen.has(key)) continue;
          seen.add(key);
          references.push({ path: file.path, line: index + 1, name, form });
        }
      }
    }
  }
  return references;
}

const READABLE = /\.(md|ya?ml|json|jsonc|ts|tsx|rs|toml|txt|sh|sql)$/;

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("./gate-report");
  const report = new GateReport();

  const tracked = (await new Response(Bun.spawn(["git", "ls-files"]).stdout).text())
    .split("\n")
    .filter(Boolean)
    .filter((path) => READABLE.test(path));
  const files = await Promise.all(
    tracked.map(async (path) => ({ path, text: await Bun.file(path).text() })),
  );
  const scanned = files.filter((file) => !isTestSource(file.path) && !isAllowlisted(file.path));

  for (const path of assertAllowlistReasons()) {
    report.check(path, false, "allow-list entry without a reason: an authorisation must say why");
  }

  // A guard that examined nothing proves nothing — the rule
  // `tools/quality/gate-report.ts` exists for, applied to this guard's own
  // corpus rather than only to its findings.
  if (scanned.length === 0) {
    report.check(
      "tracked sources",
      false,
      "the scan read no file: git listed nothing readable outside tests and the allow-list, so this guard's green line would carry no evidence",
    );
  }

  for (const reference of findOperationalReferences(files)) {
    report.check(
      `${reference.path}:${reference.line}`,
      false,
      `[${reference.form}] names the retired repository "${ORGANISATION}/${reference.name}", retired by the 2026-10-07 consolidation (ADR-0041): the reference cannot resolve. Point it at the current repository, or authorise the line with "${AUTHORIZATION_MARKER} <reason>" when the mention is historical`,
    );
  }

  if (report.violations.length === 0 && scanned.length > 0) {
    report.check(
      "operational references",
      true,
      `no tracked source outside the allow-list names a retired repository in a form meant to resolve`,
    );
  }

  report.volume(
    `${scanned.length} of ${files.length} readable tracked source(s) scanned (tests and ` +
      `${HISTORICAL_ALLOWLIST.length} historical surface(s) excluded), against ` +
      `${RETIRED_REPOSITORY_NAMES.length} retired repository name(s) in ` +
      `${patterns().length} operational form(s)`,
  );
  concludeGate("Retired repository names", report);
}
