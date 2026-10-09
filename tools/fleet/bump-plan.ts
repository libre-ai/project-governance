/**
 * Pure planner of a governance-generation bump for one consumer repository.
 *
 * Moving the fleet to a new generation was done by hand three times on
 * 2026-10-09 (waves M, N and P, nineteen consumers each, about fifty pull
 * requests in all), and every one of those pull requests touched the same
 * small set of pin surfaces. This module turns a repository snapshot into the
 * exact edit set such a pull request carries, or into a refusal naming why it
 * cannot be computed safely. It performs no I/O: the command in
 * `bump-generation.ts` reads the fleet, this module decides.
 *
 * WHAT IS A PIN SURFACE. Each form below was observed on a merged bump pull
 * request of the P wave, and each is recognised by its own anchored rule:
 *
 *   - `uses: libre-ai/project-governance/<path>@<sha>` in a workflow;
 *   - `tooling_ref: <sha>` in a workflow;
 *   - `ref: <sha>` of a checkout step whose `repository:` is the authority
 *     (schemas-and-contracts `ci.yml`, personal-knowledge-workspace
 *     `notebook-webkit-macos.yml`);
 *   - `github:libre-ai/project-governance#<sha>` in a `package.json`, a
 *     `bun.lock` workspace entry or a project card;
 *   - the `bun.lock` resolution line, which writes the generation as a
 *     seven-character key twice and carries the tarball integrity
 *     (signalement);
 *   - `pinned: "<sha>"` without the `github:` prefix, under a card dependency
 *     whose `on:` is the authority (signalement);
 *   - a `https://github.com/libre-ai/project-governance/blob/<sha>/<path>` URL
 *     in a card or a README/AGENTS document — an evidence reference that
 *     follows the generation (signalement's attestation);
 *   - `libre-ai/project-governance/<path>@<sha>` in a toolchain allow-list
 *     (product-research `toolchains/github-actions.json`);
 *   - the eight-character prefix of the generation, word-bounded, in a
 *     README/AGENTS document.
 *
 * WHAT IT REFUSES. A plan is a claim that the edit set moves the WHOLE
 * repository and nothing else, so every doubt is a refusal, never a partial
 * edit:
 *
 *   - surfaces that disagree (two generations in one repository) — unless the
 *     other sha is a declared historical site, which is left with its reason;
 *   - an occurrence of the old sha that no rule recognised: counted
 *     independently per file, so a form this planner does not know cannot be
 *     left behind half-bumped (gate-integrity §2);
 *   - a pin on the retired authority, or a moving ref (branch, tag);
 *   - a Cargo source whose rev is coupled to a ref the composition manifest
 *     moves between the two generations: that bump needs Cargo.lock and the
 *     sdk-input-pin work of execution-sandbox#7, which is not a pin edit;
 *   - a `bun.lock` resolution whose recorded dependencies differ from the
 *     target generation's, or whose integrity could not be computed;
 *   - an evidence URL whose cited path does not exist at the target.
 */

import { collectCargoSourcePins } from "../../ecosystem/check-fleet-pins";

export const AUTHORITY = "libre-ai/project-governance";
const RETIRED_AUTHORITY = "libre-ai/governance";

const FULL_SHA = /^[0-9a-f]{40}$/;
const HEX = /[0-9a-f]/;

export type SurfaceForm =
  | "uses"
  | "tooling_ref"
  | "checkout-ref"
  | "git-dep"
  | "lock-resolution"
  | "card-pin-bare"
  | "governance-url"
  | "allowed-pattern"
  | "prose-prefix";

export interface Site {
  readonly path: string;
  /** 1-based line number. */
  readonly line: number;
  readonly form: SurfaceForm;
  /** The ref as written: a full sha, or a prefix for the short forms. */
  readonly ref: string;
  /** Cited path inside the authority, for `governance-url` only. */
  readonly citedPath?: string;
}

export interface HistoricalSite {
  readonly repository: string;
  readonly path: string;
  readonly sha: string;
  readonly reason: string;
}

export interface Snapshot {
  readonly repository: string;
  /** Repository-relative path -> exact text, for every file that was read. */
  readonly files: ReadonlyMap<string, string>;
}

export interface Left {
  readonly path: string;
  readonly line: number | null;
  readonly reason: string;
}

export interface Scan {
  readonly sites: readonly Site[];
  readonly left: readonly Left[];
  readonly refusals: readonly string[];
  /** The single generation the repository carries, or null (none, several, or unanchored). */
  readonly from: string | null;
}

const lineSplit = (text: string): string[] => text.split("\n");

const isWorkflow = (path: string): boolean => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
const isManifest = (path: string): boolean =>
  path === "package.json" || path.endsWith("/package.json");
const isLock = (path: string): boolean => path === "bun.lock" || path.endsWith("/bun.lock");
const isCard = (path: string): boolean =>
  path === "project.v1.yaml" ||
  path.endsWith(".project.v1.yaml") ||
  path.endsWith("/project.v1.yaml");
const isDocument = (path: string): boolean => /(^|\/)(README(\.[a-z]{2})?|AGENTS)\.md$/.test(path);
const isToolchainAllowList = (path: string): boolean => /^toolchains\/[^/]+\.json$/.test(path);
const isComment = (line: string): boolean => line.trimStart().startsWith("#");

const USES_LINE =
  /^[ \t]*(?:-[ \t]+)?uses:[ \t]*libre-ai\/(project-governance|governance)\/(\S+?)@(\S+?)[ \t\r]*$/;
const TOOLING_REF_LINE = /^[ \t]*tooling_ref:[ \t]*["']?([^"'\s]+?)["']?[ \t\r]*$/;
const REF_LINE = /^([ \t]*)ref:[ \t]*["']?([^"'\s]+?)["']?[ \t\r]*$/;
const REPOSITORY_KEY = /^[ \t]*repository:[ \t]*["']?([^"'\s]+?)["']?[ \t\r]*$/;
const GIT_DEP = /github:libre-ai\/(project-governance|governance)#([^"'\s,}]+)/g;
const LOCK_RESOLUTION =
  /^(\s*"[^"]+": \[")(.+?)@github:libre-ai\/project-governance#([0-9a-f]+)(", )(\{.*\})(, "libre-ai-project-governance-)([0-9a-f]+)(", ")(sha512-[A-Za-z0-9+/=]+)("\],?\r?)$/;
const BARE_CARD_PIN = /^([ \t]*)pinned:[ \t]*(["']?)([0-9a-f]{40})\2[ \t\r]*$/;
const CARD_ON_KEY = /^[ \t]*(?:-[ \t]+)?["']?on["']?[ \t]*:[ \t]*["']?([^"'\s#]+)["']?/;
const GOVERNANCE_URL =
  /https:\/\/github\.com\/libre-ai\/project-governance\/(?:blob|tree|raw)\/([0-9a-f]{40})\/([^\s)"'<>#?]+)/g;
const ALLOWED_PATTERN = /"libre-ai\/(project-governance|governance)\/([^"@\s]+)@([^"\s]+)"/g;
const ANY_HEX_RUN = /[0-9a-f]{7,40}/g;

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * The `repository:` sibling of a `ref:` line, read in the same mapping block:
 * the contiguous lines at the same indentation, bounded by a shallower line.
 */
function siblingRepository(lines: readonly string[], index: number, indent: number): string | null {
  const scan = (step: 1 | -1): string | null => {
    for (let i = index + step; i >= 0 && i < lines.length; i += step) {
      const line = lines[i] as string;
      if (line.trim() === "") continue;
      const depth = indentOf(line);
      if (depth < indent) return null;
      if (depth > indent) continue;
      const match = REPOSITORY_KEY.exec(line);
      if (match !== null) return match[1] as string;
    }
    return null;
  };
  return scan(-1) ?? scan(1);
}

const LIST_ITEM = /^([ \t]*)-[ \t]/;

/**
 * The `on:` value of the card dependency entry enclosing a `pinned:` line: the
 * nearest list item opened at a shallower indentation, read up to the next line
 * at or above that item's dash — `on:` may come before or after `pinned:`.
 */
function enclosingDependency(
  lines: readonly string[],
  index: number,
  indent: number,
): string | null {
  let start = -1;
  let dash = -1;
  for (let i = index - 1; i >= 0; i--) {
    const line = lines[i] as string;
    if (line.trim() === "") continue;
    const item = LIST_ITEM.exec(line);
    if (item !== null && (item[1] as string).length < indent) {
      start = i;
      dash = (item[1] as string).length;
      break;
    }
    if (indentOf(line) < indent) return null;
  }
  if (start === -1) return null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] as string;
    if (i > start && line.trim() !== "" && indentOf(line) <= dash) break;
    const match = CARD_ON_KEY.exec(line);
    if (match !== null) return match[1] as string;
  }
  return null;
}

function workflowSites(path: string, text: string, sites: Site[], refusals: string[]): void {
  const lines = lineSplit(text);
  lines.forEach((line, index) => {
    if (isComment(line)) return;
    const uses = USES_LINE.exec(line);
    if (uses !== null) {
      if (uses[1] === "governance") {
        refusals.push(`${path}:${index + 1} pins the retired authority ${RETIRED_AUTHORITY}`);
        return;
      }
      sites.push({ path, line: index + 1, form: "uses", ref: uses[3] as string });
      return;
    }
    const tooling = TOOLING_REF_LINE.exec(line);
    if (tooling !== null) {
      sites.push({ path, line: index + 1, form: "tooling_ref", ref: tooling[1] as string });
      return;
    }
    const ref = REF_LINE.exec(line);
    if (ref !== null) {
      const repository = siblingRepository(lines, index, (ref[1] as string).length);
      if (repository === AUTHORITY) {
        sites.push({ path, line: index + 1, form: "checkout-ref", ref: ref[2] as string });
      } else if (repository === RETIRED_AUTHORITY) {
        refusals.push(`${path}:${index + 1} checks out the retired authority ${RETIRED_AUTHORITY}`);
      }
    }
  });
}

function gitDepSites(path: string, line: string, index: number, sites: Site[], refusals: string[]) {
  for (const match of line.matchAll(GIT_DEP)) {
    if (match[1] === "governance") {
      refusals.push(`${path}:${index + 1} depends on the retired authority ${RETIRED_AUTHORITY}`);
      continue;
    }
    sites.push({ path, line: index + 1, form: "git-dep", ref: match[2] as string });
  }
}

function urlSites(path: string, line: string, index: number, sites: Site[]): void {
  for (const match of line.matchAll(GOVERNANCE_URL)) {
    sites.push({
      path,
      line: index + 1,
      form: "governance-url",
      ref: match[1] as string,
      citedPath: match[2] as string,
    });
  }
}

/** Every site the rules recognise in one file, before any generation is known. */
export function fileSites(path: string, text: string): { sites: Site[]; refusals: string[] } {
  const sites: Site[] = [];
  const refusals: string[] = [];
  if (isWorkflow(path)) {
    workflowSites(path, text, sites, refusals);
    return { sites, refusals };
  }
  const lines = lineSplit(text);
  lines.forEach((line, index) => {
    if (isLock(path)) {
      const resolution = LOCK_RESOLUTION.exec(line);
      if (resolution !== null) {
        sites.push({
          path,
          line: index + 1,
          form: "lock-resolution",
          ref: resolution[3] as string,
        });
        return;
      }
      gitDepSites(path, line, index, sites, refusals);
      return;
    }
    if (isManifest(path)) {
      gitDepSites(path, line, index, sites, refusals);
      return;
    }
    if (isCard(path)) {
      if (isComment(line)) return;
      gitDepSites(path, line, index, sites, refusals);
      const bare = BARE_CARD_PIN.exec(line);
      if (bare !== null) {
        const owner = enclosingDependency(lines, index, (bare[1] as string).length);
        if (owner === AUTHORITY) {
          sites.push({ path, line: index + 1, form: "card-pin-bare", ref: bare[3] as string });
        } else if (owner === RETIRED_AUTHORITY) {
          refusals.push(`${path}:${index + 1} pins the retired authority ${RETIRED_AUTHORITY}`);
        }
      }
      urlSites(path, line, index, sites);
      return;
    }
    if (isDocument(path)) {
      urlSites(path, line, index, sites);
      return;
    }
    if (isToolchainAllowList(path)) {
      for (const match of line.matchAll(ALLOWED_PATTERN)) {
        if (match[1] === "governance") {
          refusals.push(`${path}:${index + 1} allows the retired authority ${RETIRED_AUTHORITY}`);
          continue;
        }
        sites.push({ path, line: index + 1, form: "allowed-pattern", ref: match[3] as string });
      }
    }
  });
  return { sites, refusals };
}

const isHistorical = (
  repository: string,
  site: Pick<Site, "path" | "ref">,
  historical: readonly HistoricalSite[],
): HistoricalSite | undefined =>
  historical.find(
    (entry) =>
      entry.repository === repository && entry.path === site.path && entry.sha === site.ref,
  );

/** Count the occurrences of `needle` in `line` that are not part of a longer hex run. */
function countToken(line: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = line.indexOf(needle, from);
    if (at === -1) return count;
    const before = at === 0 ? "" : (line[at - 1] as string);
    const after = line[at + needle.length] ?? "";
    if (!HEX.test(before) && !HEX.test(after)) count += 1;
    from = at + needle.length;
  }
}

/**
 * Scan a snapshot: recognise every site, set historical ones aside, and
 * derive the single generation the repository carries.
 */
export function scanSnapshot(snapshot: Snapshot, historical: readonly HistoricalSite[]): Scan {
  const sites: Site[] = [];
  const left: Left[] = [];
  const refusals: string[] = [];
  for (const path of [...snapshot.files.keys()].sort()) {
    const found = fileSites(path, snapshot.files.get(path) as string);
    refusals.push(...found.refusals);
    for (const site of found.sites) {
      const entry = isHistorical(snapshot.repository, site, historical);
      if (entry !== undefined) {
        left.push({ path: site.path, line: site.line, reason: `historical site: ${entry.reason}` });
        continue;
      }
      sites.push(site);
    }
  }

  for (const site of sites) {
    if (site.form !== "lock-resolution" && !FULL_SHA.test(site.ref)) {
      refusals.push(
        `${site.path}:${site.line} ${site.form} is ${site.ref} — not a 40-character commit sha`,
      );
    }
  }
  const full = new Set(sites.filter((site) => FULL_SHA.test(site.ref)).map((site) => site.ref));
  for (const site of sites.filter((s) => s.form === "lock-resolution")) {
    const anchors = [...full].filter((sha) => sha.startsWith(site.ref));
    if (site.ref.length < 7 || anchors.length !== 1) {
      refusals.push(
        `${site.path}:${site.line} lock resolution key ${site.ref} matches ${anchors.length} full-sha surface(s) — it must match exactly one`,
      );
    }
  }
  if (full.size > 1) {
    const detail = [...full]
      .sort()
      .map((sha) => {
        const where = sites.filter((site) => site.ref === sha).map((s) => `${s.path}:${s.line}`);
        return `${sha.slice(0, 8)} at ${where.join(", ")}`;
      })
      .join("; ");
    refusals.push(`surfaces disagree — ${detail}`);
  }
  const from = full.size === 1 ? ([...full][0] as string) : null;
  return { sites, left, refusals, from };
}

export interface PlanContext {
  readonly target: string;
  /** Declared generations, oldest first, as fleet-pins.v1.yaml lists them. */
  readonly generations: readonly string[];
  readonly historical: readonly HistoricalSite[];
  /** Composition manifest text per generation sha; null when it could not be read. */
  readonly composition: ReadonlyMap<string, string | null>;
  /** The target generation's package.json text, for bun.lock resolutions. */
  readonly targetManifest: string | null;
  /** `sha512-…` integrity of the target generation's tarball, as bun records it. */
  readonly targetIntegrity: string | null;
  /** Authority paths known to exist at the target; a cited path absent here is refused. */
  readonly targetPaths: ReadonlySet<string>;
}

export interface FileEdit {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly sites: number;
}

export type PlanStatus = "bump" | "up-to-date" | "no-surface" | "refused";

export interface RepositoryPlan {
  readonly repository: string;
  readonly status: PlanStatus;
  readonly from: string | null;
  readonly to: string;
  readonly sites: readonly Site[];
  readonly edits: readonly FileEdit[];
  readonly left: readonly Left[];
  readonly refusals: readonly string[];
  readonly notes: readonly string[];
}

const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"] as const;

function dependencyView(value: unknown): string {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const view: Record<string, unknown> = {};
  for (const field of DEPENDENCY_FIELDS) {
    const entries = record[field];
    if (typeof entries === "object" && entries !== null && Object.keys(entries).length > 0) {
      view[field] = Object.fromEntries(
        Object.entries(entries as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
  }
  return JSON.stringify(view);
}

function composedRefs(text: string | null | undefined): Record<string, string> | null {
  if (text === null || text === undefined) return null;
  try {
    const repositories = (JSON.parse(text) as { repositories?: unknown }).repositories;
    if (typeof repositories !== "object" || repositories === null) return null;
    const refs: Record<string, string> = {};
    for (const [name, entry] of Object.entries(repositories as Record<string, unknown>)) {
      const ref = (entry as { ref?: unknown } | null)?.ref;
      if (typeof ref === "string") refs[name] = ref;
    }
    return refs;
  } catch {
    return null;
  }
}

/** Cargo sources coupled to the composition: refused when the composed ref moves. */
function cargoAudit(
  snapshot: Snapshot,
  from: string,
  context: PlanContext,
  left: Left[],
  refusals: string[],
): void {
  const cargo = snapshot.files.get("Cargo.toml");
  if (cargo === undefined) return;
  const scan = collectCargoSourcePins(snapshot.repository, cargo);
  refusals.push(...scan.failures);
  if (scan.pins.length === 0) return;
  const before = composedRefs(context.composition.get(from));
  const after = composedRefs(context.composition.get(context.target));
  for (const pin of scan.pins) {
    const where = `Cargo.toml ${pin.table}.${pin.name}`;
    if (before === null || after === null) {
      refusals.push(
        `${where} pins libre-ai/${pin.repository} — the composition manifest of ${before === null ? from.slice(0, 8) : context.target.slice(0, 8)} could not be read, so its coupling is unverified`,
      );
      continue;
    }
    const was = before[pin.repository];
    const will = after[pin.repository];
    if (was !== pin.rev) {
      refusals.push(
        `${where} rev ${pin.rev.slice(0, 8)} is not the ref ${from.slice(0, 8)} composes for libre-ai/${pin.repository} (${was?.slice(0, 8) ?? "none"}) — the repository already drifts`,
      );
    } else if (will !== was) {
      refusals.push(
        `${where} rev ${pin.rev.slice(0, 8)} is coupled to the composed ref of libre-ai/${pin.repository}, which moves to ${will?.slice(0, 8) ?? "none"} at ${context.target.slice(0, 8)} — needs the Cargo.toml, Cargo.lock and sdk-input-pin work, not a pin edit`,
      );
    } else {
      left.push({
        path: "Cargo.toml",
        line: null,
        reason: `${pin.table}.${pin.name} rev ${pin.rev.slice(0, 8)}: libre-ai/${pin.repository} is composed at the same ref by both generations`,
      });
    }
  }
}

function rewriteLine(
  line: string,
  site: Site,
  from: string,
  context: PlanContext,
  refusals: string[],
): string {
  const target = context.target;
  if (site.form === "lock-resolution") {
    const match = LOCK_RESOLUTION.exec(line) as RegExpExecArray;
    let recorded: unknown;
    try {
      recorded = JSON.parse(match[5] as string);
    } catch {
      refusals.push(`${site.path}:${site.line} lock resolution metadata is not JSON`);
      return line;
    }
    if (context.targetManifest === null) {
      refusals.push(
        `${site.path}:${site.line} target package.json unreadable — lock dependencies unverified`,
      );
      return line;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(context.targetManifest);
    } catch {
      refusals.push(`${site.path}:${site.line} target package.json is not JSON`);
      return line;
    }
    if (dependencyView(recorded) !== dependencyView(manifest)) {
      refusals.push(
        `${site.path}:${site.line} the target generation declares dependencies ${dependencyView(manifest)} where the lock records ${dependencyView(recorded)} — run bun install, not a pin edit`,
      );
      return line;
    }
    if (context.targetIntegrity === null) {
      refusals.push(
        `${site.path}:${site.line} integrity of the target tarball could not be computed`,
      );
      return line;
    }
    const short = target.slice(0, (match[3] as string).length);
    const tail = target.slice(0, (match[7] as string).length);
    return `${match[1]}${match[2]}@github:${AUTHORITY}#${short}${match[4]}${match[5]}${match[6]}${tail}${match[8]}${context.targetIntegrity}${match[10]}`;
  }
  if (site.form === "prose-prefix") {
    return line.replace(
      new RegExp(`(?<![0-9a-f])${from.slice(0, 8)}(?![0-9a-f])`, "g"),
      target.slice(0, 8),
    );
  }
  return line.split(from).join(target);
}

/**
 * The plan for one repository. `scan` comes from `scanSnapshot` on the same
 * snapshot; the context carries what the authority serves at both generations.
 */
export function planRepository(
  snapshot: Snapshot,
  scan: Scan,
  context: PlanContext,
): RepositoryPlan {
  const refusals = [...scan.refusals];
  const left = [...scan.left];
  const notes: string[] = [];
  const base = { repository: snapshot.repository, to: context.target };
  const finish = (
    status: PlanStatus,
    sites: readonly Site[],
    edits: readonly FileEdit[],
  ): RepositoryPlan => ({
    ...base,
    status: refusals.length > 0 ? "refused" : status,
    from: scan.from,
    sites,
    edits: refusals.length > 0 ? [] : edits,
    left,
    refusals,
    notes,
  });

  if (!FULL_SHA.test(context.target)) {
    refusals.push(`target ${context.target} is not a 40-character commit sha`);
    return finish("refused", scan.sites, []);
  }
  if (scan.sites.length === 0 && refusals.length === 0) return finish("no-surface", [], []);
  const from = scan.from;
  if (from === null) return finish("refused", scan.sites, []);
  if (!context.generations.includes(from)) {
    notes.push(`carries ${from.slice(0, 8)}, which fleet-pins.v1.yaml does not declare`);
  }
  if (from === context.target) {
    cargoAudit(snapshot, from, { ...context, target: from }, left, refusals);
    return finish("up-to-date", scan.sites, []);
  }

  // Prose prefixes are only meaningful once the generation is known.
  const sites: Site[] = [...scan.sites];
  const prefix = from.slice(0, 8);
  for (const [path, text] of snapshot.files) {
    if (!isDocument(path)) continue;
    lineSplit(text).forEach((line, index) => {
      if (countToken(line, prefix) > 0) {
        sites.push({ path, line: index + 1, form: "prose-prefix", ref: prefix });
      }
    });
  }

  // Independent count: every occurrence of the old generation, full or as a
  // prefix of seven characters or more, must sit on a recognised site line.
  // Counting per file and comparing to the recognised lines is what makes an
  // unknown form a refusal rather than a half-bumped repository.
  for (const [path, text] of snapshot.files) {
    lineSplit(text).forEach((line, index) => {
      for (const run of line.match(ANY_HEX_RUN) ?? []) {
        if (run.length < 7 || !from.startsWith(run)) continue;
        if (!sites.some((site) => site.path === path && site.line === index + 1)) {
          refusals.push(
            `${path}:${index + 1} carries ${run.length === 40 ? from.slice(0, 8) : run} on no recognised pin surface`,
          );
          return;
        }
      }
    });
  }
  for (const site of sites) {
    if (site.form !== "governance-url" || site.citedPath === undefined) continue;
    if (!context.targetPaths.has(site.citedPath)) {
      refusals.push(
        `${site.path}:${site.line} cites ${site.citedPath}, which does not exist at ${context.target.slice(0, 8)}`,
      );
    }
  }
  cargoAudit(snapshot, from, context, left, refusals);

  const edits: FileEdit[] = [];
  for (const path of [...new Set(sites.map((site) => site.path))].sort()) {
    const text = snapshot.files.get(path) as string;
    const lines = lineSplit(text);
    const fileSitesHere = sites.filter((site) => site.path === path);
    for (const lineNumber of [...new Set(fileSitesHere.map((site) => site.line))]) {
      const site = fileSitesHere.find((s) => s.line === lineNumber) as Site;
      lines[lineNumber - 1] = rewriteLine(
        lines[lineNumber - 1] as string,
        site,
        from,
        context,
        refusals,
      );
    }
    const after = lines.join("\n");
    if (after !== text) edits.push({ path, before: text, after, sites: fileSitesHere.length });
  }
  return finish("bump", sites, edits);
}

/** The set of authority paths every governance URL of these snapshots cites. */
export function citedPaths(scans: readonly Scan[]): string[] {
  const paths = new Set<string>();
  for (const scan of scans) {
    for (const site of scan.sites) {
      if (site.form === "governance-url" && site.citedPath !== undefined) paths.add(site.citedPath);
    }
  }
  return [...paths].sort();
}
