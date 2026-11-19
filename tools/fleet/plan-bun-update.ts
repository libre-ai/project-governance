/**
 * Which bun dependency bumps of THIS repository may be proposed (ADR-0069).
 *
 *   bun tools/fleet/plan-bun-update.ts --root <directory> [--out <directory>] [--summary <file>]
 *
 * This is the read-only half of `.github/workflows/bun-update.yml`: it holds no
 * write token. It reads the manifests, asks the registry what is published,
 * classifies every direct dependency, and with `--out` prepares one bundle per
 * proposal (the edited manifests and a regenerated `bun.lock`). The half that
 * writes, `tools/fleet/propose-bun-update.ts`, re-verifies each bundle.
 *
 * Manifests pin exact versions, so "inside the declared range" means nothing
 * here: the class of the bump decides. A patch or a minor is proposable, a major
 * is only listed. Below 1.0.0 a minor may break (semver item 4), and below 0.1.0
 * a patch may too, so those count as majors.
 *
 * Counters sum: direct dependencies = up-to-date + proposable + major-only +
 * too-recent + not-examined + unreadable. A registry that does not answer is
 * `unreadable` and fails the run, never a zero.
 *
 * Exit status: 0 plan complete; 1 a dependency unreadable or a bundle not
 * prepared; 2 usage (unknown argument, no `package.json` or `bun.lock` under
 * `--root`, a `workspaces` entry that cannot be honoured).
 */

import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import { scanManifestPatterns, workspaceManifestPatterns } from "../quality/bun-manifest-discovery";

export const DEPENDENCY_STATES = [
  "up-to-date",
  "proposable",
  "major-only",
  "too-recent",
  "not-examined",
  "unreadable",
] as const;
export type DependencyState = (typeof DEPENDENCY_STATES)[number];

export const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;
export type Section = (typeof SECTIONS)[number];

export interface DirectDependency {
  readonly manifest: string;
  readonly section: Section;
  readonly name: string;
  readonly declared: string;
}

export interface PublishedVersion {
  readonly version: string;
  readonly deprecated: boolean;
  readonly publishedAt: string | null;
}

export interface Packument {
  readonly latest: string;
  readonly versions: readonly PublishedVersion[];
}

export type BumpKind = "patch" | "minor" | "major";

export interface BumpTarget {
  readonly version: string;
  readonly kind: BumpKind;
  readonly publishedAt: string;
  readonly ageSeconds: number;
}

export interface Classification {
  readonly dependency: DirectDependency;
  readonly state: DependencyState;
  readonly reason: string;
  readonly target: BumpTarget | null;
  /** The highest breaking version published, listed and never applied. */
  readonly major: string | null;
}

/** Digits are capped so that every component stays a safe integer. */
const EXACT_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
/**
 * Narrower than npm allows: the name reaches a git ref and a pull request title,
 * so `~`, uppercase and consecutive dots are refused rather than escaped.
 */
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
/** The only form of a publication date that may reach a pull request description. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The canonical instant of a registry date, or null when it is not one.
 * `Date.parse` accepts free text around a date, so the registry's own spelling is
 * never kept: only what this function rebuilds from the parsed time goes further.
 */
export function normalisedInstant(value: string): string | null {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

export function isIsoInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && normalisedInstant(value) === value;
}

export function isExactVersion(version: string): boolean {
  return EXACT_VERSION.test(version);
}

export function isSafePackageName(name: string): boolean {
  return PACKAGE_NAME.test(name) && !name.includes("..") && name.length <= 214;
}

function components(version: string): readonly [number, number, number] {
  const match = EXACT_VERSION.exec(version);
  if (match === null) throw new Error(`${version} is not an exact version`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const [a, b, c] = components(left);
  const [x, y, z] = components(right);
  return a - x || b - y || c - z;
}

/** The lowest of several exact versions: what the title of a grouped bump starts from. */
export function lowestVersion(versions: readonly string[]): string {
  return [...versions].sort(compareVersions)[0] ?? "";
}

/** The class of a bump from `from` to a higher `to`. */
export function bumpKind(from: string, to: string): BumpKind {
  const [major, minor] = components(from);
  const [toMajor, toMinor] = components(to);
  if (major !== toMajor) return "major";
  if (major === 0 && minor !== toMinor) return "major";
  if (major === 0 && minor === 0) return "major";
  return minor === toMinor ? "patch" : "minor";
}

/** The class of a bump that moves several declared versions to one target. */
export function widestKind(froms: readonly string[], to: string): BumpKind {
  const kinds = froms.map((from) => bumpKind(from, to));
  if (kinds.includes("major")) return "major";
  return kinds.includes("minor") ? "minor" : "patch";
}

/**
 * The branch of one bump. `+` cannot occur in a package name, so two different
 * packages never share a branch, and `@a/b` keeps no `/` that could collide
 * with a branch named after `@a`.
 */
export function branchName(name: string, version: string): string {
  return `work/bun-update/${name.replace("/", "+")}@${version}`;
}

/** The packument of a registry response about `name`, or null when it cannot be trusted. */
export function parsePackument(value: unknown, name: string): Packument | null {
  if (typeof value !== "object" || value === null) return null;
  const { name: answered, "dist-tags": tags, versions, time } = value as Record<string, unknown>;
  if (answered !== name) return null;
  if (typeof tags !== "object" || tags === null) return null;
  if (typeof versions !== "object" || versions === null) return null;
  if (typeof time !== "object" || time === null) return null;
  const latest = (tags as Record<string, unknown>).latest;
  if (typeof latest !== "string" || !isExactVersion(latest)) return null;
  const published: PublishedVersion[] = [];
  for (const [version, manifest] of Object.entries(versions)) {
    if (!isExactVersion(version)) continue;
    const at = (time as Record<string, unknown>)[version];
    published.push({
      version,
      deprecated: typeof manifest === "object" && manifest !== null && "deprecated" in manifest,
      publishedAt: typeof at === "string" ? at : null,
    });
  }
  return { latest, versions: published };
}

/** Why a dependency is not compared with the registry, or null when it is. */
export function examinationRefusal(
  dependency: DirectDependency,
  overrides: ReadonlySet<string>,
  memberNames: ReadonlySet<string>,
): string | null {
  if (dependency.section === "peerDependencies") return "a peer range is the consumer's to resolve";
  if (!isSafePackageName(dependency.name)) return "the package name cannot reach a git ref safely";
  if (overrides.has(dependency.name)) {
    return "pinned by `overrides` or `resolutions`, which a bump must not move";
  }
  // bun links a member of the workspace whatever the public registry publishes
  // under the same name: comparing the two would propose an unrelated package.
  if (memberNames.has(dependency.name)) return "resolved to a member of this workspace";
  if (!isExactVersion(dependency.declared)) {
    return `\`${dependency.declared}\` is not an exact release version`;
  }
  return null;
}

function classification(
  dependency: DirectDependency,
  state: DependencyState,
  reason: string,
  target: BumpTarget | null = null,
  major: string | null = null,
): Classification {
  return { dependency, state, reason, target, major };
}

/**
 * Classifies one direct dependency. A candidate is a stable, non-deprecated
 * version above the declared one and not above `latest`: a version the
 * maintainers did not promote is not offered. A candidate whose publication date
 * is missing or unreadable makes the dependency unreadable: its age, which the
 * release-age guard depends on, cannot be proved. So does a `latest` below the
 * declared version: that answer contradicts the manifest, and reading it as
 * "nothing higher" would report a dependency up to date on an incoherent registry.
 */
export function classifyDependency(
  dependency: DirectDependency,
  packument: Packument | null,
  now: Date,
  minimumAgeSeconds: number = MINIMUM_RELEASE_AGE_SECONDS,
): Classification {
  if (packument === null) {
    return classification(dependency, "unreadable", "the registry gave no usable answer");
  }
  const current = dependency.declared;
  if (!packument.versions.some((published) => published.version === current)) {
    return classification(dependency, "unreadable", `${current} is not published on the registry`);
  }
  if (compareVersions(packument.latest, current) < 0) {
    return classification(
      dependency,
      "unreadable",
      `latest ${packument.latest} is below the declared ${current}`,
    );
  }
  const higher = packument.versions
    .filter((published) => !published.deprecated)
    .filter((published) => compareVersions(published.version, current) > 0)
    .filter((published) => compareVersions(published.version, packument.latest) <= 0)
    .sort((left, right) => compareVersions(right.version, left.version));
  const major =
    higher.find((published) => bumpKind(current, published.version) === "major")?.version ?? null;
  const candidates = higher.filter((published) => bumpKind(current, published.version) !== "major");
  if (candidates.length === 0) {
    return major === null
      ? classification(dependency, "up-to-date", "no higher version is published")
      : classification(
          dependency,
          "major-only",
          `only a major is available: ${major}`,
          null,
          major,
        );
  }
  let youngest: string | null = null;
  for (const candidate of candidates) {
    const publishedAt =
      candidate.publishedAt === null ? null : normalisedInstant(candidate.publishedAt);
    if (publishedAt === null) {
      return classification(dependency, "unreadable", `${candidate.version} has no readable date`);
    }
    const ageSeconds = Math.floor((now.getTime() - Date.parse(publishedAt)) / 1000);
    if (ageSeconds >= minimumAgeSeconds) {
      const kind = bumpKind(current, candidate.version);
      const target = { version: candidate.version, kind, publishedAt, ageSeconds };
      return classification(dependency, "proposable", `${kind} bump`, target, major);
    }
    youngest ??= candidate.version;
  }
  return classification(
    dependency,
    "too-recent",
    `${youngest} is younger than ${minimumAgeSeconds} seconds`,
    null,
    major,
  );
}

export type Tally = Readonly<Record<DependencyState, number>> & { readonly direct: number };

export function tallyOf(classifications: readonly Classification[]): Tally {
  const counts = Object.fromEntries(DEPENDENCY_STATES.map((state) => [state, 0])) as Record<
    DependencyState,
    number
  >;
  for (const { state } of classifications) counts[state] += 1;
  return { ...counts, direct: classifications.length };
}

export function planVolumeHolds(tally: Tally): boolean {
  return DEPENDENCY_STATES.reduce((sum, state) => sum + tally[state], 0) === tally.direct;
}

export function planVolumeLine(tally: Tally): string {
  const parts = DEPENDENCY_STATES.map((state) => `${state}=${tally[state]}`).join(" ");
  return `examined: direct=${tally.direct} ${parts}`;
}

/** The direct dependencies a manifest declares, in the order it declares them. */
export function directDependencies(path: string, manifest: unknown): DirectDependency[] {
  if (typeof manifest !== "object" || manifest === null) {
    throw new Error(`${path} is not a JSON object`);
  }
  const found: DirectDependency[] = [];
  for (const section of SECTIONS) {
    const entries = (manifest as Record<string, unknown>)[section];
    if (entries === undefined) continue;
    if (typeof entries !== "object" || entries === null) {
      throw new Error(`${path}: ${section} is not an object`);
    }
    for (const [name, declared] of Object.entries(entries)) {
      if (typeof declared !== "string")
        throw new Error(`${path}: ${section}.${name} is not a string`);
      found.push({ manifest: path, section, name, declared });
    }
  }
  return found;
}

/**
 * The manifest with one entry of one section moved, or null when the edit would
 * change anything else. Text is edited rather than re-serialised so that the bump
 * is a one-line diff. The same name and version may stand on several lines (a peer
 * range, another section), so each line is tried until one produces the expected
 * document.
 */
export function editManifest(
  text: string,
  section: Section,
  name: string,
  from: string,
  to: string,
): string | null {
  const expected = JSON.parse(text) as Record<string, unknown>;
  const entries = expected[section] as Record<string, string> | undefined;
  if (entries?.[name] !== from) return null;
  for (const pins of ["overrides", "resolutions"]) {
    if (Object.hasOwn(Object(expected[pins]), name)) return null;
  }
  entries[name] = to;
  const wanted = JSON.stringify(expected);
  const line = new RegExp(
    `^(\\s*"${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}":\\s*")${from.replace(/\./g, "\\.")}",?\\s*$`,
    "gm",
  );
  const edited = [...text.matchAll(line)]
    .map((match) => {
      const start = match.index + (match[1] ?? "").length;
      return `${text.slice(0, start)}${to}${text.slice(start + from.length)}`;
    })
    .find((candidate) => JSON.stringify(JSON.parse(candidate)) === wanted);
  return edited ?? null;
}

/** One declaration a proposal moves. */
export interface ProposalEdit {
  readonly manifest: string;
  readonly section: Section;
  readonly from: string;
}

export interface Proposal {
  readonly name: string;
  /** The lowest declared version among `edits`. */
  readonly from: string;
  readonly to: string;
  /** The widest class among `edits`. */
  readonly kind: BumpKind;
  readonly publishedAt: string;
  readonly ageSeconds: number;
  readonly branch: string;
  readonly manifests: readonly string[];
  readonly edits: readonly ProposalEdit[];
  /** Subdirectory of the bundle that holds this proposal's files. */
  readonly directory: string;
}

/** The manifest with every edit the proposal makes to it, or null when one cannot apply. */
export function editedManifest(
  text: string,
  path: string,
  proposal: Pick<Proposal, "name" | "to" | "edits">,
): string | null {
  let edited: string | null = text;
  for (const { manifest, section, from } of proposal.edits) {
    if (manifest !== path || edited === null) continue;
    edited = editManifest(edited, section, proposal.name, from, proposal.to);
  }
  return edited;
}

/**
 * One proposal per package and target: the branch is named after those two, so
 * declarations at different versions moving to one target share one proposal.
 */
export function proposalsOf(classifications: readonly Classification[]): Proposal[] {
  const proposals = new Map<string, Proposal>();
  for (const { dependency, target } of classifications) {
    if (target === null) continue;
    const key = `${dependency.name}@${target.version}`;
    const known = proposals.get(key);
    const { manifest, section, declared } = dependency;
    const edits = [...(known?.edits ?? []), { manifest, section, from: declared }];
    const froms = edits.map((edit) => edit.from);
    proposals.set(key, {
      name: dependency.name,
      from: lowestVersion(froms),
      to: target.version,
      kind: widestKind(froms, target.version),
      publishedAt: target.publishedAt,
      ageSeconds: target.ageSeconds,
      branch: branchName(dependency.name, target.version),
      manifests: [...new Set(edits.map((edit) => edit.manifest))],
      edits,
      directory: known?.directory ?? String(proposals.size),
    });
  }
  return [...proposals.values()];
}

export type RegistryReader = (name: string) => Promise<unknown>;

export type RegistryFetch = (url: string, init: RequestInit) => Promise<Response>;

const REGISTRY_TIMEOUT_MS = 30_000;

/**
 * The public registry, anonymously: no credential is attached, and a redirect is
 * an error rather than a second host answering for the registry.
 */
export async function readRegistry(name: string, request: RegistryFetch = fetch): Promise<unknown> {
  const response = await request(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, {
    redirect: "error",
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export async function classifyAll(
  dependencies: readonly DirectDependency[],
  workspace: Pick<Workspace, "overrides" | "memberNames">,
  read: RegistryReader,
  now: Date,
): Promise<Classification[]> {
  return Promise.all(
    dependencies.map(async (dependency) => {
      const { overrides, memberNames } = workspace;
      const refusal = examinationRefusal(dependency, overrides, memberNames);
      if (refusal !== null) return classification(dependency, "not-examined", refusal);
      const packument = await read(dependency.name).then(
        (answer) => parsePackument(answer, dependency.name),
        () => null,
      );
      return classifyDependency(dependency, packument, now);
    }),
  );
}

/** What the manifests of a checkout say about the dependencies they declare. */
export interface Workspace {
  readonly manifests: readonly string[];
  readonly overrides: ReadonlySet<string>;
  /** Every package name this workspace itself provides. */
  readonly memberNames: ReadonlySet<string>;
  /** Why the `workspaces` field cannot be honoured; empty when it can. */
  readonly failures: readonly string[];
}

export async function readWorkspace(root: string): Promise<Workspace> {
  const readManifest = (path: string) =>
    JSON.parse(readFileSync(join(root, path), "utf8")) as {
      readonly name?: unknown;
      readonly workspaces?: unknown;
      readonly overrides?: Record<string, unknown>;
      readonly resolutions?: Record<string, unknown>;
    };
  const rootManifest = readManifest("package.json");
  const { patterns, failures } = workspaceManifestPatterns(rootManifest.workspaces);
  const members = failures.length > 0 ? [] : await scanManifestPatterns(root, patterns);
  const manifests = [...new Set(["package.json", ...members])];
  return {
    manifests,
    overrides: new Set([
      ...Object.keys(rootManifest.overrides ?? {}),
      ...Object.keys(rootManifest.resolutions ?? {}),
    ]),
    memberNames: new Set(
      manifests.map((path) => readManifest(path).name).filter((name) => typeof name === "string"),
    ),
    failures,
  };
}

export type LockfileRegenerator = (directory: string) => {
  readonly ok: boolean;
  readonly detail: string;
};

/**
 * No lifecycle script runs (`--ignore-scripts`) and nothing is installed
 * (`--lockfile-only`): the bundle is produced without executing dependency code.
 * The environment is rebuilt rather than inherited, and `HOME` is the bundle's own
 * directory, so no credential and no user-level bun configuration reach the
 * resolution. `bunfig.toml` is copied next to the manifests, so the release-age
 * guard of the repository also judges it.
 */
export function lockfileCommand(directory: string): {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
} {
  return {
    command: [process.execPath, "install", "--lockfile-only", "--ignore-scripts"],
    cwd: directory,
    env: { PATH: process.env.PATH ?? "", HOME: directory, TMPDIR: tmpdir() },
  };
}

function regenerateLockfile(directory: string): { readonly ok: boolean; readonly detail: string } {
  const { command, cwd, env } = lockfileCommand(directory);
  const result = Bun.spawnSync([...command], { cwd, env, stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, detail: new TextDecoder().decode(result.stderr).trim() };
}

/** Writes the bundle of one proposal; returns why it could not, or null. */
export function prepareBundle(
  proposal: Proposal,
  root: string,
  manifests: readonly string[],
  out: string,
  regenerate: LockfileRegenerator,
): string | null {
  const work = mkdtempSync(join(tmpdir(), "bun-update-"));
  try {
    for (const path of [...manifests, "bun.lock", "bunfig.toml"]) {
      if (!existsSync(join(root, path))) continue;
      mkdirSync(dirname(join(work, path)), { recursive: true });
      cpSync(join(root, path), join(work, path));
    }
    const edited = new Map<string, string>();
    for (const path of proposal.manifests) {
      const text = editedManifest(readFileSync(join(root, path), "utf8"), path, proposal);
      if (text === null) return `${path}: the edit would change more than ${proposal.name}`;
      edited.set(path, text);
      writeFileSync(join(work, path), text);
    }
    const regenerated = regenerate(work);
    if (!regenerated.ok) return `bun.lock was not regenerated: ${regenerated.detail}`;
    const lock = readFileSync(join(work, "bun.lock"), "utf8");
    if (lock === readFileSync(join(root, "bun.lock"), "utf8")) return "bun.lock did not change";
    if (!lock.includes(`"${proposal.name}@${proposal.to}"`)) {
      return `bun.lock does not resolve ${proposal.name}@${proposal.to}`;
    }
    const target = join(out, proposal.directory);
    for (const [path, text] of edited) {
      if (readFileSync(join(work, path), "utf8") !== text) return `${path} was rewritten by bun`;
      mkdirSync(dirname(join(target, path)), { recursive: true });
      writeFileSync(join(target, path), text);
    }
    writeFileSync(join(target, "bun.lock"), lock);
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function renderPlan(classifications: readonly Classification[]): string[] {
  return classifications.map(({ dependency, state, reason, major }) => {
    const listed = major === null || state === "major-only" ? "" : ` (major listed: ${major})`;
    return `${state}: ${dependency.name} ${dependency.declared} in ${dependency.manifest}: ${reason}${listed}`;
  });
}

interface Options {
  readonly root: string;
  readonly out: string | null;
  readonly summary: string | null;
}

function parseOptions(argv: readonly string[]): Options | string {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const [key, value] = [argv[index] ?? "", argv[index + 1]];
    if (!["--root", "--out", "--summary"].includes(key)) return `unknown argument ${key}`;
    if (value === undefined) return `${key} needs a value`;
    values.set(key, value);
  }
  const root = values.get("--root");
  if (root === undefined) return "--root is required";
  return { root, out: values.get("--out") ?? null, summary: values.get("--summary") ?? null };
}

export async function main(
  argv: readonly string[],
  read: RegistryReader = readRegistry,
  regenerate: LockfileRegenerator = regenerateLockfile,
  now: Date = new Date(),
): Promise<number> {
  const options = parseOptions(argv);
  if (typeof options === "string") {
    console.error(options);
    return 2;
  }
  const { root, out, summary } = options;
  for (const required of ["package.json", "bun.lock"]) {
    if (!existsSync(join(root, required))) {
      console.error(`${required} is missing under ${root}`);
      return 2;
    }
  }
  const workspace = await readWorkspace(root);
  if (workspace.failures.length > 0) {
    for (const failure of workspace.failures) console.error(failure);
    return 2;
  }
  const { manifests } = workspace;
  const dependencies = manifests.flatMap((path) =>
    directDependencies(path, JSON.parse(readFileSync(join(root, path), "utf8"))),
  );
  const classifications = await classifyAll(dependencies, workspace, read, now);
  const tally = tallyOf(classifications);
  const proposals = proposalsOf(classifications);

  const failures: string[] = [];
  const prepared: Proposal[] = [];
  if (out !== null) {
    mkdirSync(out, { recursive: true });
    for (const proposal of proposals) {
      const problem = prepareBundle(proposal, root, manifests, out, regenerate);
      if (problem === null) prepared.push(proposal);
      else failures.push(`${proposal.name}@${proposal.to}: ${problem}`);
    }
    writeFileSync(join(out, "plan.json"), `${JSON.stringify({ proposals: prepared }, null, 2)}\n`);
  }

  const lines = [
    ...renderPlan(classifications),
    ...failures.map((failure) => `not prepared: ${failure}`),
    planVolumeLine(tally),
    `proposals: planned=${proposals.length} prepared=${prepared.length} failed=${failures.length}`,
  ];
  for (const line of lines) console.log(line);
  if (summary !== null) appendFileSync(summary, `${lines.map((line) => `- ${line}`).join("\n")}\n`);
  return tally.unreadable > 0 || failures.length > 0 || !planVolumeHolds(tally) ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
