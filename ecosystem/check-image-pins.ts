/**
 * Container image pinning across the fleet.
 *
 * A tag named in a build file or a compose file is a pointer the image's
 * publisher can move: the next build or the next `up` runs whatever it points
 * to. Only a digest names fixed content. `check-action-pins` carries that rule
 * for the `uses:` of workflows; this gate carries it for the files that build
 * and start containers, in every active, public entry of
 * `ecosystem/repositories.v1.yaml`.
 *
 * Read at `HEAD` (the served branch), for every tracked build file
 * (`Dockerfile`, `Dockerfile.<x>`, `<x>.Dockerfile`, `Containerfile`) and every
 * tracked compose file, at three sites:
 *
 *   - the image of each `FROM` (`--platform=…` and `AS <name>` set aside);
 *   - the value of each `COPY --from=<value>`;
 *   - the value of each `image` key of a compose file.
 *
 * Each reference is one of four kinds:
 *
 *   - `pinned` — ends with `@sha256:<64 lowercase hex>`, tag present or not;
 *   - `unpinned` — any other image, including one that carries a `$`: a
 *     reference built from a variable is not fixed by the file that names it,
 *     wherever the variable gets its value;
 *   - `stage` — the name of a stage declared above by `AS`, or the index of an
 *     earlier stage in `COPY --from`: not an image;
 *   - `scratch` — `FROM scratch`, counted apart.
 *
 * Compose files are read by two readers — a line scanner and a YAML parse —
 * that must return the same multiset, or the file is unreadable: an `image`
 * written in a flow mapping would otherwise escape one of them.
 *
 * What this gate does not see, by construction:
 *
 *   - private and archived repositories: exempt, their content is not read;
 *   - references outside the three sites: `RUN --mount=…,from=`, and the
 *     `container:` / `services.*.image` of workflows;
 *   - a build file that changes its escape character (`# escape=`), and
 *     instruction-looking lines inside a heredoc;
 *   - whether a digest is the one the registry serves for the target
 *     architecture: that needs a registry, and this gate reads no registry.
 *
 * No workflow calls this gate and `bun run check` does not include it.
 */

import { parseYaml } from "../tools/quality/yaml-text-guard";
import { parseRegistry, type RegistryEntry } from "./check-context-conformance";
import { exemption, type FleetFileReader, readRepositoryFiles } from "./fleet-tree";

/** The `docker` pattern of check-dependabot-conformance.ts, unchanged. */
export const BUILD_FILE = /(^|\/)(Dockerfile([.-][^/]*)?|[^/]+\.Dockerfile|Containerfile)$/;
/** The `docker-compose` pattern of check-dependabot-conformance.ts, unchanged. */
export const COMPOSE_FILE = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/;

export function containerFileKind(path: string): "build" | "compose" | null {
  if (BUILD_FILE.test(path)) return "build";
  if (COMPOSE_FILE.test(path)) return "compose";
  return null;
}

export function isContainerDefinition(path: string): boolean {
  return containerFileKind(path) !== null;
}

export const IMAGE_DIGEST = /@sha256:[0-9a-f]{64}$/;

export type ImageReferenceKind = "pinned" | "unpinned" | "stage" | "scratch";

export interface ImageReference {
  readonly line: number;
  readonly reference: string;
  readonly kind: ImageReferenceKind;
}

export interface ImageScan {
  readonly references: ImageReference[];
  readonly unreadable: string | null;
}

/** An image reference, stage names and `scratch` already set aside. */
export function classifyImage(reference: string): "pinned" | "unpinned" {
  if (reference.includes("$")) return "unpinned";
  return IMAGE_DIGEST.test(reference) ? "pinned" : "unpinned";
}

interface Instruction {
  readonly line: number;
  readonly words: readonly string[];
}

/**
 * Logical instructions of a build file: comment lines dropped, a trailing
 * backslash glued to the next line without adding a character, as the builder
 * does. The line reported is the one the instruction starts on.
 */
function readInstructions(text: string): Instruction[] {
  const instructions: Instruction[] = [];
  let pending: { line: number; text: string } | null = null;
  const flush = (): void => {
    if (pending === null) return;
    const words = pending.text.split(/\s+/).filter((word) => word !== "");
    instructions.push({ line: pending.line, words });
    pending = null;
  };
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trimEnd();
    const trimmed = line.trimStart();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const continued = line.endsWith("\\");
    const body = continued ? line.slice(0, -1) : line;
    if (pending === null) pending = { line: index + 1, text: body };
    else pending.text += body;
    if (!continued) flush();
  }
  flush();
  return instructions;
}

const STAGE_INDEX = /^\d+$/;
const COPY_FROM = /^--from=(.*)$/;

/** Every `FROM` image and every `COPY --from` value of a build file. */
export function scanBuildFile(text: string): ImageScan {
  const references: ImageReference[] = [];
  const stages = new Set<string>();
  let stageCount = 0;
  for (const { line, words } of readInstructions(text)) {
    const keyword = (words[0] ?? "").toUpperCase();
    if (keyword === "FROM") {
      const operands = words.slice(1).filter((word) => !word.startsWith("--"));
      const reference = operands[0] ?? "";
      let kind: ImageReferenceKind;
      if (reference.toLowerCase() === "scratch") kind = "scratch";
      else if (stages.has(reference.toLowerCase())) kind = "stage";
      else kind = classifyImage(reference);
      references.push({ line, reference, kind });
      const name = operands[2];
      if ((operands[1] ?? "").toLowerCase() === "as" && name !== undefined) {
        stages.add(name.toLowerCase());
      }
      stageCount++;
    } else if (keyword === "COPY") {
      for (const word of words.slice(1)) {
        if (!word.startsWith("--")) break;
        const reference = COPY_FROM.exec(word)?.[1];
        if (reference === undefined) continue;
        let kind: ImageReferenceKind;
        // Stages are numbered from 0; the stage being built is `stageCount - 1`.
        if (STAGE_INDEX.test(reference)) {
          kind = Number(reference) < stageCount - 1 ? "stage" : "unpinned";
        } else if (stages.has(reference.toLowerCase())) kind = "stage";
        else kind = classifyImage(reference);
        references.push({ line, reference, kind });
      }
    }
  }
  if (stageCount === 0) {
    return { references, unreadable: "no FROM instruction — not a build file this gate can read" };
  }
  return { references, unreadable: null };
}

const IMAGE_LINE = /^\s*(?:-\s+)?image\s*:\s*(.*)$/;

/** Reader 1: every block-style `image:` line, comment stripped, quotes removed. */
function scanImageLines(text: string): { line: number; reference: string }[] {
  const found: { line: number; reference: string }[] = [];
  for (const [index, raw] of text.split("\n").entries()) {
    const match = IMAGE_LINE.exec(raw);
    if (match === null) continue;
    let value = (match[1] ?? "").trim();
    const quoted = /^(["'])(.*)\1/.exec(value);
    if (quoted !== null) value = quoted[2] ?? "";
    else value = value.replace(/\s+#.*$/, "").trim();
    found.push({ line: index + 1, reference: value });
  }
  return found;
}

/** Reader 2: every string value of an `image` key, at any depth of the parsed document. */
function collectImageValues(document: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "image" && typeof value === "string") found.push(value);
        else walk(value);
      }
    }
  };
  walk(document);
  return found;
}

/** Every `image` value of a compose file, or why the two readers cannot vouch for it. */
export function scanComposeFile(text: string): ImageScan {
  const lines = scanImageLines(text);
  const references = lines.map(({ line, reference }) => ({
    line,
    reference,
    kind: classifyImage(reference),
  }));
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    // The parser's message can quote the file; only the fact is reported.
    return { references, unreadable: "YAML parse failed" };
  }
  const fromLines = lines.map((r) => r.reference).sort();
  const fromYaml = collectImageValues(parsed).sort();
  if (JSON.stringify(fromLines) !== JSON.stringify(fromYaml)) {
    return {
      references,
      unreadable: `the line scanner found ${fromLines.length} \`image:\` and the YAML parse ${fromYaml.length}, or different values — one reader is blind to part of the file`,
    };
  }
  return { references, unreadable: null };
}

export interface ImagePinTally {
  repositories: number;
  exempt: number;
  filesTracked: number;
  filesExamined: number;
  pinned: number;
  unpinned: number;
  stage: number;
  scratch: number;
}

export function emptyTally(): ImagePinTally {
  return {
    repositories: 0,
    exempt: 0,
    filesTracked: 0,
    filesExamined: 0,
    pinned: 0,
    unpinned: 0,
    stage: 0,
    scratch: 0,
  };
}

export function summarizeVolume(t: ImagePinTally): string {
  const images = t.pinned + t.unpinned;
  return `${t.repositories + t.exempt} inventory entries (${t.repositories} read, ${t.exempt} exempt): ${t.filesExamined} of ${t.filesTracked} tracked container file(s) examined, ${images} image reference(s) = ${t.pinned} pinned by digest + ${t.unpinned} unpinned; ${t.stage} stage reference(s), ${t.scratch} scratch`;
}

export interface ItemCheck {
  readonly item: string;
  readonly ok: boolean;
  readonly note: string;
}

const NOTE_REFERENCE_LIMIT = 200;

/**
 * The reference as it may be printed: it comes from a file anyone can push to,
 * and a note ends up on a terminal and in a job log.
 */
function printable(reference: string): string {
  return reference.slice(0, NOTE_REFERENCE_LIMIT).replace(/[^\x20-\x7e]/g, "?");
}

export async function reviewRepository(
  entry: RegistryEntry,
  tally: ImagePinTally,
  reader: FleetFileReader = readRepositoryFiles,
): Promise<ItemCheck[]> {
  const exempt = exemption(entry);
  if (exempt !== null) {
    tally.exempt++;
    return [{ item: entry.repository, ok: true, note: `exempt: ${exempt}` }];
  }
  tally.repositories++;
  const { listing, files } = await reader(entry.repository, isContainerDefinition);
  if (listing.kind === "unreadable") {
    return [
      { item: entry.repository, ok: false, note: `tree unreadable at HEAD: ${listing.reason}` },
    ];
  }
  const definitions = listing.paths.filter(isContainerDefinition);
  tally.filesTracked += definitions.length;
  if (definitions.length === 0) {
    return [{ item: entry.repository, ok: true, note: "no container definition tracked" }];
  }
  const checks: ItemCheck[] = [];
  for (const path of definitions) {
    const item = `${entry.repository}:${path}`;
    const read = files.get(path);
    if (read === undefined || read.kind === "unreadable") {
      checks.push({
        item,
        ok: false,
        note: `unreadable at HEAD: ${read?.reason ?? "no read outcome recorded"}`,
      });
      continue;
    }
    const scan =
      containerFileKind(path) === "compose" ? scanComposeFile(read.text) : scanBuildFile(read.text);
    if (scan.unreadable !== null) {
      checks.push({ item, ok: false, note: `unreadable: ${scan.unreadable}` });
      continue;
    }
    tally.filesExamined++;
    const failures: string[] = [];
    for (const reference of scan.references) {
      tally[reference.kind]++;
      if (reference.kind === "unpinned") {
        failures.push(
          `line ${reference.line}: \`${printable(reference.reference)}\` is not pinned by digest — end it with \`@sha256:<64 hex>\` and keep the tag in front of it`,
        );
      }
    }
    checks.push({
      item,
      ok: failures.length === 0,
      note:
        failures.length === 0
          ? `${scan.references.length} reference(s), none unpinned`
          : failures.join("; "),
    });
  }
  return checks;
}

/** A fleet where no image reference was examined verified nothing, and says so. */
export function fleetVerdict(tally: ImagePinTally): ItemCheck {
  const images = tally.pinned + tally.unpinned;
  if (images === 0) {
    return {
      item: "fleet",
      ok: false,
      note: "no image reference examined across the fleet — this gate verified nothing",
    };
  }
  return { item: "fleet", ok: true, note: `${images} image reference(s) examined` };
}

if (import.meta.main) {
  const { concludeGate, GateReport } = await import("../tools/quality/gate-report");
  const registry = parseRegistry(await Bun.file("ecosystem/repositories.v1.yaml").text());
  const report = new GateReport();
  const tally = emptyTally();
  for (const entry of registry) {
    for (const check of await reviewRepository(entry, tally)) {
      report.check(check.item, check.ok, check.note);
    }
  }
  const fleet = fleetVerdict(tally);
  report.check(fleet.item, fleet.ok, fleet.note);
  report.volume(summarizeVolume(tally));
  if (report.outcome !== "pass") console.error(`Image pins volume: ${summarizeVolume(tally)}`);
  concludeGate("Image pins", report);
}
