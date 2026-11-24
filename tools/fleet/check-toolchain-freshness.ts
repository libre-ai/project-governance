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
 * A pin is one tool and the sites listed for it in `TOOLCHAIN_PINS`. Each pin
 * lands in exactly one state:
 *
 *   up-to-date  the pinned version is the latest release, or a pre-release of
 *               a version above it;
 *   behind      a higher release exists and is older than the release-age floor;
 *   too-recent  a higher release exists and is younger than that floor, the one
 *               `ecosystem/check-release-age.ts` holds the fleet's dependencies to;
 *   held        a higher release exists and an entry of the exception register
 *               holds the pin at exactly this version, until a date not passed;
 *   unreadable  a site is missing, holds no pin or disagrees with another site;
 *               the pinned text is not an exact version; the source gave no
 *               usable answer, dates its latest release in the future, does not
 *               list the pinned version, or names a latest release below a
 *               stable pin. A failure, never an "up-to-date".
 *
 * Counters sum: pins = up-to-date + behind + too-recent + held + unreadable.
 * States are counted per tool, so a tool declared twice breaks the sum and
 * fails the run.
 *
 * The exception register is `ecosystem/toolchain-freshness-exceptions.v1.yaml`.
 * An entry names a tool, the exact version it is held at, why, and until when.
 * It fails the run when the pin is no longer that version, when its date has
 * passed, when the tool is up to date, or when the tool is not a declared pin.
 * A register that is missing or malformed fails the run before anything is read.
 *
 * Only the latest release is compared. A pin behind an older release while the
 * latest is still young reads `too-recent` until that latest passes the floor.
 *
 * Sources. Bun is read on the npm registry, the cargo tools on the crates.io
 * sparse index, the Rust toolchain on the stable channel manifest, reuse on
 * the PyPI JSON document: anonymous reads, without a quota. shellcheck and
 * osv-scanner publish on GitHub Releases only: they are read through the
 * GitHub REST API, which has a quota (60 requests an hour for an anonymous
 * address, 1000 for the token of a workflow run). `GH_TOKEN`, when set, is sent
 * to that API and to no other host. Every source is a third party
 * `ecosystem/third-parties.v1.yaml` already lists; none is added.
 *
 * Exit status: 0 every pin up to date, too recent or held; 1 a pin behind or
 * unreadable, an exception that fails, a register that cannot be read, a
 * volume that does not sum, or no pin declared; 2 usage (the command takes no
 * argument).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MINIMUM_RELEASE_AGE_SECONDS } from "../../ecosystem/check-release-age";
import { isIsoDate } from "../quality/check-refusals";
import {
  compareVersions,
  isExactVersion,
  normalisedInstant,
  parsePackument,
  type RegistryFetch,
  readRegistry,
} from "./plan-bun-update";

export const PIN_STATES = ["up-to-date", "behind", "too-recent", "held", "unreadable"] as const;
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
const API_COMPAT_WORKFLOW = ".github/workflows/reusable-api-compat.yml";
const LOCAL_COMPOSITION = "docs/LOCAL-COMPOSITION.md";

/**
 * The pins this repository declares, and the sites read for each. Sites that
 * carry a version and are NOT read are named in
 * `docs/toolchain/TOOLCHAIN-FRESHNESS.md`. `check-toolchain-freshness.test.ts`
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
      { file: LOCAL_COMPOSITION, pattern: /Bun doit être exactement `([^`]+)`/g },
    ],
    source: { kind: "npm", name: "bun" },
  },
  {
    tool: "rust",
    sites: [
      { file: "rust-toolchain.toml", pattern: /^channel = "([^"]+)"$/gm },
      { file: COMPOSITION_WORKFLOW, pattern: /^\s+toolchain: (\S+)$/gm },
      { file: LOCAL_COMPOSITION, pattern: /rustup toolchain install (\S+) /g },
      { file: LOCAL_COMPOSITION, pattern: /rustup which --toolchain (\S+) /g },
      { file: ".github/composition/check-products.py", pattern: /Rust (\d\S*) and wasm32/g },
    ],
    source: { kind: "rust-stable" },
  },
  {
    tool: "cargo-deny",
    sites: [
      { file: "toolchains/cargo-deny.json", json: ["version"] },
      {
        file: "toolchains/cargo-deny.json",
        pattern: /cargo-deny\/releases\/(?:tag|download)\/([^/"\s]+)/g,
      },
      { file: COMPOSITION_INSTALLER, pattern: /^CARGO_DENY_VERSION = '([^']+)'$/gm },
      { file: DEPENDENCY_POLICY_WORKFLOW, pattern: /^\s+CARGO_DENY_VERSION: (\S+)$/gm },
      {
        file: DEPENDENCY_POLICY_WORKFLOW,
        pattern: /cargo-deny\/releases\/download\/([^/\s]+)\//g,
      },
      { file: LOCAL_COMPOSITION, pattern: /cargo-deny `([^`]+)`/g },
    ],
    source: { kind: "crates", name: "cargo-deny" },
  },
  {
    tool: "cargo-audit",
    sites: [
      { file: DEPENDENCY_POLICY_WORKFLOW, pattern: /^\s+CARGO_AUDIT_VERSION: (\S+)$/gm },
      { file: DEPENDENCY_POLICY_WORKFLOW, pattern: /download\/cargo-audit%2Fv([^/\s]+)\//g },
    ],
    source: { kind: "crates", name: "cargo-audit" },
  },
  {
    tool: "cargo-semver-checks",
    sites: [
      { file: API_COMPAT_WORKFLOW, pattern: /^\s+CARGO_SEMVER_CHECKS_VERSION: (\S+)$/gm },
      {
        file: API_COMPAT_WORKFLOW,
        pattern: /cargo-semver-checks\/releases\/download\/v([^/\s]+)\//g,
      },
    ],
    source: { kind: "crates", name: "cargo-semver-checks" },
  },
  {
    tool: "cargo-llvm-cov",
    sites: [
      { file: COMPOSITION_WORKFLOW, pattern: /cargo install cargo-llvm-cov --version (\S+)/g },
      { file: LOCAL_COMPOSITION, pattern: /cargo install cargo-llvm-cov --version (\S+)/g },
    ],
    source: { kind: "crates", name: "cargo-llvm-cov" },
  },
  {
    tool: "cargo-mutants",
    sites: [
      { file: "toolchains/cargo-mutants.json", json: ["version"] },
      {
        file: "toolchains/cargo-mutants.json",
        pattern: /cargo-mutants\/releases\/(?:tag|download)\/v([^/"\s]+)/g,
      },
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
      { file: LOCAL_COMPOSITION, pattern: /pip install reuse==(\S+)/g },
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
      {
        file: "toolchains/osv-scanner.json",
        pattern: /osv-scanner\/releases\/(?:tag|download)\/v([^/"\s]+)/g,
      },
      { file: COMPOSITION_INSTALLER, pattern: /^OSV_SCANNER_VERSION = '([^']+)'$/gm },
      { file: LOCAL_COMPOSITION, pattern: /osv-scanner `([^`]+)`/g },
      { file: "docs/toolchain/OSV-ADVISORY-DATABASE.md", pattern: /`osv-scanner` (\d\S*),/g },
    ],
    source: { kind: "github-release", repository: "google/osv-scanner" },
  },
];

/** The text of a tracked file by its repository-relative path, or null when it cannot be read. */
export type FileReader = (path: string) => string | null;

/** `sites` is the number of declared sites that were read and held a pin. */
export type PinReading =
  | { readonly kind: "pinned"; readonly version: string; readonly sites: number }
  | { readonly kind: "unreadable"; readonly reason: string; readonly sites: number };

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
  let sites = 0;
  for (const site of pin.sites) {
    const text = readFile(site.file);
    if (text === null) {
      return { kind: "unreadable", reason: `${site.file} cannot be read`, sites };
    }
    const values = siteValues(site, text);
    if (values.length === 0) {
      return { kind: "unreadable", reason: `no pin found in ${site.file}`, sites };
    }
    sites += 1;
    for (const value of values) if (!found.has(value)) found.set(value, site.file);
  }
  const [first, ...others] = [...found];
  if (first === undefined) return { kind: "unreadable", reason: "no site is declared", sites };
  if (others.length > 0) {
    const sightings = [...found].map(([value, file]) => `${JSON.stringify(value)} in ${file}`);
    return { kind: "unreadable", reason: `ambiguous: ${sightings.join(", ")}`, sites };
  }
  return { kind: "pinned", version: first[0], sites };
}

/** The pre-release and build parts are bounded: a pin is printed, never a document. */
const PINNED_VERSION =
  /^((?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8}))(-[0-9A-Za-z.-]{1,32})?(\+[0-9A-Za-z.-]{1,32})?$/;

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
  /**
   * The earliest instant the release can have been published, when the source
   * dates it by a period (a day) and `publishedAt` is the end of that period.
   * Absent when `publishedAt` is an instant.
   */
  readonly publishedNotBefore?: string;
  /**
   * Every version the source publishes and has not withdrawn, when its answer
   * lists them. Absent when the source only names its latest release.
   */
  readonly listed?: readonly string[];
}

export type UpstreamAnswer =
  | { readonly kind: "latest"; readonly release: LatestRelease }
  | { readonly kind: "unreadable"; readonly reason: string };

export interface PinClassification {
  readonly tool: string;
  readonly state: PinState;
  readonly pinned: string | null;
  readonly reason: string;
  /** Declared sites read for this pin. */
  readonly sites: number;
}

/**
 * Classifies one pin. Only what a strict pattern accepted is ever printed: the
 * pinned version, a stable `x.y.z` latest, and an instant rebuilt from the
 * parsed date. A latest that is not a stable release is unreadable rather than
 * compared, and so is a higher release whose age cannot be proved.
 *
 * "Ahead" is a pre-release only. A stable pin above the latest release is a
 * source that contradicts the pin (the pinned release was withdrawn, or the
 * source is not the one the pin comes from): unreadable, never up to date.
 */
export function classifyPin(
  tool: string,
  reading: PinReading,
  upstream: UpstreamAnswer,
  now: Date,
  minimumAgeSeconds: number = MINIMUM_RELEASE_AGE_SECONDS,
): PinClassification {
  const { sites } = reading;
  const unreadable = (pinned: string | null, reason: string): PinClassification => ({
    tool,
    state: "unreadable",
    pinned,
    reason,
    sites,
  });
  if (reading.kind === "unreadable") return unreadable(null, reading.reason);
  const pinned = reading.version;
  const parsed = parsePinned(pinned);
  if (parsed === null) return unreadable(null, `${JSON.stringify(pinned)} is not an exact version`);
  if (upstream.kind === "unreadable") return unreadable(pinned, upstream.reason);
  const latest = upstream.release.version;
  if (!isExactVersion(latest)) {
    return unreadable(pinned, "the latest release is not a stable version");
  }
  const { listed } = upstream.release;
  if (listed !== undefined && !listed.includes(pinned)) {
    return unreadable(pinned, "the source does not publish the pinned version, or withdrew it");
  }
  const order = compareVersions(parsed.release, latest);
  if (order > 0 && !parsed.preRelease) {
    return unreadable(pinned, `the pin is above the latest release ${latest}`);
  }
  if (order > 0) {
    const reason = `pre-release ahead of the latest release ${latest}`;
    return { tool, state: "up-to-date", pinned, reason, sites };
  }
  if (order === 0 && !parsed.preRelease) {
    return { tool, state: "up-to-date", pinned, reason: "the latest release", sites };
  }
  const { publishedAt } = upstream.release;
  const instant = publishedAt === null ? null : normalisedInstant(publishedAt);
  if (instant === null) return unreadable(pinned, `${latest} has no readable publication date`);
  const ageSeconds = Math.floor((now.getTime() - Date.parse(instant)) / 1000);
  // A release dated after now would stay "too recent", and green, for ever.
  // A release dated by its day is in the future only when that day has not
  // begun: on the day itself its end is ahead of now, and it is too recent.
  const earliest = normalisedInstant(upstream.release.publishedNotBefore ?? instant);
  if (earliest === null || now.getTime() < Date.parse(earliest)) {
    return unreadable(pinned, `${latest} is dated in the future, ${earliest ?? instant}`);
  }
  if (ageSeconds < minimumAgeSeconds) {
    const reason = `${latest}, published ${instant}, is younger than ${minimumAgeSeconds} seconds`;
    return { tool, state: "too-recent", pinned, reason, sites };
  }
  return { tool, state: "behind", pinned, reason: `${latest} was published ${instant}`, sites };
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
 * The highest stable, non-yanked version of a crates.io sparse-index file, and
 * every non-yanked version it lists: one JSON document per published version.
 * A line that is not such a document makes the whole file unreadable, never a
 * shorter list.
 */
export function latestFromCratesIndex(text: string, name: string): LatestRelease | null {
  let latest: { version: string; publishedAt: string | null } | null = null;
  const listed: string[] = [];
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
    if (yanked) continue;
    listed.push(vers);
    if (!isExactVersion(vers)) continue;
    if (latest !== null && compareVersions(vers, latest.version) <= 0) continue;
    latest = { version: vers, publishedAt: typeof pubtime === "string" ? pubtime : null };
  }
  return latest === null ? null : { ...latest, listed };
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
  if (Number.isNaN(start)) return { version, publishedAt: null };
  return {
    version,
    publishedAt: new Date(start + DAY_MILLISECONDS).toISOString(),
    publishedNotBefore: new Date(start).toISOString(),
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

export const EXCEPTIONS_PATH = "ecosystem/toolchain-freshness-exceptions.v1.yaml";
export const EXCEPTIONS_SCHEMA_VERSION = "libre-ai.toolchain-freshness-exceptions.v1";

/** A pin knowingly held behind its latest release, at one exact version, until a date. */
export interface FreshnessException {
  readonly tool: string;
  readonly heldAt: string;
  readonly because: string;
  /** Last day the entry holds, `YYYY-MM-DD`, in UTC. */
  readonly until: string;
}

const ROOT_KEYS: readonly string[] = ["schema_version", "exceptions"];
const ENTRY_KEYS: readonly string[] = ["tool", "held_at", "because", "until"];
const ROOT_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const ENTRY_START = /^ {2}- ([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;
const ENTRY_FIELD = /^ {4}([A-Za-z_][A-Za-z0-9_-]*):(?:\s|$)/;

/**
 * The keys of the register as its lines write them. `Bun.YAML.parse` keeps the
 * last of two identical keys without saying so (measured: `tool: bun` then
 * `tool: rust` in one entry reads `rust`), so the register is also read line
 * by line, in the one block style it is written in, the way
 * `tools/quality/check-third-parties.ts` reads its own. A line outside that
 * style throws: a key written quoted, in flow style or as `? key` would
 * otherwise escape the scan.
 */
function writtenKeys(yamlText: string): { root: string[]; entries: string[][] } {
  const root: string[] = [];
  const entries: string[][] = [];
  for (const [index, line] of yamlText.split("\n").entries()) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const rootKey = ROOT_LINE.exec(line)?.[1];
    const startKey = ENTRY_START.exec(line)?.[1];
    const fieldKey = ENTRY_FIELD.exec(line)?.[1];
    if (rootKey !== undefined) root.push(rootKey);
    else if (startKey !== undefined) entries.push([startKey]);
    else if (fieldKey !== undefined && entries.length > 0) entries.at(-1)?.push(fieldKey);
    else {
      throw new Error(
        `${EXCEPTIONS_PATH}: line ${index + 1} is outside the block style the register is written in`,
      );
    }
  }
  return { root, entries };
}

/** Throws on a key written twice, or on a key that is not one of `allowed`. */
function refuseKeys(at: string, keys: readonly string[], allowed: readonly string[]): void {
  const twice = keys.find((key, index) => keys.indexOf(key) !== index);
  if (twice !== undefined) throw new Error(`${at}: \`${twice}\` is written twice`);
  const unknown = keys.find((key) => !allowed.includes(key));
  if (unknown !== undefined) {
    throw new Error(`${at}: \`${unknown}\` is not one of ${allowed.join(", ")}`);
  }
}

/**
 * The exception register; a malformed entry throws, so the report never runs
 * on half a register. Closed world: a key this reader does not know is a
 * failure, never an ignored line, at the root as in an entry.
 */
export function parseFreshnessExceptions(yamlText: string): FreshnessException[] {
  const written = writtenKeys(yamlText);
  refuseKeys(EXCEPTIONS_PATH, written.root, ROOT_KEYS);
  for (const [index, keys] of written.entries.entries()) {
    refuseKeys(`${EXCEPTIONS_PATH}: exceptions[${index}]`, keys, ENTRY_KEYS);
  }
  const document: unknown = Bun.YAML.parse(yamlText);
  if (!isRecord(document) || document.schema_version !== EXCEPTIONS_SCHEMA_VERSION) {
    throw new Error(`${EXCEPTIONS_PATH}: schema_version must be ${EXCEPTIONS_SCHEMA_VERSION}`);
  }
  const entries = document.exceptions;
  if (!Array.isArray(entries)) {
    throw new Error(`${EXCEPTIONS_PATH}: \`exceptions\` must be a list`);
  }
  if (entries.length !== written.entries.length) {
    throw new Error(
      `${EXCEPTIONS_PATH}: ${entries.length} entries parsed, ${written.entries.length} written in block style`,
    );
  }
  const seen = new Set<string>();
  return (entries as unknown[]).map((entry, index) => {
    const at = `${EXCEPTIONS_PATH}: exceptions[${index}]`;
    if (!isRecord(entry)) throw new Error(`${at} must be a mapping`);
    const { tool, held_at: heldAt, because, until } = entry;
    for (const [key, value] of Object.entries({ tool, held_at: heldAt, because })) {
      if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
        throw new Error(`${at}.${key} is required, on one line`);
      }
    }
    if (parsePinned(heldAt as string) === null) {
      throw new Error(`${at}.held_at must be an exact version`);
    }
    if (!isIsoDate(until)) {
      throw new Error(`${at}.until is required, as a YYYY-MM-DD date`);
    }
    if (seen.has(tool as string)) throw new Error(`${at} duplicates the entry for ${tool}`);
    seen.add(tool as string);
    return {
      tool: tool as string,
      heldAt: heldAt as string,
      because: because as string,
      until: until as string,
    };
  });
}

export interface ExceptionVerdict {
  readonly classifications: readonly PinClassification[];
  /** One line per entry of the register that fails the run. */
  readonly failures: readonly string[];
}

/**
 * Confronts the register with what was measured. An entry turns a pin with a
 * higher release (`behind`, or `too-recent`: the pin would flap red three days
 * after every release otherwise) into `held`, and only when it names the exact
 * pinned version and its date has not passed. Every other entry is a failure,
 * and its pin keeps the state that was measured. The entry of a pin that could
 * not be read is not judged: nothing was established about that pin.
 */
export function applyExceptions(
  classifications: readonly PinClassification[],
  exceptions: readonly FreshnessException[],
  now: Date,
): ExceptionVerdict {
  const today = now.toISOString().slice(0, 10);
  const byTool = new Map(exceptions.map((exception) => [exception.tool, exception]));
  const met = new Set<string>();
  const failures: string[] = [];
  const judged = classifications.map((classification) => {
    const { tool, state, pinned, reason } = classification;
    const exception = byTool.get(tool);
    if (exception === undefined) return classification;
    met.add(tool);
    if (state === "unreadable") return classification;
    if (state === "up-to-date") {
      failures.push(`dead exception: ${tool} is up to date; remove the entry`);
      return classification;
    }
    if (exception.heldAt !== pinned) {
      failures.push(
        `stale exception: ${tool} is held at ${exception.heldAt} and pinned at ${pinned}; remove the entry`,
      );
      return classification;
    }
    // `YYYY-MM-DD` strings order like the dates they name.
    if (today > exception.until) {
      failures.push(`expired exception: ${tool} was held until ${exception.until}`);
      return classification;
    }
    const held = `${reason}; held until ${exception.until}: ${exception.because}`;
    return { ...classification, state: "held" as const, reason: held };
  });
  for (const { tool } of exceptions) {
    if (!met.has(tool)) failures.push(`dead exception: ${tool} is not a declared pin`);
  }
  return { classifications: judged, failures };
}

export interface FreshnessTally extends Readonly<Record<PinState, number>> {
  readonly pins: number;
  readonly sitesDeclared: number;
  readonly sitesRead: number;
}

/**
 * States are counted once per tool while `pins` is the number of declared
 * entries: a tool declared twice is classified twice and counted once, so the
 * sum falls short of the pins and the volume does not hold.
 */
export function tallyOf(
  pins: readonly Pick<ToolchainPin, "tool" | "sites">[],
  classifications: readonly PinClassification[],
): FreshnessTally {
  const counts = Object.fromEntries(PIN_STATES.map((state) => [state, 0])) as Record<
    PinState,
    number
  >;
  const byTool = new Map(
    classifications.map((classification) => [classification.tool, classification]),
  );
  for (const { state } of byTool.values()) counts[state] += 1;
  return {
    ...counts,
    pins: pins.length,
    sitesDeclared: pins.reduce((sum, pin) => sum + pin.sites.length, 0),
    sitesRead: classifications.reduce((sum, classification) => sum + classification.sites, 0),
  };
}

export function volumeHolds(tally: FreshnessTally): boolean {
  return PIN_STATES.reduce((sum, state) => sum + tally[state], 0) === tally.pins;
}

export function volumeLine(tally: FreshnessTally, exceptions: number, failures: number): string {
  const parts = PIN_STATES.map((state) => `${state}=${tally[state]}`).join(" ");
  const sites = `sites=${tally.sitesRead}/${tally.sitesDeclared}`;
  return `examined: pins=${tally.pins} ${sites} ${parts} exceptions=${exceptions} exception-failures=${failures}`;
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

/**
 * One line per pin, one per failing exception, then the volume line. Status 1
 * when a pin is behind or unreadable, an exception fails, or the volume does
 * not sum to the pins.
 */
export async function freshnessReport(
  pins: readonly ToolchainPin[],
  exceptions: readonly FreshnessException[],
  readFile: FileReader,
  read: UpstreamReader,
  now: Date,
): Promise<FreshnessReport> {
  const measured = await classifyAll(pins, readFile, read, now);
  const { classifications, failures } = applyExceptions(measured, exceptions, now);
  const tally = tallyOf(pins, classifications);
  const lines = [
    ...renderPins(classifications),
    ...failures,
    volumeLine(tally, exceptions.length, failures.length),
  ];
  // No pin at all is a list that moved, not a fleet that is up to date.
  if (tally.pins === 0 || !volumeHolds(tally)) return { lines, status: 1 };
  const red = tally.behind > 0 || tally.unreadable > 0 || failures.length > 0;
  return { lines, status: red ? 1 : 0 };
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
  // The register is read first: a report that cannot tell a held pin from a
  // late one would print states nobody declared.
  const register = readFile(EXCEPTIONS_PATH);
  let exceptions: FreshnessException[];
  try {
    if (register === null) throw new Error(`${EXCEPTIONS_PATH} cannot be read`);
    exceptions = parseFreshnessExceptions(register);
  } catch (error) {
    console.error(`exception register unreadable: ${(error as Error).message}`);
    return 1;
  }
  const { lines, status } = await freshnessReport(pins, exceptions, readFile, read, now);
  for (const line of lines) console.log(line);
  return status;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
