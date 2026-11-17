import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Structure control of docs/method/TAURI-SHELL.md, the Tauri 2 shell template.
 *
 * The template proves control C6 ("the Rust process opens no port") with two
 * instruments: `lsof` on the process tree, and a TCP connect scan of the
 * loopback addresses compared with a reference scan taken before the shell
 * starts. The scan tool lives in the product repository, so nothing here can
 * run it. What this file can hold still is the written contract: the sections
 * other documents cite by number, the four outcomes, the sum, the success
 * criterion, the exit codes, and the skeletons that were measured at a dated
 * commit and must not drift by a byte.
 *
 * An unreadable document is a failure: readFileSync throws and every test
 * below goes red.
 */
const DOCUMENT = join(import.meta.dir, "..", "..", "docs", "method", "TAURI-SHELL.md");

const lines = readFileSync(DOCUMENT, "utf8").split("\n");

interface CodeBlock {
  /** Info string of the opening fence (`json`, `rust`, or empty). */
  info: string;
  lineCount: number;
  /** SHA-256 of the body, each line followed by a line feed. */
  sha256: string;
}

interface Parsed {
  /** Lines outside fenced blocks; a fenced line is replaced by an empty one. */
  prose: string[];
  blocks: CodeBlock[];
}

function parse(source: string[]): Parsed {
  const prose: string[] = [];
  const blocks: CodeBlock[] = [];
  let open: { info: string; body: string[] } | undefined;
  for (const line of source) {
    if (line.startsWith("```")) {
      if (open === undefined) {
        open = { info: line.slice(3).trim(), body: [] };
      } else {
        const text = open.body.map((entry) => `${entry}\n`).join("");
        blocks.push({
          info: open.info,
          lineCount: open.body.length,
          sha256: createHash("sha256").update(text).digest("hex"),
        });
        open = undefined;
      }
      prose.push("");
    } else if (open !== undefined) {
      open.body.push(line);
      prose.push("");
    } else {
      prose.push(line);
    }
  }
  // An unclosed fence would swallow the rest of the document in silence.
  if (open !== undefined) throw new Error("unclosed code fence in TAURI-SHELL.md");
  return { prose, blocks };
}

const { prose, blocks } = parse(lines);

/** Prose of a level-2 section, title line excluded, up to the next level-2 title. */
function section(title: string): string[] {
  const start = prose.indexOf(title);
  if (start === -1) throw new Error(`section not found: ${title}`);
  const rest = prose.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

/** Collapse line wrapping, so a sentence can be matched across lines. */
function flat(text: string[]): string {
  return text.join(" ").replace(/\s+/g, " ");
}

/** Top-level bullets of a section, each with its continuation lines joined. */
function bullets(text: string[]): string[] {
  const items: string[] = [];
  for (const line of text) {
    if (line.startsWith("- ")) items.push(line.slice(2));
    else if (line.startsWith("  ") && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
    }
  }
  return items;
}

const NUMBERED_TITLES = [
  "## 1. Les six contrôles et leur vecteur rouge",
  "## 2. Contraintes de configuration",
  "## 3. Les vecteurs rouges, en squelettes exécutables",
  "## 4. Qualification macOS (ADR-0057 §4, D98)",
  "## 5. Ce qui reste à la charge du produit",
  "## 6. Ce qui reste NON VÉRIFIÉ",
];

const QUALIFICATION = section("## 4. Qualification macOS (ADR-0057 §4, D98)");

/** The level-3 subsections of §4 about the second instrument of C6. */
function secondInstrumentSubsections(): string[][] {
  const found: string[][] = [];
  QUALIFICATION.forEach((line, index) => {
    if (!line.startsWith("### ")) return;
    if (!/C6/.test(line) || !/second instrument/i.test(line)) return;
    const rest = QUALIFICATION.slice(index + 1);
    const end = rest.findIndex((next) => next.startsWith("### "));
    found.push(end === -1 ? rest : rest.slice(0, end));
  });
  return found;
}

const subsections = secondInstrumentSubsections();
const scan = subsections[0] ?? [];
const scanText = flat(scan);

/**
 * The skeletons as they stood before the scan subsection was added, digested
 * with `shasum -a 256` on the base document: the expectation comes from that
 * measurement, not from this parser.
 */
const FROZEN_BLOCKS: CodeBlock[] = [
  {
    info: "json",
    lineCount: 34,
    sha256: "8cf3dda09ccf85d6461220d6e38e37dfc47b1aa0b6ee9693ebeddc1ce7743859",
  },
  {
    info: "json",
    lineCount: 10,
    sha256: "19e475a19682a5936d3851ae2edca9e4e4773ebdff969d4edd0f1a91d9b280f2",
  },
  {
    info: "rust",
    lineCount: 61,
    sha256: "2eeb37f254034d4f9f8acf1de9d855e97a0e1caf6426467d112f05eb2d6b97b7",
  },
  {
    info: "rust",
    lineCount: 67,
    sha256: "59b8da6d433bc021d446e99c3e58d5bdabc8c995ecb7f4ec87150c108e92d470",
  },
  {
    info: "rust",
    lineCount: 11,
    sha256: "c7528919bc13df838b7b2cec6c26acafbb1059939f65d865e9d9619f09ccaaf3",
  },
  {
    info: "toml",
    lineCount: 19,
    sha256: "d48dddd2bc26c243a215fc6f697b0ddf2332852101c60c2f7a8f23363f3e411b",
  },
  {
    info: "yaml",
    lineCount: 4,
    sha256: "3be3e114af0046620e7ea9e11d885caceb850ad0793e42ab6e08af46ab97401d",
  },
  {
    info: "ts",
    lineCount: 129,
    sha256: "4a70744f47a799939973e6c5ad6592a4a0ed6a57c8cdafc2ebe820f6c6bb7c94",
  },
  {
    info: "rust",
    lineCount: 116,
    sha256: "382ec9ff188c5ee7cdd1916676c32bb69dfeec5c4e48a58fedf81e3ca6215d56",
  },
  {
    info: "",
    lineCount: 1,
    sha256: "cc197b1e47f69c35c47779e6adaa7d3885c59d2bedb4adefc0d821df6d090c48",
  },
  {
    info: "sh",
    lineCount: 57,
    sha256: "0702aa30e0333536d97b53edd1351d936f7d4534ebdb1937243d59fcb7578764",
  },
  {
    info: "sh",
    lineCount: 1,
    sha256: "34fce743912ad769bc73629e79f6adc48cf0d54e0b7f9a9ffd33f06f6e1427f3",
  },
  {
    info: "",
    lineCount: 2,
    sha256: "ab2a62dd1aabafa5a9a86a1bd7ca6d9e5c16fa170efd5e1d18234620488f02aa",
  },
];

describe("TAURI-SHELL.md — sections cited by number", () => {
  test("the six numbered level-2 titles are present, in order, with their text", () => {
    const numbered = prose.filter((line) => /^## \d+\. /.test(line));
    expect(numbered).toEqual(NUMBERED_TITLES);
  });
});

describe("TAURI-SHELL.md §4 — second instrument of C6, the loopback TCP scan", () => {
  test("§4 holds exactly one level-3 subsection about it", () => {
    expect(subsections.length).toBe(1);
    expect(scan.length).toBeGreaterThan(0);
  });

  test("it names the four outcomes, and refused means ECONNREFUSED alone", () => {
    const rows = scan.filter((line) => line.startsWith("| "));
    for (const outcome of ["ouvert", "refusé", "délai", "erreur"]) {
      expect(rows.filter((row) => row.startsWith(`| ${outcome} |`)).length).toBe(1);
    }
    const refused = rows.find((row) => row.startsWith("| refusé |")) ?? "";
    expect(refused).toContain("`ECONNREFUSED`, et seulement lui");
  });

  test("timeout and error are never counted as closed", () => {
    expect(scanText).toMatch(/Délai et erreur [^.]*jamais comptés comme fermés/);
  });

  test("it writes the sum with its value, and names both addresses", () => {
    expect(scanText).toContain("`scanned = open + refused + timeout + error`");
    expect(scanText).toMatch(/`scanned` vaut 65535/);
    expect(scanText).toContain("`127.0.0.1`");
    expect(scanText).toContain("`::1`");
  });

  test("it states the success criterion", () => {
    const start = scan.findIndex((line) => line.startsWith("**Critère de succès"));
    expect(start).toBeGreaterThan(-1);
    const criterion = flat(bullets(scan.slice(start + 1, start + 12)));
    expect(criterion).toMatch(/balayage `coquille`, moins ceux du balayage `reference`/);
    expect(criterion).toContain("exactement la liste attendue");
    expect(criterion).toContain("délai = erreur = 0");
    expect(criterion).toContain("`scanned` = 65535");
  });

  test("it states the three exit codes with their meaning", () => {
    const rows = scan.filter((line) => /^\| \d+ \| /.test(line));
    expect(rows.map((row) => row.split("|")[1]?.trim())).toEqual(["0", "1", "2"]);
    expect(rows[0]).toMatch(/^\| 0 \| vert\b/);
    expect(rows[1]).toMatch(/^\| 1 \| violation\b/);
    expect(rows[2]).toMatch(/^\| 2 \| usage\b/);
  });

  test("the reference scan, taken before launch, is the source of the host ports", () => {
    expect(scanText).toMatch(
      /Balayage de référence [^.]*avant tout lancement : il donne les ports de l'hôte/,
    );
  });

  test("no host port number is written in the subsection", () => {
    // What a port list may legitimately sit next to, removed before the search:
    // the two addresses and their wildcards, the size of the port range, and
    // references to decisions and sections.
    const stripped = scanText
      .replaceAll("127.0.0.1", "")
      .replaceAll("0.0.0.0", "")
      .replaceAll("65535", "")
      .replace(/ADR-\d+/g, "")
      .replace(/§\d+(?:\.\d+)*/g, "");
    expect(stripped.match(/\d{2,}/g) ?? []).toEqual([]);
    // Single digits stay legitimate (exit codes, the 2 s delay), so a port
    // list is also refused where it would be written: after `hote=`.
    expect(scanText).toContain("hote=<ports>");
    expect(scanText.match(/(?:hote|coquille)=\d/g) ?? []).toEqual([]);
  });
});

describe("TAURI-SHELL.md — the rest of the document follows the second instrument", () => {
  test("the C6 row of the §1 table cites both instruments", () => {
    const rows = section("## 1. Les six contrôles et leur vecteur rouge").filter((line) =>
      line.startsWith("| C6 |"),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]).toContain("`lsof`");
    expect(rows[0]).toContain("balayage TCP");
    expect(rows[0]).toContain("§4.1");
  });

  test("§5 leaves the scan tool and its wiring to the product", () => {
    const items = bullets(section("## 5. Ce qui reste à la charge du produit")).filter((item) =>
      item.includes("outil de balayage"),
    );
    expect(items.length).toBe(1);
    expect(items[0]).toContain("second instrument de C6");
    expect(items[0]).toContain("branchement");
  });

  test("§6 lists the second instrument as never run on a built shell", () => {
    const items = bullets(section("## 6. Ce qui reste NON VÉRIFIÉ")).filter((item) =>
      item.includes("second instrument de C6"),
    );
    expect(items.length).toBe(1);
    expect(items[0]).toContain("aucun produit ne l'a exécuté sur une coquille construite");
  });
});

describe("TAURI-SHELL.md — measured skeletons", () => {
  test("the code blocks are the frozen ones, in number and to the byte", () => {
    expect(blocks.length).toBe(FROZEN_BLOCKS.length);
    expect(blocks).toEqual(FROZEN_BLOCKS);
  });
});
