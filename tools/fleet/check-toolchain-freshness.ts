/**
 * Are the toolchain pins of THIS repository behind what their tools publish?
 *
 *   bun tools/fleet/check-toolchain-freshness.ts
 *
 * Read-only: it reads the tracked files that pin a tool, asks where the tool
 * is published for its latest release, and prints one line per pin. It writes
 * nothing and opens nothing. Run by `.github/workflows/toolchain-freshness.yml`
 * on a schedule, never on a pull request: a tool publishing a release is not a
 * defect of the change under review.
 *
 * A pin is one tool and every site that writes its version (`TOOLCHAIN_PINS`).
 * Each pin lands in exactly one state:
 *
 *   up-to-date  the pinned version is the latest release, or ahead of it (a
 *               pre-release of a later version is not late);
 *   behind      a higher release exists and is older than the release-age floor;
 *   too-recent  a higher release exists and is younger than that floor, the one
 *               `ecosystem/check-release-age.ts` holds the fleet's dependencies to;
 *   unreadable  a site is missing, holds no pin or disagrees with another site,
 *               the pinned text is not an exact version, or the registry gave no
 *               usable answer. A failure, never an "up-to-date".
 *
 * Counters sum: pins = up-to-date + behind + too-recent + unreadable.
 *
 * Only the latest release is compared. A pin behind an older release while the
 * latest is still young reads `too-recent` until that latest passes the floor.
 *
 * Sources. A tool published on a registry is read there, by the protocol its
 * own installer uses, anonymously and without a quota: the npm registry, the
 * crates.io sparse index, the Rust stable channel manifest, the PyPI JSON
 * document. shellcheck and osv-scanner publish on GitHub Releases only: they
 * are read through the GitHub REST API, which has a quota (60 requests an hour
 * for an anonymous address, 1000 for the token of a workflow run). `GH_TOKEN`,
 * when set, is sent to that API and to no other host. Every source is a third
 * party `ecosystem/third-parties.v1.yaml` already lists; none is added.
 *
 * Exit status: 0 every pin up to date or too recent; 1 a pin behind or
 * unreadable; 2 usage (the command takes no argument).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import {
  compareVersions,
  isExactVersion,
  normalisedInstant,
  parsePackument,
  type RegistryFetch,
  readRegistry,
} from "./plan-bun-update";

export const PIN_STATES = ["up-to-date", "behind", "too-recent", "unreadable"] as const;
export type PinState = (typeof PIN_STATES)[number];

/**
 * Where a pin is written. `json` is the path of a string in a JSON file;
 * `pattern` is a global expression whose first group is the version, and every
 * match in the file is one reading.
 */
export type PinSite =
  | { readonly file: string; readonly json: readonly string[] }
  | { readonly file: string; readonly pattern: RegExp };

export type UpstreamSource =
  | { readonly kind: "npm"; readonly name: string }
  | { readonly kind: "crates"; readonly name: string }
  | { readonly kind: "rust-stable" }
  | { readonly kind: "pypi"; readonly name: string }
  | { readonly kind: "github-release"; readonly repository: string };

export interface ToolchainPin {
  readonly tool: string;
  readonly sites: readonly PinSite[];
  readonly source: UpstreamSource;
}

const COMPOSITION_INSTALLER = ".github/composition/install-toolchains.sh";
const COMPOSITION_WORKFLOW = ".github/workflows/validate-composition.yml";
const DEPENDENCY_POLICY_WORKFLOW = ".github/workflows/reusable-dependency-policy.yml";

/**
 * The pins this repository declares. The Bun archive URL that workflows repeat
 * is not listed: `ecosystem/check-toolchain-source.ts` already holds every copy
 * to `toolchains/bun.json`. `tools/fleet/check-toolchain-freshness.test.ts`
 * reads every site below in the tracked tree, so a pin that moves or changes
 * shape fails the test suite of the pull request that moves it.
 */
export const TOOLCHAIN_PINS: readonly ToolchainPin[] = [
  {
    tool: "bun",
    sites: [
      { file: "toolchains/bun.json", json: ["revision"] },
      { file: COMPOSITION_INSTALLER, pattern: /bun\['revision'\] != '([^']+)'/g },
      { file: COMPOSITION_INSTALLER, pattern: /'bun', '--revision', '([^']+)'/g },
    ],
    source: { kind: "npm", name: "bun" },
  },
  {
    tool: "rust",
    sites: [
      { file: "rust-toolchain.toml", pattern: /^channel = "([^"]+)"$/gm },
      { file: COMPOSITION_WORKFLOW, pattern: /^\s+toolchain: (\S+)$/gm },
    ],
    source: { kind: "rust-stable" },
  },
  {
    tool: "cargo-deny",
    sites: [
      { file: "toolchains/cargo-deny.json", json: ["version"] },
      { file: COMPOSITION_INSTALLER, pattern: /^CARGO_DENY_VERSION = '([^']+)'$/gm },
      { file: DEPENDENCY_POLICY_WORKFLOW, pattern: /^\s+CARGO_DENY_VERSION: (\S+)$/gm },
    ],
    source: { kind: "crates", name: "cargo-deny" },
  },
  {
    tool: "cargo-audit",
    sites: [{ file: DEPENDENCY_POLICY_WORKFLOW, pattern: /^\s+CARGO_AUDIT_VERSION: (\S+)$/gm }],
    source: { kind: "crates", name: "cargo-audit" },
  },
  {
    tool: "cargo-semver-checks",
    sites: [
      {
        file: ".github/workflows/reusable-api-compat.yml",
        pattern: /^\s+CARGO_SEMVER_CHECKS_VERSION: (\S+)$/gm,
      },
    ],
    source: { kind: "crates", name: "cargo-semver-checks" },
  },
  {
    tool: "cargo-llvm-cov",
    sites: [
      { file: COMPOSITION_WORKFLOW, pattern: /cargo install cargo-llvm-cov --version (\S+)/g },
    ],
    source: { kind: "crates", name: "cargo-llvm-cov" },
  },
  {
    tool: "cargo-mutants",
    sites: [
      { file: "toolchains/cargo-mutants.json", json: ["version"] },
      {
        file: ".github/workflows/reusable-mutation-rust.yml",
        pattern: /cargo-mutants\/releases\/download\/v([^/\s]+)\//g,
      },
    ],
    source: { kind: "crates", name: "cargo-mutants" },
  },
  {
    tool: "reuse",
    sites: [
      { file: "tools/licensing/requirements.txt", pattern: /^reuse(?:\[[^\]]*\])?==(\S+)$/gm },
      { file: COMPOSITION_WORKFLOW, pattern: /pipx install reuse==(\S+)/g },
    ],
    source: { kind: "pypi", name: "reuse" },
  },
  {
    // The image is pinned by digest; the version is the comment next to it.
    // The digest is not resolved here: a comment that lies is not seen.
    tool: "shellcheck",
    sites: [
      {
        file: ".github/workflows/reusable-shell-lint.yml",
        pattern: /SHELLCHECK_IMAGE: koalaman\/shellcheck@sha256:[a-f0-9]{64} # v(\S+)/g,
      },
    ],
    source: { kind: "github-release", repository: "koalaman/shellcheck" },
  },
  {
    tool: "osv-scanner",
    sites: [
      { file: "toolchains/osv-scanner.json", json: ["version"] },
      { file: COMPOSITION_INSTALLER, pattern: /^OSV_SCANNER_VERSION = '([^']+)'$/gm },
    ],
    source: { kind: "github-release", repository: "google/osv-scanner" },
  },
];

/** The text of a tracked file by its repository-relative path, or null when it cannot be read. */
export type FileReader = (path: string) => string | null;

export type PinReading =
  | { readonly kind: "pinned"; readonly version: string }
  | { readonly kind: "unreadable"; readonly reason: string };

function siteValues(site: PinSite, text: string): string[] {
  if ("pattern" in site) return [...text.matchAll(site.pattern)].map((match) => match[1] ?? "");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  for (const key of site.json) {
    if (typeof value !== "object" || value === null) return [];
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "string" ? [value] : [];
}

/**
 * The one version every site of a pin writes. A site that cannot be read or
 * holds no pin, and two sites that disagree, make the pin unreadable: choosing
 * one of two versions would report on a toolchain the fleet may not run.
 */
export function readPin(pin: ToolchainPin, readFile: FileReader): PinReading {
  const found = new Map<string, string>();
  for (const site of pin.sites) {
    const text = readFile(site.file);
    if (text === null) return { kind: "unreadable", reason: `${site.file} cannot be read` };
    const values = siteValues(site, text);
    if (values.length === 0) {
      return { kind: "unreadable", reason: `no pin found in ${site.file}` };
    }
    for (const value of values) if (!found.has(value)) found.set(value, site.file);
  }
  const [first, ...others] = [...found];
  if (first === undefined) return { kind: "unreadable", reason: "no site is declared" };
  if (others.length > 0) {
    const sightings = [...found].map(([value, file]) => `${JSON.stringify(value)} in ${file}`);
    return { kind: "unreadable", reason: `ambiguous: ${sightings.join(", ")}` };
  }
  return { kind: "pinned", version: first[0] };
}

const PINNED_VERSION =
  /^((?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8}))(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** The release a pinned version belongs to, and whether it is a pre-release of it. */
export function parsePinned(
  version: string,
): { readonly release: string; readonly preRelease: boolean } | null {
  const match = PINNED_VERSION.exec(version);
  if (match === null) return null;
  return { release: match[1] ?? "", preRelease: match[2] !== undefined };
}

export interface LatestRelease {
  readonly version: string;
  /** As the registry wrote it; null when it gave none. Normalised before any use. */
  readonly publishedAt: string | null;
}

export type UpstreamAnswer =
  | { readonly kind: "latest"; readonly release: LatestRelease }
  | { readonly kind: "unreadable"; readonly reason: string };

export interface PinClassification {
  readonly tool: string;
  readonly state: PinState;
  readonly pinned: string | null;
  readonly reason: string;
}

/**
 * Classifies one pin. Only what a strict pattern accepted is ever printed: the
 * pinned version, a stable `x.y.z` latest, and an instant rebuilt from the
 * parsed date. A latest that is not a stable release is unreadable rather than
 * compared, and so is a higher release whose age cannot be proved.
 */
export function classifyPin(
  tool: string,
  reading: PinReading,
  upstream: UpstreamAnswer,
  now: Date,
  minimumAgeSeconds: number = MINIMUM_RELEASE_AGE_SECONDS,
): PinClassification {
  if (reading.kind === "unreadable") {
    return { tool, state: "unreadable", pinned: null, reason: reading.reason };
  }
  const pinned = reading.version;
  const parsed = parsePinned(pinned);
  if (parsed === null) {
    const reason = `${JSON.stringify(pinned)} is not an exact version`;
    return { tool, state: "unreadable", pinned: null, reason };
  }
  if (upstream.kind === "unreadable") {
    return { tool, state: "unreadable", pinned, reason: upstream.reason };
  }
  const latest = upstream.release.version;
  if (!isExactVersion(latest)) {
    const reason = "the latest release is not a stable version";
    return { tool, state: "unreadable", pinned, reason };
  }
  const order = compareVersions(parsed.release, latest);
  if (order > 0) {
    return { tool, state: "up-to-date", pinned, reason: `ahead of the latest release ${latest}` };
  }
  if (order === 0 && !parsed.preRelease) {
    return { tool, state: "up-to-date", pinned, reason: "the latest release" };
  }
  const { publishedAt } = upstream.release;
  const instant = publishedAt === null ? null : normalisedInstant(publishedAt);
  if (instant === null) {
    const reason = `${latest} has no readable publication date`;
    return { tool, state: "unreadable", pinned, reason };
  }
  const ageSeconds = Math.floor((now.getTime() - Date.parse(instant)) / 1000);
  if (ageSeconds < minimumAgeSeconds) {
    const reason = `${latest}, published ${instant}, is younger than ${minimumAgeSeconds} seconds`;
    return { tool, state: "too-recent", pinned, reason };
  }
  return { tool, state: "behind", pinned, reason: `${latest} was published ${instant}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The `latest` of an npm packument and the date the registry gives for it. */
export function latestFromPackument(value: unknown, name: string): LatestRelease | null {
  const packument = parsePackument(value, name);
  if (packument === null) return null;
  const latest = packument.versions.find((published) => published.version === packument.latest);
  if (latest === undefined) return null;
  return { version: latest.version, publishedAt: latest.publishedAt };
}

/**
 * The highest stable, non-yanked version of a crates.io sparse-index file: one
 * JSON document per published version. A line that is not such a document makes
 * the whole file unreadable, never a shorter list.
 */
export function latestFromCratesIndex(text: string, name: string): LatestRelease | null {
  let latest: LatestRelease | null = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isRecord(entry) || entry.name !== name) return null;
    const { vers, yanked, pubtime } = entry;
    if (typeof vers !== "string" || typeof yanked !== "boolean") return null;
    if (yanked || !isExactVersion(vers)) continue;
    if (latest !== null && compareVersions(vers, latest.version) <= 0) continue;
    latest = { version: vers, publishedAt: typeof pubtime === "string" ? pubtime : null };
  }
  return latest;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MILLISECONDS = 86_400_000;

/**
 * The stable release of a Rust channel manifest. The manifest dates a release
 * by its day only, so the instant kept is the end of that day: the release is
 * never read as older than it is.
 */
export function latestFromRustChannel(text: string): LatestRelease | null {
  let manifest: unknown;
  try {
    manifest = Bun.TOML.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(manifest) || !isRecord(manifest.pkg) || !isRecord(manifest.pkg.rust)) return null;
  const described = manifest.pkg.rust.version;
  if (typeof described !== "string") return null;
  const version = /^(\S+) \(/.exec(described)?.[1];
  if (version === undefined) return null;
  const { date } = manifest;
  const start = typeof date === "string" && DAY.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  return {
    version,
    publishedAt: Number.isNaN(start) ? null : new Date(start + DAY_MILLISECONDS).toISOString(),
  };
}

/**
 * The current release of a PyPI project document, dated by the last file
 * uploaded for it. A yanked release is not a latest release.
 */
export function latestFromPypi(value: unknown, name: string): LatestRelease | null {
  if (!isRecord(value) || !isRecord(value.info) || value.info.name !== name) return null;
  const { version, yanked } = value.info;
  if (typeof version !== "string" || yanked === true) return null;
  const files = isRecord(value.releases) ? value.releases[version] : undefined;
  const uploads = (Array.isArray(files) ? files : []).map((file: unknown) => {
    const at = isRecord(file) ? file.upload_time_iso_8601 : undefined;
    return typeof at === "string" ? normalisedInstant(at) : null;
  });
  const dated = uploads.filter((at) => at !== null).sort();
  const publishedAt = dated.length === uploads.length ? (dated.at(-1) ?? null) : null;
  return { version, publishedAt };
}

/**
 * The release GitHub names as latest for a repository: its tag without the `v`
 * prefix, and its publication date. A draft or a pre-release is not an answer.
 */
export function latestFromGitHubRelease(value: unknown): LatestRelease | null {
  if (!isRecord(value) || value.draft !== false || value.prerelease !== false) return null;
  const { tag_name: tag, published_at: at } = value;
  if (typeof tag !== "string" || !tag.startsWith("v")) return null;
  return { version: tag.slice(1), publishedAt: typeof at === "string" ? at : null };
}

const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * A read that follows no redirect: a second host never answers for the
 * registry, nor receives a header meant for the first.
 */
async function get(
  url: string,
  request: RegistryFetch,
  headers?: Readonly<Record<string, string>>,
): Promise<Response> {
  const response = await request(url, {
    redirect: "error",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    ...(headers === undefined ? {} : { headers }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

const GITHUB_REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * The token is sent to api.github.com and to no other host, and only when
 * there is one: without it the same read is anonymous, on a smaller quota.
 */
async function readGitHubRelease(
  repository: string,
  request: RegistryFetch,
  token: string,
): Promise<LatestRelease | null> {
  if (!GITHUB_REPOSITORY.test(repository)) return null;
  const headers = {
    Accept: "application/vnd.github+json",
    ...(token === "" ? {} : { Authorization: `Bearer ${token}` }),
  };
  const url = `https://api.github.com/repos/${repository}/releases/latest`;
  return latestFromGitHubRelease(await (await get(url, request, headers)).json());
}

export type UpstreamReader = (source: UpstreamSource) => Promise<LatestRelease | null>;

/** The latest release a tool's registry publishes, or null when its answer cannot be trusted. */
export async function readUpstream(
  source: UpstreamSource,
  request: RegistryFetch = fetch,
  githubToken: string = (process.env.GH_TOKEN ?? "").trim(),
): Promise<LatestRelease | null> {
  switch (source.kind) {
    case "npm":
      return latestFromPackument(await readRegistry(source.name, request), source.name);
    case "crates": {
      // shortcut: names of four characters or more, the only layout the pinned
      // crates use; a shorter name is unreadable until its layout is added.
      if (!/^[a-z0-9_-]{4,64}$/.test(source.name)) return null;
      const path = `${source.name.slice(0, 2)}/${source.name.slice(2, 4)}/${source.name}`;
      const index = await get(`https://index.crates.io/${path}`, request);
      return latestFromCratesIndex(await index.text(), source.name);
    }
    case "rust-stable": {
      const url = "https://static.rust-lang.org/dist/channel-rust-stable.toml";
      return latestFromRustChannel(await (await get(url, request)).text());
    }
    case "pypi": {
      const url = `https://pypi.org/pypi/${source.name}/json`;
      return latestFromPypi(await (await get(url, request)).json(), source.name);
    }
    case "github-release":
      return readGitHubRelease(source.repository, request, githubToken);
  }
}

const HTTP_STATUS = /^HTTP \d{3}$/;

/** Why a registry read failed, without repeating anything the network said. */
function failureReason(error: unknown): string {
  const status = error instanceof Error && HTTP_STATUS.test(error.message) ? error.message : null;
  return `the registry did not answer${status === null ? "" : ` (${status})`}`;
}

export async function classifyAll(
  pins: readonly ToolchainPin[],
  readFile: FileReader,
  read: UpstreamReader,
  now: Date,
): Promise<PinClassification[]> {
  return Promise.all(
    pins.map(async (pin) => {
      const { tool, source } = pin;
      const reading = readPin(pin, readFile);
      // A pin that cannot be read asks the registry nothing: there is no
      // version to compare its answer with.
      const upstream: UpstreamAnswer =
        reading.kind === "unreadable"
          ? { kind: "unreadable", reason: reading.reason }
          : await read(source).then(
              (release): UpstreamAnswer =>
                release === null
                  ? { kind: "unreadable", reason: "the registry gave no usable answer" }
                  : { kind: "latest", release },
              (error: unknown): UpstreamAnswer => ({
                kind: "unreadable",
                reason: failureReason(error),
              }),
            );
      return classifyPin(tool, reading, upstream, now);
    }),
  );
}

export type FreshnessTally = Readonly<Record<PinState, number>> & { readonly pins: number };

/** `declared` is the number of pins handed in, not of classifications received. */
export function tallyOf(
  declared: number,
  classifications: readonly PinClassification[],
): FreshnessTally {
  const counts = Object.fromEntries(PIN_STATES.map((state) => [state, 0])) as Record<
    PinState,
    number
  >;
  for (const { state } of classifications) counts[state] += 1;
  return { ...counts, pins: declared };
}

export function volumeHolds(tally: FreshnessTally): boolean {
  return PIN_STATES.reduce((sum, state) => sum + tally[state], 0) === tally.pins;
}

export function volumeLine(tally: FreshnessTally): string {
  const parts = PIN_STATES.map((state) => `${state}=${tally[state]}`).join(" ");
  return `examined: pins=${tally.pins} ${parts}`;
}

export function renderPins(classifications: readonly PinClassification[]): string[] {
  return classifications.map(({ tool, state, pinned, reason }) => {
    const subject = pinned === null ? tool : `${tool} ${pinned}`;
    return `${state}: ${subject}: ${reason}`;
  });
}

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export function readRepositoryFile(path: string): string | null {
  try {
    return readFileSync(`${REPOSITORY_ROOT}${path}`, "utf8");
  } catch {
    return null;
  }
}

export interface FreshnessReport {
  readonly lines: readonly string[];
  readonly status: 0 | 1;
}

/** One line per pin, then the volume line; status 1 when a pin is behind or unreadable. */
export async function freshnessReport(
  pins: readonly ToolchainPin[],
  readFile: FileReader,
  read: UpstreamReader,
  now: Date,
): Promise<FreshnessReport> {
  const classifications = await classifyAll(pins, readFile, read, now);
  const tally = tallyOf(pins.length, classifications);
  const lines = [...renderPins(classifications), volumeLine(tally)];
  // No pin at all is a list that moved, not a fleet that is up to date.
  if (tally.pins === 0 || !volumeHolds(tally)) return { lines, status: 1 };
  return { lines, status: tally.behind > 0 || tally.unreadable > 0 ? 1 : 0 };
}

export async function main(
  argv: readonly string[],
  pins: readonly ToolchainPin[] = TOOLCHAIN_PINS,
  readFile: FileReader = readRepositoryFile,
  read: UpstreamReader = readUpstream,
  now: Date = new Date(),
): Promise<number> {
  if (argv.length > 0) {
    console.error("this command takes no argument");
    return 2;
  }
  const { lines, status } = await freshnessReport(pins, readFile, read, now);
  for (const line of lines) console.log(line);
  return status;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
