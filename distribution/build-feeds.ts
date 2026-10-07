/**
 * Evidence feed generator (positioning L5, "distribution automatique v0").
 *
 * I-20 says evidence is published by default — but nothing projected that
 * evidence into consumable surfaces: a gate verdict, an adoption attestation
 * or a sovereignty report only became visible to someone who already knew
 * where to look. This script projects the evidence sources into three
 * committed surfaces (Markdown changelog, JSON feed, Atom feed) so every new
 * piece of evidence becomes visible without a human gesture; the companion
 * `feeds-freshness` workflow turns a stale projection into a red gate.
 *
 * Determinism contract (same as ecosystem/build-index.ts): no execution
 * timestamp — every date comes from the source data — stable sort, code-unit
 * comparisons, so the committed feeds only change when the evidence changes
 * and a CI regeneration diff is a meaningful drift signal, never noise.
 *
 * The feeds are projections, never authorities: the gate acceptance log keeps
 * the authoritative wording of every verdict, the feeds carry a short status
 * plus a link back to the artifact.
 *
 * Usage: bun distribution/build-feeds.ts
 * Writes: distribution/feeds/{changelog.md,evidence.json,evidence.atom.xml}
 */

import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const FEED_SCHEMA_VERSION = "libre-ai.evidence-feed.v1";
export const REPOSITORY = "libre-ai/libre-ai";
export const GATE_LOG_PATH = "distribution/evidence/gate-acceptance-log.md";
/** Public artifact links point at the canonical branch of the public mirror. */
export const GITHUB_BLOB_BASE = "https://github.com/libre-ai/libre-ai/blob/main/";
/**
 * tag: URIs (RFC 4151) need an authority the minting entity controls at the
 * tagged date; the GitHub Pages subdomain of the organization is the only
 * domain the organization holds by construction.
 */
const FEED_TAG_ID = "tag:libre-ai.github.io,2026:evidence";

export type EventType = "gate" | "adoption" | "sovereignty" | "coverage";

export interface EvidenceEvent {
  /** Stable across regenerations — feed consumers deduplicate on it. */
  id: string;
  /** ISO 8601, date-only or full timestamp, exactly as the source states it. */
  date: string;
  /** Present only when the source wrote a non-ISO date (e.g. a day range). */
  date_raw?: string;
  type: EventType;
  title: string;
  /** Short verdict/status; the full wording stays in the source artifact. */
  status: string;
  /** Repository-relative path of the source artifact. */
  artifact: string;
  /** Verifiable reference text carried verbatim from the source. */
  reference?: string;
}

export interface EvidenceFeed {
  schema_version: typeof FEED_SCHEMA_VERSION;
  repository: typeof REPOSITORY;
  events: EvidenceEvent[];
}

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
/** Dated evidence files only: `latest.json`-style mutable aliases would
 * duplicate their dated twin as a second event. */
const DATED_JSON = /^\d{4}-\d{2}-\d{2}-.*\.json$/;
const COVERAGE_JSON = /^coverage-.*\.json$/;

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`);
}

function asRecord(value: unknown, source: string, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(source, `${path}: expected a mapping, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, source: string, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(source, `${path}: expected a non-empty string, got ${typeof value}`);
  }
  return value;
}

function asNumber(value: unknown, source: string, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(source, `${path}: expected a finite number, got ${typeof value}`);
  }
  return value;
}

function firstIsoDate(text: string): string | undefined {
  return ISO_DATE.exec(text)?.[0];
}

/** Bold markers are presentation inside the source Markdown, not data. */
function stripBold(text: string): string {
  return text.replaceAll("**", "");
}

function slugify(text: string): string {
  // NFD then strip combining marks: accented letters slug to their base
  // letter identically on every runtime.
  const ascii = text.normalize("NFD").replace(/[\u{0300}-\u{036f}]/gu, "");
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60).replace(/-+$/, "");
}

/**
 * The verdict cell of the gate log ranges from one word to a paragraph. The
 * feed status keeps the segment before the first em dash — the verdict token
 * by the log's own writing convention — and never copies the full narrative:
 * the log stays the authority of wording, the feed links back to it.
 */
function shortVerdict(cell: string): string {
  const plain = stripBold(cell).trim();
  const head = plain.split("—")[0]?.trim() ?? "";
  return head.length > 0 ? head : plain;
}

/**
 * Parses the public gate acceptance log (a Markdown table, one verdict per
 * row). A row that does not expose the four expected cells is NOT guessed at:
 * it becomes a minimal `gate` event carrying the raw line as its reference,
 * so the feed never invents a verdict (fail-honest, not fail-silent). A row
 * without any ISO date cannot be placed on a timeline at all — that is a hard
 * error the freshness gate surfaces.
 */
export function parseGateLog(markdown: string): EvidenceEvent[] {
  const events: EvidenceEvent[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    // Alignment separator row: only pipes, dashes, colons and spaces.
    if (/^[|\s:-]+$/.test(trimmed)) continue;
    const cells = trimmed.split("|").map((cell) => cell.trim());
    // A leading and trailing pipe produce empty first/last fragments.
    const inner = cells.slice(1, -1);
    if (inner[0]?.toLowerCase() === "date") continue;
    const dateCell = inner[0] ?? "";
    const date = firstIsoDate(dateCell) ?? firstIsoDate(trimmed);
    if (date === undefined) {
      fail(GATE_LOG_PATH, `row without an ISO 8601 date: ${trimmed}`);
    }
    if (inner.length !== 4) {
      events.push({
        id: `gate-${date}-${slugify(trimmed) || "unparsed"}`,
        date,
        type: "gate",
        title: "Gate log entry (unparsed row)",
        status: "unparsed",
        artifact: GATE_LOG_PATH,
        reference: trimmed,
      });
      continue;
    }
    const title = stripBold(inner[1] ?? "").trim();
    const event: EvidenceEvent = {
      id: `gate-${date}-${slugify(title)}`,
      date,
      // Preserve the source's own date writing when it is not plain ISO
      // (e.g. the "2026-07-18/19" range): the event date is the first day,
      // the raw cell keeps the range honest. Insertion position matters:
      // the JSON feed serializes fields in this order.
      ...(dateCell === date ? {} : { date_raw: dateCell }),
      type: "gate",
      title,
      status: shortVerdict(inner[2] ?? ""),
      artifact: GATE_LOG_PATH,
    };
    const reference = (inner[3] ?? "").trim();
    if (reference.length > 0) event.reference = reference;
    events.push(event);
  }
  return events;
}

/** One blank-room reproduction attestation (libre-ai.adoption-reproduction.v1). */
export function parseAdoption(fileName: string, jsonText: string): EvidenceEvent {
  const source = `distribution/evidence/adoption/${fileName}`;
  const record = asRecord(JSON.parse(jsonText), source, "document");
  const schema = asString(record.schemaVersion, source, "schemaVersion");
  if (schema !== "libre-ai.adoption-reproduction.v1") {
    fail(source, `unsupported schemaVersion "${schema}" — wire the new schema deliberately`);
  }
  const runId = asString(record.runId, source, "runId");
  const date = asString(record.generatedAt, source, "generatedAt");
  if (firstIsoDate(date) !== date.slice(0, 10)) {
    fail(source, `generatedAt is not ISO 8601: ${date}`);
  }
  return {
    id: `adoption-${slugify(runId)}`,
    date,
    type: "adoption",
    title: `Adoption attestation ${runId} — blank-room reproduction`,
    status: asString(record.verdict, source, "verdict"),
    artifact: source,
  };
}

/** One sovereignty checks report (libre-ai.sovereignty.v1). */
export function parseSovereignty(fileName: string, jsonText: string): EvidenceEvent {
  const source = `distribution/evidence/sovereignty/${fileName}`;
  const record = asRecord(JSON.parse(jsonText), source, "document");
  const schema = asString(record.schemaVersion, source, "schemaVersion");
  if (schema !== "libre-ai.sovereignty.v1") {
    fail(source, `unsupported schemaVersion "${schema}" — wire the new schema deliberately`);
  }
  const run = asRecord(record.run, source, "run");
  const date = asString(run.date, source, "run.date");
  const commit = asString(run.commit, source, "run.commit");
  const summary = asRecord(record.summary, source, "summary");
  const pass = asNumber(summary.pass, source, "summary.pass");
  const failed = asNumber(summary.fail, source, "summary.fail");
  const pending = asNumber(summary.pending, source, "summary.pending");
  return {
    id: `sovereignty-${date}-${commit.slice(0, 7)}`,
    date,
    type: "sovereignty",
    title: `Sovereignty report (commit ${commit.slice(0, 7)}) — ${pass} pass, ${failed} fail, ${pending} pending`,
    // A single failed check fails the whole report: sovereignty is fail-closed.
    status: failed > 0 ? "fail" : "pass",
    artifact: source,
  };
}

/**
 * One automation-coverage measurement. The report JSON carries no date by
 * design (it is a pure measurement); the dated filename is the source of the
 * event date, consistent with the evidence directory's naming convention.
 */
export function parseCoverage(fileName: string, jsonText: string): EvidenceEvent {
  const source = `distribution/evidence/${fileName}`;
  const date = firstIsoDate(fileName);
  if (date === undefined) {
    fail(source, "coverage report filename carries no ISO 8601 date");
  }
  const record = asRecord(JSON.parse(jsonText), source, "document");
  const window = asString(record.window, source, "window");
  const pct = asNumber(
    record.genuine_automation_coverage_pct,
    source,
    "genuine_automation_coverage_pct",
  );
  return {
    id: slugify(fileName.replace(/\.json$/, "")),
    date,
    type: "coverage",
    title: `Automation coverage measurement (${window})`,
    status: `${pct}% genuine automation`,
    artifact: source,
  };
}

/**
 * Reads every evidence source under one root. Directory listings are sorted:
 * readdir order is filesystem-dependent and the feeds must be byte-identical
 * on every machine.
 */
export async function collectEvents(evidenceDir: URL): Promise<EvidenceEvent[]> {
  const events: EvidenceEvent[] = [];
  events.push(
    ...parseGateLog(await Bun.file(new URL("gate-acceptance-log.md", evidenceDir)).text()),
  );
  for (const name of (await readdir(fileURLToPath(evidenceDir))).sort()) {
    if (COVERAGE_JSON.test(name)) {
      events.push(parseCoverage(name, await Bun.file(new URL(name, evidenceDir)).text()));
    }
  }
  const adoptionDir = new URL("adoption/", evidenceDir);
  for (const name of (await readdir(fileURLToPath(adoptionDir))).sort()) {
    if (DATED_JSON.test(name)) {
      events.push(parseAdoption(name, await Bun.file(new URL(name, adoptionDir)).text()));
    }
  }
  const sovereigntyDir = new URL("sovereignty/", evidenceDir);
  for (const name of (await readdir(fileURLToPath(sovereigntyDir))).sort()) {
    if (DATED_JSON.test(name)) {
      events.push(parseSovereignty(name, await Bun.file(new URL(name, sovereigntyDir)).text()));
    }
  }
  return events;
}

/**
 * Newest first. Dates compare as code units (ISO 8601 orders lexically; a
 * date-only string sorts before a timestamp of the same day, which is stable
 * and documented rather than guessed). Ties keep collection order reversed —
 * the gate log is append-only chronological, so the later row of a same-day
 * pair is the more recent verdict.
 */
export function sortEvents(events: EvidenceEvent[]): EvidenceEvent[] {
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) {
      fail("evidence-feed", `duplicate event id ${event.id} — ids must stay stable and unique`);
    }
    seen.add(event.id);
  }
  return events
    .map((event, sequence) => ({ event, sequence }))
    .sort((a, b) => {
      if (a.event.date < b.event.date) return 1;
      if (a.event.date > b.event.date) return -1;
      return b.sequence - a.sequence;
    })
    .map((entry) => entry.event);
}

export function buildFeed(events: EvidenceEvent[]): EvidenceFeed {
  return {
    schema_version: FEED_SCHEMA_VERSION,
    repository: REPOSITORY,
    events: sortEvents(events),
  };
}

/** changelog.md lives in distribution/feeds/, two levels below the repo root. */
function relativeFromFeeds(repoRelativePath: string): string {
  return `../../${repoRelativePath}`;
}

export function renderChangelog(feed: EvidenceFeed): string {
  const lines: string[] = [
    "# Changelog d'évidence — Libre AI",
    "",
    "Fichier généré par `distribution/build-feeds.ts` — ne pas éditer à la main.",
    "Une entrée datée par événement d'évidence (verdict de gate, attestation",
    "d'adoption, rapport de souveraineté, mesure de couverture), la plus récente",
    "en tête. Chaque entrée lie son artefact source ; l'autorité de formulation",
    `des verdicts reste le journal des gates (\`${GATE_LOG_PATH}\`).`,
    "",
  ];
  for (const event of feed.events) {
    lines.push(`## ${event.date.slice(0, 10)} — [${event.type}] ${event.title}`, "");
    lines.push(`- Statut : ${event.status}`);
    if (event.date_raw !== undefined) {
      lines.push(`- Date source : ${event.date_raw}`);
    }
    lines.push(`- Source : [\`${event.artifact}\`](${relativeFromFeeds(event.artifact)})`);
    if (event.reference !== undefined) {
      lines.push(`- Référence : ${event.reference}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderJsonFeed(feed: EvidenceFeed): string {
  return `${JSON.stringify(feed, null, 2)}\n`;
}

/** Atom requires RFC 3339 timestamps; a date-only event maps to midnight UTC
 * by convention (documented, deterministic, never invented per-run). */
function toRfc3339(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return `${date}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(date)) {
    return date;
  }
  fail("evidence-feed", `date is not ISO 8601: ${date}`);
}

/** Single escaper for text nodes and attribute values (attributes are always
 * double-quoted here, so the five predefined entities cover both contexts). */
export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderAtom(feed: EvidenceFeed): string {
  const newest = feed.events[0];
  if (newest === undefined) {
    // An empty feed means the evidence sources vanished — that is drift, not
    // an empty-but-valid publication.
    fail("evidence-feed", "no evidence events found; refusing to publish an empty feed");
  }
  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${FEED_TAG_ID}</id>`,
    "  <title>Libre AI — evidence feed</title>",
    "  <subtitle>Gate verdicts, adoption attestations, sovereignty reports and coverage measurements, projected from the public evidence directory.</subtitle>",
    `  <updated>${toRfc3339(newest.date)}</updated>`,
    "  <author><name>Libre AI</name></author>",
    `  <link rel="alternate" type="text/html" href="${GITHUB_BLOB_BASE}distribution/feeds/changelog.md"/>`,
    '  <link rel="self" type="application/atom+xml" href="https://raw.githubusercontent.com/libre-ai/libre-ai/main/distribution/feeds/evidence.atom.xml"/>',
  ];
  for (const event of feed.events) {
    const summary =
      event.reference === undefined ? event.status : `${event.status} — ${event.reference}`;
    lines.push(
      "  <entry>",
      `    <id>${FEED_TAG_ID}/${escapeXml(event.id)}</id>`,
      `    <title>${escapeXml(event.title)}</title>`,
      `    <updated>${toRfc3339(event.date)}</updated>`,
      `    <link rel="alternate" href="${escapeXml(GITHUB_BLOB_BASE + event.artifact)}"/>`,
      `    <category term="${escapeXml(event.type)}"/>`,
      `    <summary>${escapeXml(summary)}</summary>`,
      "  </entry>",
    );
  }
  lines.push("</feed>");
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const evidenceDir = new URL("evidence/", import.meta.url);
  const feed = buildFeed(await collectEvents(evidenceDir));
  await Bun.write(new URL("feeds/changelog.md", import.meta.url), renderChangelog(feed));
  await Bun.write(new URL("feeds/evidence.json", import.meta.url), renderJsonFeed(feed));
  await Bun.write(new URL("feeds/evidence.atom.xml", import.meta.url), renderAtom(feed));
  const counts = new Map<EventType, number>();
  for (const event of feed.events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  const breakdown = [...counts.entries()].map(([type, count]) => `${type}=${count}`).join(" ");
  console.log(`wrote distribution/feeds (${feed.events.length} events: ${breakdown})`);
}
