import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  concludeFingerprint,
  duplicatePaths,
  FINGERPRINT_RECIPE,
  type FileRecord,
  fingerprintOf,
  fingerprintPreimage,
  fingerprintSkillDirectory,
  type SkillFingerprint,
} from "./skill-fingerprint";

// Recipe `libre-ai.skill-fingerprint.v1` (ADR-0072 D1). The expected values
// below come from the recipe as written and from `shasum`, never from the
// output of the code under test.

/** SHA-256 of the three bytes `abc` (FIPS 180-2 test vector). */
const SHA_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
/** SHA-256 of the empty input (FIPS 180-2 test vector). */
const SHA_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const workspaces: string[] = [];

afterAll(() => {
  for (const path of workspaces) rmSync(path, { recursive: true, force: true });
});

/** A fixture skill directory holding the given files (relative path -> content). */
function skill(files: Readonly<Record<string, string>>): string {
  const workspace = mkdtempSync(join(tmpdir(), "skill-fingerprint-"));
  workspaces.push(workspace);
  const directory = join(workspace, "alpha");
  mkdirSync(directory);
  for (const [relative, content] of Object.entries(files)) {
    const path = join(directory, relative);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content);
  }
  return directory;
}

function fingerprint(directory: string): string {
  const result = fingerprintSkillDirectory(directory);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusals)}`);
  return result.fingerprint;
}

function refusals(result: SkillFingerprint): string[] {
  return result.ok ? [] : result.refusals.map(({ path, reason }) => `${path}: ${reason}`);
}

describe("the recipe, on records", () => {
  const records: readonly FileRecord[] = [
    { path: "scripts/run.sh", executable: true, sha256: SHA_EMPTY },
    { path: "SKILL.md", executable: false, sha256: SHA_ABC },
  ];

  test("the preimage is the recipe line, then one length-prefixed line per file, sorted", () => {
    expect(fingerprintPreimage(records)).toBe(
      `libre-ai.skill-fingerprint.v1\nfile - ${SHA_ABC} 8:SKILL.md\nfile x ${SHA_EMPTY} 14:scripts/run.sh\n`,
    );
    expect(FINGERPRINT_RECIPE).toBe("libre-ai.skill-fingerprint.v1");
  });

  // `printf '<the preimage above>' | shasum -a 256`, run outside this code.
  test("the fingerprint is the SHA-256 of that preimage", () => {
    expect(fingerprintOf(records)).toBe(
      "sha256:ba9893cd1169de915e2247846414efd1377a5e62d29dad624f90e7776eaf89b7",
    );
  });

  test("the order the records come in changes nothing", () => {
    expect(fingerprintOf([...records].reverse())).toBe(fingerprintOf(records));
  });

  // U+FF5E is EF BD 9E in UTF-8 and FF5E in UTF-16; U+1F600 is F0 9F 98 80 in
  // UTF-8 and D83D DE00 in UTF-16. The two orders disagree on this pair.
  test("paths are sorted by their UTF-8 bytes, not by UTF-16 code units", () => {
    const preimage = fingerprintPreimage([
      { path: "\u{1F600}.md", executable: false, sha256: SHA_ABC },
      { path: "\u{FF5E}.md", executable: false, sha256: SHA_ABC },
    ]);
    expect(preimage.indexOf("\u{FF5E}.md")).toBeLessThan(preimage.indexOf("\u{1F600}.md"));
  });

  test("the length of a path is counted in bytes", () => {
    expect(fingerprintPreimage([{ path: "é.md", executable: false, sha256: SHA_ABC }])).toContain(
      " 5:é.md\n",
    );
  });

  // Without the length prefix, one file whose name holds a line break and the
  // text of a record would hash like two files.
  test("a path that holds the text of a record is not read as a second record", () => {
    const one = [{ path: `a\nfile - ${SHA_ABC} 1:b`, executable: false, sha256: SHA_ABC }];
    const two = [
      { path: "a", executable: false, sha256: SHA_ABC },
      { path: "b", executable: false, sha256: SHA_ABC },
    ];
    expect(fingerprintOf(one)).not.toBe(fingerprintOf(two));
  });

  test("duplicatePaths names each repeated path once", () => {
    expect(duplicatePaths(["a", "b", "a", "c", "a", "c"])).toEqual(["a", "c"]);
    expect(duplicatePaths(["a", "b"])).toEqual([]);
  });

  // Two names that are one path after NFC. Staged on records: the file system
  // of a workstation (APFS) folds the two names into one file, the one of the
  // CI runner keeps both.
  test("two records with one path have no fingerprint, and the path is named", () => {
    const twice: readonly FileRecord[] = [
      { path: "caf\u{E9}.md", executable: false, sha256: SHA_ABC },
      { path: "caf\u{E9}.md", executable: false, sha256: SHA_EMPTY },
    ];
    const result = concludeFingerprint("skills/alpha", twice, []);
    expect(result.ok).toBe(false);
    expect(
      refusals(result).filter((line) => line.includes("skills/alpha/caf\u{E9}.md")),
    ).toHaveLength(1);
    expect(concludeFingerprint("skills/alpha", records, []).ok).toBe(true);
  });
});

describe("the walk of a directory", () => {
  test("reads every file at any depth and agrees with the recipe on records", () => {
    const directory = skill({ "SKILL.md": "abc", "scripts/run.sh": "" });
    chmodSync(join(directory, "scripts/run.sh"), 0o755);
    expect(fingerprintSkillDirectory(directory)).toEqual({
      ok: true,
      fingerprint: "sha256:ba9893cd1169de915e2247846414efd1377a5e62d29dad624f90e7776eaf89b7",
      files: 2,
    });
  });

  test("one byte changed in a file changes the fingerprint", () => {
    const directory = skill({ "SKILL.md": "abc", "eval.json": "{}\n" });
    const before = fingerprint(directory);
    writeFileSync(join(directory, "eval.json"), "{ }\n");
    expect(fingerprint(directory)).not.toBe(before);
  });

  test("a renamed file changes the fingerprint, an added empty directory does not", () => {
    const directory = skill({ "SKILL.md": "abc", "references/a.md": "x\n" });
    const before = fingerprint(directory);
    mkdirSync(join(directory, "empty"));
    expect(fingerprint(directory)).toBe(before);
    renameSync(join(directory, "references/a.md"), join(directory, "references/b.md"));
    expect(fingerprint(directory)).not.toBe(before);
  });

  // Criterion: the fingerprint does not depend on the umask of the clone.
  test("only the owner's execute bit counts", () => {
    const withMode = (mode: number): string => {
      const directory = skill({ "SKILL.md": "abc", "run.sh": "echo ok\n" });
      chmodSync(join(directory, "run.sh"), mode);
      return fingerprint(directory);
    };
    expect(withMode(0o700)).toBe(withMode(0o755));
    expect(withMode(0o655)).toBe(withMode(0o644));
    expect(withMode(0o755)).not.toBe(withMode(0o644));
  });

  test("a name composed two ways is one path (NFC)", () => {
    const composed = skill({ "caf\u{E9}.md": "x\n" });
    const decomposed = skill({ "cafe\u{301}.md": "x\n" });
    expect(fingerprint(decomposed)).toBe(fingerprint(composed));
  });

  test("a symbolic link in the directory is a named refusal, and its target is not hashed", () => {
    const directory = skill({ "SKILL.md": "abc" });
    const outside = join(directory, "..", "outside.md");
    writeFileSync(outside, "not part of the skill\n");
    symlinkSync(outside, join(directory, "linked.md"));
    const result = fingerprintSkillDirectory(directory);
    expect(result.ok).toBe(false);
    expect(refusals(result)).toEqual([
      `${join(directory, "linked.md")}: symbolic link, never followed: the repository versions the link, not its target`,
    ]);
  });

  test("a linked sub-directory and a dangling link are refused too", () => {
    const directory = skill({ "SKILL.md": "abc" });
    const elsewhere = skill({ "notes.md": "x\n" });
    symlinkSync(elsewhere, join(directory, "references"));
    symlinkSync(join(directory, "nowhere"), join(directory, "dangling"));
    expect(refusals(fingerprintSkillDirectory(directory)).sort()).toEqual([
      `${join(directory, "dangling")}: symbolic link, never followed: the repository versions the link, not its target`,
      `${join(directory, "references")}: symbolic link, never followed: the repository versions the link, not its target`,
    ]);
  });

  test("a skill directory that is itself a link is refused", () => {
    const real = skill({ "SKILL.md": "abc" });
    const link = join(real, "..", "beta");
    symlinkSync(real, link);
    expect(refusals(fingerprintSkillDirectory(link))).toEqual([
      `${link}: symbolic link, never followed: the repository versions the link, not its target`,
    ]);
  });

  test("a FIFO is refused without being opened", () => {
    const directory = skill({ "SKILL.md": "abc" });
    const fifo = join(directory, "pipe");
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
    expect(refusals(fingerprintSkillDirectory(directory))).toEqual([
      `${fifo}: not a regular file (FIFO, socket or device), never opened`,
    ]);
  });

  test("a file or a directory that cannot be read is a named refusal, not a skipped file", () => {
    const directory = skill({ "SKILL.md": "abc", "locked.md": "x\n", "closed/a.md": "x\n" });
    chmodSync(join(directory, "locked.md"), 0o000);
    chmodSync(join(directory, "closed"), 0o000);
    const result = fingerprintSkillDirectory(directory);
    chmodSync(join(directory, "closed"), 0o755);
    expect(refusals(result).sort()).toEqual([
      `${join(directory, "closed")}: directory cannot be listed (EACCES)`,
      `${join(directory, "locked.md")}: cannot be read (EACCES)`,
    ]);
  });

  test("a path that is absent, or is a file, has no fingerprint", () => {
    const directory = skill({ "SKILL.md": "abc" });
    expect(refusals(fingerprintSkillDirectory(join(directory, "missing")))).toEqual([
      `${join(directory, "missing")}: cannot be inspected (ENOENT)`,
    ]);
    expect(refusals(fingerprintSkillDirectory(join(directory, "SKILL.md")))).toEqual([
      `${join(directory, "SKILL.md")}: not a directory`,
    ]);
  });
});
