import { concludeGate, GateReport } from "./gate-report";

// An ADR that is amended, superseded or replaced must say so in its own header.
//
// Agents read an ADR file on its own: they open `docs/adr/0018-*.md`, see
// `Statut : accepted`, and act on it. Nothing in that file told them that
// ADR-0020 §2.2 superseded its wave framework: the forward declaration lives in
// the newer ADR, which the agent has no reason to open. Measured on 2026-11-17,
// on the served branch before this gate: one ADR out of 69 carried a
// supersession in its header (ADR-0005), and this gate failed there on 17 of
// 30 assertions: 14 amendments (over 11 ADRs) not visible from the amended
// ADR, plus 3 forward declarations that named no ADR
// (`bun tools/quality/check-adr-supersession.ts` on that tree).
//
// Google measured the cost of this class on coding agents
// (developers.googleblog.com/agent-distraction, 2026-11-06): stale markers in a
// codebase send agents on detours, 41 % of which chase a closed dead end. A
// stale doctrine document is the same defect, read by the same agents, with a
// doctrine authority attached.
//
// So the relation is checked in both directions. A forward declaration in an
// accepted ADR (`**Amende :**`, `**Supersède… :**`, `**Remplace :**`,
// `**Lève :**`, `**Rend caduque :**`) names its targets; each target carries the inverse in its own header, in the form
// ADR-0042 and ADR-0055 already used: `**Amendé par :** ADR-NNNN (clauses)`
// (or `Supersédé en partie par`, `Remplacé par`). A forward declaration that
// names no ADR fails unless it is declared below: it may amend an invariant or
// a document, and it may also hide an ADR it amends (ADR-0030 did, for
// ADR-0018 D2), which only a reader can tell apart.

/**
 * Header labels that change what the target ADR says. Read from the corpus on
 * 2026-11-17: `Lève` (ADR-0052 lifts a moratorium of ADR-0042 §7) and `Rend
 * caduque` (ADR-0009) change their target as much as `Amende` does. `Étend`,
 * `Généralise`, `Précise`, `Élargit`, `Confirme` and `Applique` add to their
 * target or apply it, and leave what it says true.
 */
const FORWARD_LABEL = /^(Amende|Supersède|Remplace|Lève|Rend caduque)\b/;
/** Inverse labels a target uses to point at what changed it. */
const INVERSE_LABEL = /^(Amendé|Supersédé|Remplacé)e?( en partie)? par\b/;
/** Historical English form kept by ADR-0005 on its status line. */
const LEGACY_STATUS_INVERSE = /superseded\b[^;]*?\bby\s+ADR-(\d{4})/gi;
/**
 * The canonical reference form. `ADR 0047` (with a space) is the archived hub's
 * numbering, which this repository does not hold, so it is deliberately not read.
 */
const ADR_REFERENCE = /ADR-(\d{4})/g;
/**
 * `**Label :**` or `**Label** :`, anywhere in a bullet. A label starts with a
 * capital and holds no colon or parenthesis: without that, emphasis in a value
 * (`**Rust** (axum) … : **renversé**` in ADR-0063, `le **worker** :` in
 * ADR-0058) reads as a label and swallows the references that follow it.
 */
const INLINE_LABEL = /\*\*([A-ZÀ-Ý][^*:()]{0,80}?)(?:\s*:\s*\*\*|\*\*\s*:)/gu;

/** Forward references the parser reads but that are not amendments. */
export interface ExemptPair {
  readonly source: string;
  readonly target: string;
  readonly because: string;
}

/**
 * Nominative and reasoned; a declaration the scan no longer produces fails, so
 * no standing permission outlives its case.
 */
export const EXEMPT_NOT_AMENDMENTS: readonly ExemptPair[] = [
  {
    source: "0001",
    target: "0033",
    because:
      "« ADR-0033 historique » is the archived hub's ADR-0033 (Rust-first/Dioxus), not this repository's ADR-0033 (brand system, dated 2026-09-09, two months after ADR-0001)",
  },
  {
    source: "0059",
    target: "0055",
    because:
      "ADR-0055 is cited as precedent (« ADR-0055, qui amende ADR-0042, ne l'a pas édité non plus »), not amended",
  },
  {
    source: "0059",
    target: "0042",
    because:
      "named inside that same precedent sentence; ADR-0059 lists ADR-0042 under « Ne modifie pas » (« le point (f) n'en amende aucune phrase »)",
  },
];
// A « Ne modifie pas » field is not read as a blanket exclusion: it usually
// spares some clauses of an ADR whose other clauses the same ADR amends
// (ADR-0059 amends ADR-0056 D1 and D5 and spares D2-D4). Excluding the whole
// number would hide a real amendment; a nominative entry above cannot.

/** A forward field that names no ADR, read and found to amend none. */
export interface ExemptField {
  readonly source: string;
  /** The field label, exactly as the header writes it. */
  readonly label: string;
  readonly because: string;
}

export const EXEMPT_NON_ADR_FIELDS: readonly ExemptField[] = [
  {
    source: "0008",
    label: "Remplace",
    because:
      "replaces a doctrine stated in vision.md §7.6/§7.7, TARGET.md and README.md, never in an ADR",
  },
  {
    source: "0009",
    label: "Rend caduque",
    because:
      "makes obsolete the inherited doctrine « l'infrastructure n'est pas une marque publique », which no ADR of this repository states",
  },
  {
    source: "0042",
    label: "Remplace",
    because: "replaces a point of the owner mandate of 2026-09-15, which is not an ADR",
  },
  {
    source: "0048",
    label: "Amende",
    because:
      "amends `docs/parity/design/DESIGN-collab-v2-signable.md` §11 (resolutions R4 and R5), a design document, not an ADR",
  },
];

export interface HeaderField {
  readonly label: string;
  readonly value: string;
}

export interface AdrHeader {
  readonly number: string;
  readonly file: string;
  readonly status: string;
  readonly fields: readonly HeaderField[];
}

/** Split one bullet's text into its labelled parts (a bullet may carry several). */
function splitLabels(text: string): HeaderField[] {
  const marks = [...text.matchAll(INLINE_LABEL)];
  return marks.map((mark, index) => {
    const start = (mark.index ?? 0) + mark[0].length;
    const end = marks[index + 1]?.index ?? text.length;
    return { label: (mark[1] ?? "").trim(), value: text.slice(start, end).trim() };
  });
}

/**
 * The header is every top-level `- **Label :** value` bullet before the first
 * `## ` heading. A bullet continues on the following lines (indented text or
 * nested bullets) until the next top-level bullet, a blank line or a heading.
 */
export function parseHeader(file: string, text: string): AdrHeader | null {
  // `NNNN-slug.md`; a dated file (`2026-09-29-…`) is a direction note, not ADR-2026.
  const number = /(?:^|\/)(\d{4})-[a-z][^/]*\.md$/.exec(file)?.[1];
  if (number === undefined) return null;

  const bullets: string[] = [];
  let current: string[] | null = null;
  const flush = () => {
    if (current !== null) bullets.push(current.join(" "));
    current = null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) break;
    if (line.startsWith("- **")) {
      flush();
      current = [line.slice(2)];
    } else if (line.trim() === "" || line.startsWith("#") || line.startsWith(">")) {
      flush();
    } else if (current !== null) {
      current.push(line.trim());
    }
  }
  flush();

  const fields = bullets.flatMap(splitLabels);
  const status = fields.find((field) => /^(Statut|Status)$/.test(field.label))?.value ?? "";
  return { number, file, status, fields };
}

/** Only an accepted ADR is in force; a proposed or deferred one changes nothing yet. */
export function isInForce(header: AdrHeader): boolean {
  return /^accepted\b/i.test(header.status);
}

function referencedAdrs(value: string): string[] {
  return [...value.matchAll(ADR_REFERENCE)].map((match) => match[1] ?? "");
}

export interface ForwardRelation {
  readonly source: string;
  readonly label: string;
  /** Distinct ADR numbers the field names, the source excluded. */
  readonly targets: readonly string[];
}

export function forwardRelations(header: AdrHeader): ForwardRelation[] {
  return header.fields
    .filter((field) => FORWARD_LABEL.test(field.label))
    .map((field) => ({
      source: header.number,
      label: field.label,
      targets: [...new Set(referencedAdrs(field.value))].filter(
        (target) => target !== header.number,
      ),
    }));
}

/** The ADR numbers a header names as having changed it. */
export function inverseReferences(header: AdrHeader): Set<string> {
  const found = new Set<string>();
  for (const field of header.fields) {
    if (INVERSE_LABEL.test(field.label))
      for (const number of referencedAdrs(field.value)) found.add(number);
  }
  for (const match of header.status.matchAll(LEGACY_STATUS_INVERSE)) found.add(match[1] ?? "");
  return found;
}

export interface Pair {
  readonly source: string;
  readonly target: string;
}

export interface SupersessionScan {
  readonly adrs: number;
  readonly inForce: number;
  readonly relations: number;
  /** Forward fields that name no ADR and are not declared: they may hide one. */
  readonly undeclaredNonAdr: readonly ForwardRelation[];
  readonly declaredNonAdr: readonly ForwardRelation[];
  readonly staleNonAdr: readonly ExemptField[];
  readonly declaredNotAmendments: readonly Pair[];
  readonly staleNotAmendments: readonly ExemptPair[];
  readonly dangling: readonly Pair[];
  readonly unmarked: readonly (Pair & { readonly targetFiles: readonly string[] })[];
  readonly marked: readonly Pair[];
}

/** Pure verdict over parsed headers, so every branch is testable without files. */
export function scanSupersession(
  headers: readonly AdrHeader[],
  exemptPairs: readonly ExemptPair[] = EXEMPT_NOT_AMENDMENTS,
  exemptFields: readonly ExemptField[] = EXEMPT_NON_ADR_FIELDS,
): SupersessionScan {
  const byNumber = new Map<string, AdrHeader[]>();
  for (const header of headers)
    byNumber.set(header.number, [...(byNumber.get(header.number) ?? []), header]);

  const inForce = headers.filter(isInForce);
  const relations = inForce.flatMap(forwardRelations);

  const nonAdr = relations.filter((relation) => relation.targets.length === 0);
  const isDeclaredField = (relation: ForwardRelation) =>
    exemptFields.some(
      (entry) => entry.source === relation.source && entry.label === relation.label,
    );

  const pairs = new Map<string, Pair>();
  for (const relation of relations) {
    for (const target of relation.targets)
      pairs.set(`${relation.source}->${target}`, { source: relation.source, target });
  }
  const isDeclaredPair = (pair: Pair) =>
    exemptPairs.some((entry) => entry.source === pair.source && entry.target === pair.target);

  const declaredNotAmendments: Pair[] = [];
  const dangling: Pair[] = [];
  const unmarked: (Pair & { targetFiles: string[] })[] = [];
  const marked: Pair[] = [];
  for (const pair of pairs.values()) {
    if (isDeclaredPair(pair)) {
      declaredNotAmendments.push(pair);
      continue;
    }
    const targetHeaders = byNumber.get(pair.target);
    if (targetHeaders === undefined) {
      dangling.push(pair);
      continue;
    }
    // ADR-0004 is a known number collision: either file carrying the inverse is
    // enough, since the forward declaration cannot say which one it meant.
    if (targetHeaders.some((header) => inverseReferences(header).has(pair.source)))
      marked.push(pair);
    else unmarked.push({ ...pair, targetFiles: targetHeaders.map((header) => header.file) });
  }

  return {
    adrs: headers.length,
    inForce: inForce.length,
    relations: relations.length,
    undeclaredNonAdr: nonAdr.filter((relation) => !isDeclaredField(relation)),
    declaredNonAdr: nonAdr.filter(isDeclaredField),
    staleNonAdr: exemptFields.filter(
      (entry) =>
        !nonAdr.some(
          (relation) => relation.source === entry.source && relation.label === entry.label,
        ),
    ),
    declaredNotAmendments,
    staleNotAmendments: exemptPairs.filter(
      (entry) => !pairs.has(`${entry.source}->${entry.target}`),
    ),
    dangling,
    unmarked,
    marked,
  };
}

if (import.meta.main) {
  const headers: AdrHeader[] = [];
  const unnumbered: string[] = [];
  for await (const path of new Bun.Glob("docs/adr/*.md").scan({ cwd: ".", onlyFiles: true })) {
    const header = parseHeader(path, await Bun.file(path).text());
    if (header === null) unnumbered.push(path);
    else headers.push(header);
  }
  headers.sort((a, b) => a.file.localeCompare(b.file));

  const scan = scanSupersession(headers);
  const report = new GateReport();

  for (const relation of scan.undeclaredNonAdr) {
    report.check(
      `ADR-${relation.source}`,
      false,
      `« ${relation.label} » names no ADR — name the ADRs it changes (ADR-NNNN) in the header, or, if it changes none, declare it in EXEMPT_NON_ADR_FIELDS with what it changes instead`,
    );
  }
  for (const { source, target } of scan.dangling) {
    report.check(
      `ADR-${source}`,
      false,
      `declares a change to ADR-${target}, which does not exist in docs/adr/`,
    );
  }
  for (const { source, target, targetFiles } of scan.unmarked) {
    report.check(
      `ADR-${target}`,
      false,
      `changed by ADR-${source}, but ${targetFiles.join(" / ")} does not say so — add « **Amendé par :** ADR-${source} (clauses) » (or Supersédé en partie par / Remplacé par) to its header`,
    );
  }
  for (const entry of scan.staleNotAmendments) {
    report.check(
      `ADR-${entry.source}`,
      false,
      `EXEMPT_NOT_AMENDMENTS declares ADR-${entry.source} → ADR-${entry.target}, which the scan no longer reads — remove the declaration rather than keep a standing exemption`,
    );
  }
  for (const entry of scan.staleNonAdr) {
    report.check(
      `ADR-${entry.source}`,
      false,
      `EXEMPT_NON_ADR_FIELDS declares « ${entry.label} », which is no longer an ADR-free forward field of an ADR in force — remove the declaration`,
    );
  }
  for (const { source, target } of scan.marked) {
    report.check(`ADR-${target}`, true, `carries its change by ADR-${source}`);
  }
  for (const { source, target } of scan.declaredNotAmendments) {
    report.check(
      `ADR-${source}`,
      true,
      `names ADR-${target} without amending it (EXEMPT_NOT_AMENDMENTS)`,
    );
  }
  for (const relation of scan.declaredNonAdr) {
    report.check(
      `ADR-${relation.source}`,
      true,
      `« ${relation.label} » changes no ADR (EXEMPT_NON_ADR_FIELDS)`,
    );
  }

  report.volume(
    `${scan.adrs} numbered ADR(s) read (${scan.inForce} in force; proposed and deferred ones bind nothing yet); ` +
      `${scan.relations} forward field(s): ${scan.marked.length} pair(s) marked on the target, ` +
      `${scan.declaredNotAmendments.length} declared non-amendment pair(s), ${scan.declaredNonAdr.length} declared field(s) amending no ADR; ` +
      `${unnumbered.length} file(s) without an NNNN- number, not checked: ${unnumbered.join(", ") || "none"}`,
  );

  concludeGate("ADR supersession", report);
}
