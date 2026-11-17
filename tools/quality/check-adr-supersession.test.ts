import { describe, expect, test } from "bun:test";
import {
  type AdrHeader,
  buildReport,
  EXEMPT_NON_ADR_FIELDS,
  EXEMPT_NOT_AMENDMENTS,
  forwardRelations,
  inverseReferences,
  isInForce,
  parseHeader,
  scanSupersession,
} from "./check-adr-supersession";

// The failure this gate anticipates: an agent opens an amended ADR on its own,
// reads `accepted`, and acts on a clause a newer ADR already changed.

function adr(file: string, header: string): AdrHeader {
  const parsed = parseHeader(
    file,
    `# Title\n\n${header}\n\n## Contexte\n\n- **Amende :** ADR-0999 (body, never read)\n`,
  );
  if (parsed === null) throw new Error(`fixture ${file} has no number`);
  return parsed;
}

describe("parseHeader", () => {
  test("reads a second label carried inline by the same bullet (ADR-0020 form)", () => {
    const header = adr(
      "docs/adr/0020-x.md",
      "- **Statut :** accepted\n- **Étend :** ADR-0008. **Supersède de manière bornée :** ADR-0018 (cadre de vagues).",
    );
    expect(header.fields.map((field) => field.label)).toEqual([
      "Statut",
      "Étend",
      "Supersède de manière bornée",
    ]);
    expect(forwardRelations(header)[0]?.targets).toEqual(["0018"]);
  });

  test("reads a label whose colon sits outside the bold (ADR-0030 form)", () => {
    const header = adr(
      "docs/adr/0030-x.md",
      "- **Statut :** accepted\n- **Amende un contrat verrouillé — par successeur majeur, jamais en place** : ADR-0018 D2 ; `harness-profile-v1`",
    );
    expect(forwardRelations(header)[0]).toMatchObject({
      label: "Amende un contrat verrouillé — par successeur majeur, jamais en place",
      targets: ["0018"],
    });
  });

  test("emphasis inside a value is not a label and does not swallow references (ADR-0063 form)", () => {
    const header = adr(
      "docs/adr/0063-x.md",
      "- **Statut :** accepted\n- **Amende :**\n  - ADR-0042 §5 : les produits suivent **Rust** (axum, sqlx) et PostgreSQL.\n  - ADR-0058 (LangGraph JS) : **renversé**. ADR-0032 D38 retrouve sa forme.",
    );
    expect(header.fields.map((field) => field.label)).toEqual(["Statut", "Amende"]);
    expect(forwardRelations(header)[0]?.targets).toEqual(["0042", "0058", "0032"]);
  });

  test("a lower-case bold word followed by a colon is not a label (ADR-0058 form)", () => {
    const header = adr(
      "docs/adr/0058-x.md",
      "- **Statut :** accepted\n- **Amende :** ADR-0032 D1 pour le **worker** : LangGraph est admis ; ADR-0032 D38.",
    );
    expect(header.fields.map((field) => field.label)).toEqual(["Statut", "Amende"]);
  });

  test("joins continuation lines and nested bullets into the field", () => {
    const header = adr(
      "docs/adr/0067-x.md",
      "- **Statut :** accepted\n- **Amende :**\n  - ADR-0042 §1 ;\n  - ADR-0055 D1.",
    );
    expect(forwardRelations(header)[0]?.targets).toEqual(["0042", "0055"]);
  });

  test("a blank line or a quote closes the bullet: what follows is not its value", () => {
    for (const closer of ["", "> Collision de numéro : ADR-0018"]) {
      const header = adr(
        "docs/adr/0004-x.md",
        `- **Statut :** accepted\n- **Amende :** un document\n${closer}\nADR-0018 est cité ici, hors en-tête.`,
      );
      expect(forwardRelations(header)[0]?.targets).toEqual([]);
    }
  });

  test("stops at the first section heading: a body bullet is not a header field", () => {
    const header = adr("docs/adr/0010-x.md", "- **Statut :** accepted");
    expect(forwardRelations(header)).toEqual([]);
  });

  test("a dated file is a direction note, not ADR-2026", () => {
    expect(parseHeader("docs/adr/2026-09-29-portfolio.md", "- **Statut :** accepted")).toBeNull();
  });
});

describe("forwardRelations", () => {
  test("Lève and Rend caduque change their target as Amende does", () => {
    const header = adr(
      "docs/adr/0052-x.md",
      "- **Statut :** accepted\n- **Lève :** D53 par la voie d'ADR-0042 §7\n- **Rend caduque :** ADR-0009 §2",
    );
    expect(forwardRelations(header).map((relation) => relation.targets)).toEqual([
      ["0042"],
      ["0009"],
    ]);
  });

  test("Étend and Généralise are not forward relations", () => {
    const header = adr(
      "docs/adr/0057-x.md",
      "- **Statut :** accepted\n- **Étend :** ADR-0018\n- **Généralise :** ADR-0054 §3",
    );
    expect(forwardRelations(header)).toEqual([]);
  });

  test("the hub numbering (ADR 0047, with a space) and self-references are not targets", () => {
    const header = adr(
      "docs/adr/0031-x.md",
      "- **Statut :** accepted\n- **Amende :** ADR-0031 lui-même, ADR 0047 du hub, ADR-0020 §2.5",
    );
    expect(forwardRelations(header)[0]?.targets).toEqual(["0020"]);
  });
});

describe("inverseReferences", () => {
  test("reads the inline form on the status line (ADR-0042, ADR-0055)", () => {
    const header = adr(
      "docs/adr/0055-x.md",
      "- **Statut :** accepted — fusionné. **Amendé par :** ADR-0067 (D1), ADR-0099 (D2)",
    );
    expect([...inverseReferences(header)].sort()).toEqual(["0067", "0099"]);
  });

  test("reads a separate bullet and the « en partie » variant", () => {
    const header = adr(
      "docs/adr/0018-x.md",
      "- **Statut :** accepted\n- **Supersédé en partie par :** ADR-0020 (cadre de vagues)",
    );
    expect([...inverseReferences(header)]).toEqual(["0020"]);
  });

  test("reads the historical English status form (ADR-0005)", () => {
    const header = adr(
      "docs/adr/0005-x.md",
      "- **Statut :** accepted, superseded in part by ADR-0006 for the matrix",
    );
    expect([...inverseReferences(header)]).toEqual(["0006"]);
  });

  test("a bare « Amendé : <date> » field (ADR-0008 form) is not an inverse marker", () => {
    const header = adr(
      "docs/adr/0008-x.md",
      "- **Statut :** accepted\n- **Amendé :** 2026-07-23 (décision propriétaire), cf. ADR-0020",
    );
    expect(inverseReferences(header).size).toBe(0);
  });

  test("an ADR named inside the clauses of an inverse field is a mention (ADR-0064 form)", () => {
    const header = adr(
      "docs/adr/0064-x.md",
      "- **Statut :** proposé. **Amendé par :** ADR-0067 (sa cellule, dans le catalogue d'ADR-0042 §1)",
    );
    expect([...inverseReferences(header)]).toEqual(["0067"]);
  });

  test("a mention in prose is not an inverse marker", () => {
    const header = adr(
      "docs/adr/0060-x.md",
      "- **Statut :** accepted ; le choix est fait par ADR-0062.",
    );
    expect(inverseReferences(header).size).toBe(0);
  });
});

describe("scanSupersession", () => {
  const amending = adr("docs/adr/0058-x.md", "- **Statut :** accepted\n- **Amende :** ADR-0032 D1");

  test("an amended ADR that does not say so is unmarked", () => {
    const scan = scanSupersession(
      [amending, adr("docs/adr/0032-x.md", "- **Statut :** accepted")],
      [],
      [],
    );
    expect(scan.unmarked).toEqual([
      { source: "0058", target: "0032", targetFiles: ["docs/adr/0032-x.md"] },
    ]);
    expect(scan.marked).toEqual([]);
  });

  test("an amended ADR carrying the inverse is marked", () => {
    const target = adr(
      "docs/adr/0032-x.md",
      "- **Statut :** accepted. **Amendé par :** ADR-0058 (D1)",
    );
    const scan = scanSupersession([amending, target], [], []);
    expect(scan.marked).toEqual([{ source: "0058", target: "0032" }]);
    expect(scan.unmarked).toEqual([]);
  });

  test("an inverse naming another ADR does not cover this one", () => {
    const target = adr(
      "docs/adr/0032-x.md",
      "- **Statut :** accepted. **Amendé par :** ADR-0063 (D4)",
    );
    expect(scanSupersession([amending, target], [], []).unmarked).toHaveLength(1);
  });

  test("a proposed ADR binds nothing yet, so its targets are not required to carry it", () => {
    const proposed = adr(
      "docs/adr/0063-x.md",
      "- **Statut :** proposé\n- **Amende :** ADR-0032 D1",
    );
    const scan = scanSupersession(
      [proposed, adr("docs/adr/0032-x.md", "- **Statut :** accepted")],
      [],
      [],
    );
    expect(isInForce(proposed)).toBe(false);
    expect(scan.unmarked).toEqual([]);
    expect(scan.relations).toBe(0);
  });

  test("only a status that starts with accepted is in force", () => {
    for (const status of ["proposé — accepted once the owner merges", "deferred, then accepted?"]) {
      expect(isInForce(adr("docs/adr/0063-x.md", `- **Statut :** ${status}`))).toBe(false);
    }
    expect(isInForce(adr("docs/adr/0042-x.md", "- **Statut :** accepted — fusionné"))).toBe(true);
  });

  test("a target that does not exist is dangling", () => {
    expect(scanSupersession([amending], [], []).dangling).toEqual([
      { source: "0058", target: "0032" },
    ]);
  });

  test("ADR-0004 collision: either file carrying the inverse is enough", () => {
    const source = adr("docs/adr/0050-x.md", "- **Statut :** accepted\n- **Amende :** ADR-0004");
    const scan = scanSupersession(
      [
        source,
        adr("docs/adr/0004-a.md", "- **Statut :** accepted"),
        adr("docs/adr/0004-b.md", "- **Statut :** accepted. **Amendé par :** ADR-0050"),
      ],
      [],
      [],
    );
    expect(scan.marked).toEqual([{ source: "0050", target: "0004" }]);
  });

  test("a declared non-amendment is set aside, and a stale declaration is reported", () => {
    const declared = [
      { source: "0058", target: "0032", because: "cited as precedent" },
      { source: "0058", target: "0041", because: "no longer named" },
    ];
    const scan = scanSupersession([amending], declared, []);
    expect(scan.declaredNotAmendments).toEqual([{ source: "0058", target: "0032" }]);
    expect(scan.dangling).toEqual([]);
    expect(scan.staleNotAmendments.map((entry) => entry.target)).toEqual(["0041"]);
  });

  // ADR-0030 amended ADR-0018 D2 under a forward field that named no ADR: a
  // gate that let such fields through would never have seen it.
  test("a forward field naming no ADR fails unless declared, whatever its wording", () => {
    for (const value of ["voir §2", "cf. §2", "`harness-profile-v1` reste non-targeted"]) {
      const source = adr("docs/adr/0030-x.md", `- **Statut :** accepted\n- **Amende :** ${value}`);
      const scan = scanSupersession([source], [], []);
      expect(scan.undeclaredNonAdr.map((relation) => relation.source)).toEqual(["0030"]);
    }
  });

  test("a declared ADR-free field passes, and a stale field declaration is reported", () => {
    const source = adr(
      "docs/adr/0048-x.md",
      "- **Statut :** accepted\n- **Amende :** `docs/x.md` §11",
    );
    const fields = [
      { source: "0048", label: "Amende", because: "a design document" },
      { source: "0098", label: "Remplace", because: "an ADR no fixture holds" },
    ];
    const scan = scanSupersession([source], [], fields);
    expect(scan.undeclaredNonAdr).toEqual([]);
    expect(scan.declaredNonAdr.map((relation) => relation.source)).toEqual(["0048"]);
    expect(scan.staleNonAdr.map((entry) => entry.source)).toEqual(["0098"]);
  });

  test("a field declaration covers its own label only, not another field of the same ADR", () => {
    const source = adr(
      "docs/adr/0042-x.md",
      "- **Statut :** accepted\n- **Remplace :** un mandat\n- **Amende :** un document",
    );
    const fields = [{ source: "0042", label: "Remplace", because: "a mandate" }];
    const scan = scanSupersession([source], [], fields);
    expect(scan.undeclaredNonAdr.map((relation) => relation.label)).toEqual(["Amende"]);
  });

  test("a field that names an ADR is never ADR-free, even with a section pointer", () => {
    const source = adr(
      "docs/adr/0020-x.md",
      "- **Statut :** accepted\n- **Supersède :** ADR-0018, voir §2",
    );
    const scan = scanSupersession(
      [source, adr("docs/adr/0018-x.md", "- **Statut :** accepted")],
      [],
      [],
    );
    expect(scan.undeclaredNonAdr).toEqual([]);
    expect(scan.unmarked.map((pair) => pair.target)).toEqual(["0018"]);
  });
});

describe("buildReport", () => {
  test("every defect category is a failed check, and only those", () => {
    const headers = [
      adr("docs/adr/0058-x.md", "- **Statut :** accepted\n- **Amende :** ADR-0032 D1 ; ADR-0077"),
      adr("docs/adr/0032-x.md", "- **Statut :** accepted"),
      adr("docs/adr/0030-x.md", "- **Statut :** accepted\n- **Amende :** un contrat"),
    ];
    const scan = scanSupersession(
      headers,
      [{ source: "0001", target: "0033", because: "stale pair" }],
      [{ source: "0008", label: "Remplace", because: "stale field" }],
    );
    const report = buildReport(scan, []);
    expect(report.outcome).toBe("violations");
    const failed = report.checks.filter((check) => !check.ok).map((check) => check.item);
    // unmarked 0032, dangling 0077 (reported on its source), undeclared field
    // of 0030, stale pair 0001, stale field 0008.
    expect(failed.sort()).toEqual(["ADR-0001", "ADR-0008", "ADR-0030", "ADR-0032", "ADR-0058"]);
  });

  test("a corpus where every amendment is marked passes and says what it read", () => {
    const headers = [
      adr("docs/adr/0058-x.md", "- **Statut :** accepted\n- **Amende :** ADR-0032 D1"),
      adr("docs/adr/0032-x.md", "- **Statut :** accepted. **Amendé par :** ADR-0058 (D1)"),
    ];
    const report = buildReport(scanSupersession(headers, [], []), ["docs/adr/2026-09-29-x.md"]);
    expect(report.outcome).toBe("pass");
    expect(report.asserted).toBe(1);
    expect(report.volumeSummary).toContain("2 numbered ADR(s) read");
    expect(report.volumeSummary).toContain("docs/adr/2026-09-29-x.md");
  });
});

describe("exemption lists", () => {
  test("every declaration is nominative and reasoned", () => {
    for (const entry of EXEMPT_NOT_AMENDMENTS) {
      expect(entry.source).toMatch(/^\d{4}$/);
      expect(entry.target).toMatch(/^\d{4}$/);
      expect(entry.because.length).toBeGreaterThan(40);
    }
    for (const entry of EXEMPT_NON_ADR_FIELDS) {
      expect(entry.source).toMatch(/^\d{4}$/);
      expect(entry.label.length).toBeGreaterThan(3);
      expect(entry.because.length).toBeGreaterThan(40);
    }
  });
});
