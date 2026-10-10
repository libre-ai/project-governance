import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import {
  emptyTally,
  judgeRepository,
  parseAllowlist,
  reviewRepository,
  type SourceReader,
  type SqlAllowance,
  summarizeVolume,
} from "./check-sql-construction";
import {
  formatPlaceholders,
  looksLikeSql,
  type SqlFinding,
  scanRust,
  scanSource,
  scanTypeScript,
} from "./sql-construction-scanner";

// Every fixture below is an ordinary double-quoted string holding source text:
// a template literal here would itself be a finding when the gate scans this
// repository. Interpolations are written `#{x}` and turned into a dollar-brace
// by `ts`, so no plain string carries a template placeholder.
const rules = (findings: readonly SqlFinding[]) => findings.map((f) => `${f.rule}@${f.line}`);
const OPEN = ["$", "{"].join("");
const ts = (source: string) => scanTypeScript(source.replaceAll("#{", OPEN));

describe("looksLikeSql", () => {
  test("upper-case statement keywords anywhere, lower-case statements at the start", () => {
    expect(looksLikeSql("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(true);
    expect(looksLikeSql("  delete from t where id = ")).toBe(true);
    expect(looksLikeSql("update t set a = ")).toBe(true);
    expect(looksLikeSql("please select a file from the list")).toBe(false);
    expect(looksLikeSql("Failed to update the cache")).toBe(false);
  });
});

describe("scanTypeScript", () => {
  test("an untagged template interpolating a variable into SQL is a finding", () => {
    const source = "const q = await db.query(`SELECT * FROM t WHERE id = #{id}`);";
    expect(rules(ts(source))).toEqual(["sql-template-interpolation@1"]);
  });

  test("a tagged template parameterizes and passes", () => {
    expect(ts("await tx`SELECT * FROM t WHERE id = #{id}`;")).toEqual([]);
    expect(ts("await sql `DELETE FROM t WHERE id = #{id}`;")).toEqual([]);
  });

  test("a returned template is untagged (`return` is not a tag)", () => {
    expect(rules(ts("function f() { return `DELETE FROM t WHERE a = #{a}`; }"))).toEqual([
      "sql-template-interpolation@1",
    ]);
  });

  test("interpolating SCREAMING_CASE constants passes", () => {
    expect(ts("await db.query(`WITH #{EXCLUDED_CTE} SELECT a FROM t WHERE x = $1`, [x]);")).toEqual(
      [],
    );
    expect(ts("await db.exec(`SET app.tenant_id = '#{TENANT_A}'`);")).toEqual([]);
  });

  test("a multi-line template is reported at its first line", () => {
    const source =
      "const a = 1;\nawait db.query(`\n  SELECT *\n  FROM t\n  WHERE id = #{id}\n`);\n";
    expect(rules(ts(source))).toEqual(["sql-template-interpolation@2"]);
  });

  test("a call nested in an interpolation is still scanned", () => {
    const source = "const s = `prefix #{db.unsafe(text)} suffix`;";
    expect(rules(ts(source))).toEqual(["unsafe-call@1"]);
  });

  test("concatenating SQL is a finding", () => {
    expect(rules(scanTypeScript("const q = 'SELECT * FROM t WHERE id = ' + id;"))).toEqual([
      "sql-concatenation@1",
    ]);
    expect(rules(scanTypeScript('const q = base + " DELETE FROM t";'))).toEqual([
      "sql-concatenation@1",
    ]);
  });

  test("every .unsafe( call is a finding, constant or not", () => {
    expect(rules(scanTypeScript("await sql.unsafe('SELECT 1');\nawait sql?.unsafe(q);"))).toEqual([
      "unsafe-call@1",
      "unsafe-call@2",
    ]);
  });

  test(".exec with a constant string passes, with anything else it is a finding", () => {
    expect(scanTypeScript("await db.exec('BEGIN');\nawait db.exec(\"COMMIT\", opts);")).toEqual([]);
    expect(rules(scanTypeScript("await db.exec(sql);"))).toEqual(["exec-non-constant@1"]);
    expect(rules(scanTypeScript("await db.exec('a' + b);"))).toEqual(["exec-non-constant@1"]);
    expect(rules(scanTypeScript("await db.exec(readFileSync(p, 'utf8'));"))).toEqual([
      "exec-non-constant@1",
    ]);
  });

  test("a regex's .exec is not a database's", () => {
    const source = [
      "const PATTERN = /^a(b)$/;",
      "const typed: RegExp = make();",
      "function f(pattern: RegExp, keys: { url: RegExp }) {",
      "  PATTERN.exec(x); /^c/.exec(y); typed.exec(z); pattern.exec(w); keys.url.exec(v);",
      "  new RegExp(s).exec(t);",
      "  return [1].map((line) => /^d/.exec(line));",
      "}",
    ].join("\n");
    expect(scanTypeScript(source)).toEqual([]);
  });

  test("comments and plain strings are not code", () => {
    const source = [
      "// await db.unsafe(`SELECT #{x}`)",
      "/* db.exec(sql) */",
      "const doc = 'call db.exec(sql) to run SELECT #{x}';",
    ].join("\n");
    expect(ts(source)).toEqual([]);
  });

  test("a method declaration named exec is not a call", () => {
    expect(scanTypeScript("interface E { exec(sql: string): Promise<void>; }")).toEqual([]);
  });

  test("a division is not taken for a regex", () => {
    expect(rules(ts("const r = (a) / 2; const q = `DELETE FROM t WHERE a = #{a}`;"))).toEqual([
      "sql-template-interpolation@1",
    ]);
  });
});

describe("scanRust", () => {
  test("a lower-case inline capture into SQL is a finding", () => {
    expect(
      rules(scanRust('let q = format!("SELECT * FROM \\"{table}\\" ORDER BY {order}");')),
    ).toEqual(["rust-format-sql@1"]);
  });

  test("SCREAMING_CASE constants pass, inline or positional or named (LEASE_HELD)", () => {
    expect(scanRust('format!("SELECT 1 FROM q WHERE {LEASE_HELD} FOR UPDATE")')).toEqual([]);
    expect(scanRust('format!("SELECT {} FROM t", COLUMNS)')).toEqual([]);
    expect(scanRust('format!("SELECT {cols} FROM t", cols = Self::COLUMNS)')).toEqual([]);
  });

  test("a positional or named variable is a finding", () => {
    expect(rules(scanRust('format!("DELETE FROM t WHERE {}", filter)'))).toEqual([
      "rust-format-sql@1",
    ]);
    expect(rules(scanRust('format!("DELETE FROM t WHERE {f}", f = filter)'))).toEqual([
      "rust-format-sql@1",
    ]);
  });

  test("raw strings, multi-line, escapes and non-SQL formats", () => {
    const source = [
      "fn a<'a>(x: &'a str) -> String {",
      "    let c = 'x';",
      '    let ok = format!("{x} items");',
      '    format!(r#"',
      "        SELECT *",
      '        FROM {x}"#)',
      "}",
    ].join("\n");
    expect(rules(scanRust(source))).toEqual(["rust-format-sql@4"]);
  });

  test("comments are not code", () => {
    expect(scanRust('// format!("SELECT {x}")\n/* format!("DELETE FROM {y}") */')).toEqual([]);
  });

  test("placeholders: escapes, positions, names and format specs", () => {
    expect(formatPlaceholders("{{literal}} {} {0} {name:?} {:>8}")).toEqual([0, 0, "name", 1]);
  });
});

describe("scanSource", () => {
  test("dispatches on the extension and ignores everything else", () => {
    expect(scanSource("a.rs", 'format!("SELECT {x}")').length).toBe(1);
    expect(scanSource("a.mjs", "db.unsafe(q)").length).toBe(1);
    expect(scanSource("a.sql", "SELECT 1").length).toBe(0);
  });
});

const allowance = (path: string, count: number): SqlAllowance => ({
  repository: "libre-ai/sample",
  path,
  rule: "unsafe-call",
  count,
  because: "reviewed",
});

describe("judgeRepository", () => {
  const found = new Map([["test/pg.ts", [{ rule: "unsafe-call" as const, line: 3 }]]]);

  test("a reviewed site with the exact count passes and is counted as allowed", () => {
    const tally = emptyTally();
    const checks = judgeRepository("libre-ai/sample", found, [allowance("test/pg.ts", 1)], tally);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(tally).toMatchObject({ findings: 1, allowed: 1 });
  });

  test("an unreviewed site fails", () => {
    const checks = judgeRepository("libre-ai/sample", found, [], emptyTally());
    expect(checks[0]?.ok).toBe(false);
  });

  test("a count that moved fails", () => {
    const checks = judgeRepository(
      "libre-ai/sample",
      found,
      [allowance("test/pg.ts", 2)],
      emptyTally(),
    );
    expect(checks[0]?.note).toContain("reviewed 2 site(s), the file now has 1");
  });

  test("an allowance with no site left is stale", () => {
    const checks = judgeRepository(
      "libre-ai/sample",
      new Map(),
      [allowance("gone.ts", 1)],
      emptyTally(),
    );
    expect(checks[0]?.note).toStartWith("stale allowance");
  });
});

const active = {
  repository: "libre-ai/sample",
  role: "satellite",
  layer: "couche-1",
  lifecycle: "active",
  visibility: "public" as const,
};

describe("reviewRepository", () => {
  test("green: counters sum to the files read", async () => {
    const tally = emptyTally();
    const reader: SourceReader = async () => ({
      kind: "read",
      tracked: 2,
      files: new Map([
        ["a.ts", "await db.query('SELECT 1');"],
        ["b.rs", "fn main() {}"],
      ]),
    });
    const checks = await reviewRepository(active, [], tally, reader);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(summarizeVolume(tally)).toBe(
      "1 inventory entries (1 read, 0 exempt): 2 of 2 tracked TS/JS/Rust source(s) scanned, 0 raw-SQL construction site(s) found, 0 covered by the allowlist, 0 not",
    );
  });

  test("red: an unreviewed site fails", async () => {
    const reader: SourceReader = async () => ({
      kind: "read",
      tracked: 1,
      files: new Map([["a.ts", "await db.exec(userSql);"]]),
    });
    const checks = await reviewRepository(active, [], emptyTally(), reader);
    expect(checks.some((c) => !c.ok)).toBe(true);
  });

  test("an unreadable source set fails and names the files", async () => {
    const reader: SourceReader = async () => ({
      kind: "unreadable",
      reason: "1 tracked source(s) could not be read",
      unreadableFiles: ["src/link.ts"],
    });
    const checks = await reviewRepository(active, [], emptyTally(), reader);
    expect(checks).toEqual([
      {
        item: "libre-ai/sample",
        ok: false,
        note: "sources unreadable: 1 tracked source(s) could not be read (src/link.ts)",
      },
    ]);
  });

  test("a failed clone fails, never 'no SQL'", async () => {
    const reader: SourceReader = async () => ({ kind: "unreadable", reason: "git clone failed" });
    const checks = await reviewRepository(active, [], emptyTally(), reader);
    expect(checks[0]?.ok).toBe(false);
  });
});

describe("parseAllowlist", () => {
  test("the committed allowlist parses, and every entry says why", async () => {
    const text = await Bun.file(
      new URL("sql-construction-allowlist.v1.yaml", import.meta.url),
    ).text();
    const entries = parseAllowlist(text);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.path.endsWith("adapters/expired-selection-query.ts"))).toBe(true);
  });

  test("an unknown rule, a zero count and a duplicate are refused", () => {
    const entry = "  - repository: r/x\n    path: a.ts\n    because: why\n";
    expect(() => parseAllowlist(`allowances:\n${entry}    rule: nope\n    count: 1\n`)).toThrow(
      "rule must be one of",
    );
    expect(() =>
      parseAllowlist(`allowances:\n${entry}    rule: unsafe-call\n    count: 0\n`),
    ).toThrow("count");
    const valid = `${entry}    rule: unsafe-call\n    count: 1\n`;
    expect(() => parseAllowlist(`allowances:\n${valid}${valid}`)).toThrow("duplicates");
  });
});

test("this gate's own sources hold no raw-SQL construction", async () => {
  const directory = new URL("./", import.meta.url);
  const own = (await readdir(directory)).filter(
    (name) => name.includes("sql-construction") && name.endsWith(".ts"),
  );
  expect(own.length).toBe(3);
  for (const name of own) {
    const text = await Bun.file(new URL(name, directory)).text();
    expect(`${name}: ${rules(scanSource(name, text)).join(",")}`).toBe(`${name}: `);
  }
});
