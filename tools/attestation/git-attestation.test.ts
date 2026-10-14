import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import {
  assertHandledTypes,
  buildManifest,
  canonicalJson,
  contentClasses,
  decodeDenyLiteral,
  type Finding,
  type Identity,
  parseArguments,
  parseIdentities,
  readAttestedRefs,
  readableObjects,
  refuseUnhandled,
  type ScanOptions,
  type ScanReport,
  scanRepository,
  stripAllowedAddresses,
  windowOverlap,
  windowSize,
} from "./git-attestation";

// Every canary is assembled at run time: this file must not itself be a hit for the
// repository's secret, personal-data and local-path gates, and a canary must never exist as a
// literal that a scan of this source could mistake for a real leak.
const canary = {
  credential: `${["AK", "IA"].join("")}ABCDEFGHIJKLMNOP`,
  localPath: `/${["Us", "ers"].join("")}/fixtureuser/project`,
  cookie: "Set-Cookie: sessionid=abcdef0123456789",
  email: ["fixture.person", "fixture-mail.net"].join("@"),
  phone: ["+33", "6", "12", "34", "56", "78"].join(" "),
  instance: "https://demo-app.cleverapps.io/",
  literal: "fixture-private-literal",
};

const owner: Identity = {
  name: "Fixture Owner",
  address: ["1+owner", "users.noreply.fixture-mail.net"].join("@"),
  scope: "anywhere",
};
const bot: Identity = {
  name: "Fixture Bot",
  address: ["2+bot", "users.noreply.fixture-mail.net"].join("@"),
  scope: "forge-added-only",
};
const identities = [owner, bot];
const options: ScanOptions = { identities, trustedRef: "refs/heads/main" };

const root = mkdtempSync(join(tmpdir(), "attestation-test-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const baseEnvironment = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: root,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

interface Who {
  readonly authorName: string;
  readonly authorAddress: string;
  readonly committerName: string;
  readonly committerAddress: string;
}
const ownerWho: Who = {
  authorName: owner.name,
  authorAddress: owner.address,
  committerName: owner.name,
  committerAddress: owner.address,
};

function identityEnvironment(who: Who): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: who.authorName,
    GIT_AUTHOR_EMAIL: who.authorAddress,
    GIT_COMMITTER_NAME: who.committerName,
    GIT_COMMITTER_EMAIL: who.committerAddress,
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
}

function git(
  dir: string,
  args: readonly string[],
  extra: Record<string, string> = {},
  input?: string | Uint8Array,
): string {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...baseEnvironment, ...extra },
    stdin: input === undefined ? "ignore" : typeof input === "string" ? Buffer.from(input) : input,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args[0]} exited ${result.exitCode}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

let counter = 0;
function freshDir(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function commit(
  dir: string,
  files: Readonly<Record<string, string | Uint8Array | null>>,
  message: string,
  who: Who = ownerWho,
): string {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) git(dir, ["rm", "-q", "-f", path]);
    else {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
  }
  git(dir, ["add", "-A"]);
  git(
    dir,
    ["commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", message],
    identityEnvironment(who),
  );
  return git(dir, ["rev-parse", "HEAD"]);
}

/** A repository whose history is clean: the control every red case departs from. */
function cleanRepo(label = "repo"): string {
  const dir = freshDir(label);
  git(dir, ["init", "-q", "-b", "main"]);
  commit(dir, { "README.md": "A clean readme with no sensitive content.\n" }, "Add readme");
  commit(dir, { "src/lib.rs": "pub fn answer() -> u32 { 42 }\n" }, "Add library");
  return dir;
}

function surfaces(report: ScanReport): string[] {
  return [...new Set(report.findings.map((finding) => finding.surface))].sort();
}

function expectOnly(report: ScanReport, expected: readonly string[]): void {
  expect(surfaces(report)).toEqual([...expected].sort());
}

function rawTree(
  entries: ReadonlyArray<{ mode: string; name: string | Uint8Array; oid: string }>,
): Buffer {
  return Buffer.concat(
    entries.flatMap((entry) => [
      Buffer.from(`${entry.mode} `),
      Buffer.from(entry.name),
      Buffer.from([0]),
      Buffer.from(entry.oid, "hex"),
    ]),
  );
}

function writeObject(dir: string, type: string, bytes: Uint8Array): string {
  return git(dir, ["hash-object", "-t", type, "-w", "--stdin", "--literally"], {}, bytes);
}

/** Replace main by a commit over `tree`, built with the given extra raw headers. */
function pointMainAt(dir: string, tree: string): string {
  const oid = git(
    dir,
    ["commit-tree", tree, "-p", "HEAD", "-m", "crafted"],
    identityEnvironment(ownerWho),
  );
  git(dir, ["update-ref", "refs/heads/main", oid]);
  return oid;
}

function craftedCommit(dir: string, extraHeaders: string, message: Uint8Array): string {
  const tree = git(dir, ["rev-parse", "HEAD^{tree}"]);
  const stamp = "1767225600 +0000";
  const person = `${owner.name} <${owner.address}> ${stamp}`;
  const head = `tree ${tree}\n${extraHeaders}author ${person}\ncommitter ${person}\n\n`;
  const oid = writeObject(dir, "commit", Buffer.concat([Buffer.from(head), message]));
  git(dir, ["update-ref", "refs/heads/main", oid]);
  return oid;
}

function scan(dir: string, extra: Partial<ScanOptions> = {}): ScanReport {
  return scanRepository(dir, { ...options, ...extra });
}

describe("control", () => {
  test("a clean history, including its owner address in a trailer, reports nothing", () => {
    const dir = cleanRepo();
    commit(
      dir,
      { "NOTES.md": "notes\n" },
      `Add notes\n\nSigned-off-by: ${owner.name} <${owner.address}>`,
    );
    const report = scan(dir);
    expect(report.findings).toEqual([]);
    expect(report.counters.commits).toBe(3);
    expect(report.counters.blobs).toBe(3);
    expect(report.counters.unreachableObjects).toBe(0);
  });

  test("benign look-alikes of each content class are not findings", () => {
    const dir = cleanRepo();
    commit(
      dir,
      {
        "doc.md":
          "This tool stores no cookie. A cookie banner is out of scope. Home is the tilde.\n",
        "Cargo.lock": `checksum = "${"a1".repeat(32)}"\n`,
      },
      "Add documentation",
    );
    expect(scan(dir).findings).toEqual([]);
  });
});

describe("blob bytes", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["credential", `key = ${canary.credential}\n`, "credential"],
    ["local path", `build at ${canary.localPath}\n`, "local-path"],
    ["cookie", `${canary.cookie}\n`, "cookie"],
    ["personal email", `contact ${canary.email}\n`, "personal-data"],
    ["personal phone", `call ${canary.phone}\n`, "personal-data"],
    ["instance configuration", `endpoint ${canary.instance}\n`, "instance-config"],
    ["denied literal", `value ${canary.literal}\n`, "denied-literal"],
  ];
  for (const [label, content, klass] of cases) {
    test(`red:blob-content ${label} in a blob`, () => {
      const dir = cleanRepo();
      commit(dir, { "notes.txt": content }, "Add notes");
      const report = scan(dir, { denyLiterals: [canary.literal] });
      expectOnly(report, ["blob"]);
      expect(report.findings.some((finding) => finding.kind.includes(klass))).toBe(true);
    });
    test(`red:content-${klass} ${label} is classified`, () => {
      expect(contentClasses(content, { ...options, denyLiterals: [canary.literal] })).toContain(
        klass,
      );
    });
  }

  test("red:blob-content a blob deleted in a later commit is still found", () => {
    const dir = cleanRepo();
    commit(dir, { "leak.txt": `${canary.credential}\n` }, "Add a file by mistake");
    commit(dir, { "leak.txt": null }, "Remove it again");
    expect(git(dir, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n")).not.toContain(
      "leak.txt",
    );
    expectOnly(scan(dir), ["blob"]);
  });

  test("red:blob-utf16 a UTF-16 blob is decoded before it is judged", () => {
    const dir = cleanRepo();
    commit(dir, { "wide.txt": Buffer.from(`﻿${canary.credential}`, "utf16le") }, "Add wide text");
    expectOnly(scan(dir), ["blob"]);
  });

  test("red:blob-limit a blob above the size limit is refused, not partly read", () => {
    const dir = cleanRepo();
    commit(dir, { "big.txt": "x".repeat(200) }, "Add a large file");
    const report = scan(dir, { maximumBlobBytes: 100 });
    expectOnly(report, ["blob"]);
    expect(report.findings[0]?.kind).toBe("resource-limit");
  });
});

describe("ref names and the attestation", () => {
  test("red:ref-name a local path inside a ref name", () => {
    const dir = cleanRepo();
    git(dir, ["update-ref", `refs/heads/work${canary.localPath}`, "HEAD"]);
    const report = scan(dir);
    expect(surfaces(report)).toContain("ref-name");
    expect(report.findings.find((finding) => finding.surface === "ref-name")?.kind).toBe(
      "local-path",
    );
  });

  test("red:ref-absent a ref the attestation does not list is refused", () => {
    const dir = cleanRepo();
    const attested = [{ name: "refs/heads/main", objectId: git(dir, ["rev-parse", "HEAD"]) }];
    git(dir, ["update-ref", "refs/pull/1/head", "HEAD"]);
    const report = scan(dir, { attestedRefs: attested });
    expectOnly(report, ["ref-set"]);
    expect(report.findings[0]?.kind).toBe("ref-absent-from-attestation");
  });

  test("red:ref-oid-changed an attested ref whose OID moved is refused", () => {
    const dir = cleanRepo();
    const attested = [{ name: "refs/heads/main", objectId: git(dir, ["rev-parse", "HEAD"]) }];
    commit(dir, { "more.md": "one more commit\n" }, "Move main");
    const report = scan(dir, { attestedRefs: attested });
    expectOnly(report, ["ref-set"]);
    expect(report.findings[0]?.kind).toBe("attested-ref-oid-changed");
  });

  test("red:ref-missing an attested ref that is gone is refused", () => {
    const dir = cleanRepo();
    const head = git(dir, ["rev-parse", "HEAD"]);
    const attested = [
      { name: "refs/heads/main", objectId: head },
      { name: "refs/pull/1/head", objectId: head },
    ];
    const report = scan(dir, { attestedRefs: attested });
    expectOnly(report, ["ref-set"]);
    expect(report.findings[0]?.kind).toBe("attested-ref-missing");
  });

  test("an attestation that matches exactly, forge refs included, is accepted", () => {
    const dir = cleanRepo();
    git(dir, ["update-ref", "refs/pull/1/head", "HEAD"]);
    git(dir, ["update-ref", "refs/heads/dependabot/cargo/group", "HEAD"]);
    const head = git(dir, ["rev-parse", "HEAD"]);
    const attested = [
      "refs/heads/main",
      "refs/pull/1/head",
      "refs/heads/dependabot/cargo/group",
    ].map((name) => ({ name, objectId: head }));
    expect(scan(dir, { attestedRefs: attested }).findings).toEqual([]);
  });

  test("red:trusted-ref a trusted ref that does not exist is refused", () => {
    const dir = cleanRepo();
    const report = scan(dir, { trustedRef: "refs/heads/absent" });
    expect(surfaces(report)).toContain("ref-set");
    expect(report.findings.some((finding) => finding.kind === "trusted-ref-missing")).toBe(true);
  });
});

describe("tree entries", () => {
  test("red:tree-mode a symlink entry is refused", () => {
    const dir = cleanRepo();
    const blob = git(dir, ["hash-object", "-w", "--stdin"], {}, "target");
    git(dir, ["update-index", "--add", "--cacheinfo", `120000,${blob},link`]);
    git(dir, ["commit", "-q", "--no-gpg-sign", "-m", "Add link"], identityEnvironment(ownerWho));
    const report = scan(dir);
    expectOnly(report, ["tree-entry"]);
    expect(report.findings[0]?.kind).toBe("mode-120000");
  });

  test("red:tree-mode a gitlink entry is refused", () => {
    const dir = cleanRepo();
    git(dir, [
      "update-index",
      "--add",
      "--cacheinfo",
      "160000,0123456789abcdef0123456789abcdef01234567,sub",
    ]);
    git(dir, ["commit", "-q", "--no-gpg-sign", "-m", "Add gitlink"], identityEnvironment(ownerWho));
    const report = scan(dir);
    expect(surfaces(report)).toContain("tree-entry");
    expect(report.findings.some((finding) => finding.kind === "mode-160000")).toBe(true);
  });

  test("red:tree-target-missing an entry pointing at an absent object is refused", () => {
    const dir = cleanRepo();
    const tree = writeObject(
      dir,
      "tree",
      rawTree([{ mode: "100644", name: "ghost", oid: "0123456789abcdef0123456789abcdef01234567" }]),
    );
    pointMainAt(dir, tree);
    const report = scan(dir);
    expect(surfaces(report)).toContain("tree-entry");
    expect(report.findings.some((finding) => finding.kind === "target-missing")).toBe(true);
  });

  test("red:tree-type a blob-mode entry pointing at a tree is refused", () => {
    const dir = cleanRepo();
    const treeOid = git(dir, ["rev-parse", "HEAD^{tree}"]);
    const tree = writeObject(
      dir,
      "tree",
      rawTree([{ mode: "100644", name: "wrong", oid: treeOid }]),
    );
    pointMainAt(dir, tree);
    const report = scan(dir);
    expect(surfaces(report)).toContain("tree-entry");
    expect(report.findings.some((finding) => finding.kind === "type-mismatch")).toBe(true);
  });

  const pathCases: ReadonlyArray<readonly [string, string, string, string]> = [
    ["tree-path-config", "instance configuration file name", ".env", "instance-config"],
    ["tree-path-capture", "capture artefact file name", "session.har", "capture-artefact"],
    ["tree-path", "credential in a file name", `key-${canary.credential}.txt`, "credential"],
    ["tree-path-unsafe", "backslash in a path component", "a\\b.txt", "unsafe-component"],
  ];
  for (const [id, label, name, klass] of pathCases) {
    test(`red:${id} ${label}`, () => {
      const dir = cleanRepo();
      commit(dir, { [name]: "harmless\n" }, "Add a file");
      const report = scan(dir);
      expectOnly(report, ["tree-path"]);
      expect(report.findings[0]?.kind).toContain(klass);
    });
  }

  test("red:tree-path-bytes a path that is not UTF-8 is refused", () => {
    const dir = cleanRepo();
    const blob = git(dir, ["hash-object", "-w", "--stdin"], {}, "x");
    const tree = writeObject(
      dir,
      "tree",
      rawTree([{ mode: "100644", name: Buffer.from([0x61, 0xff, 0x62]), oid: blob }]),
    );
    pointMainAt(dir, tree);
    const report = scan(dir);
    expect(surfaces(report)).toContain("tree-path");
    expect(report.findings.some((finding) => finding.kind === "not-utf8")).toBe(true);
  });
});

describe("commit identities and message", () => {
  const someoneElse = "Someone Else";
  const elsewhere = ["someone.else", "elsewhere-mail.net"].join("@");
  const roles: ReadonlyArray<readonly [string, Who, string]> = [
    ["author name", { ...ownerWho, authorName: someoneElse }, "author-name"],
    ["author address", { ...ownerWho, authorAddress: elsewhere }, "author-address"],
    ["committer name", { ...ownerWho, committerName: someoneElse }, "committer-name"],
    ["committer address", { ...ownerWho, committerAddress: elsewhere }, "committer-address"],
  ];
  for (const [label, who, surface] of roles) {
    test(`red:person-${surface.endsWith("name") ? "name" : "address"} ${label} outside the allowlist`, () => {
      const dir = cleanRepo();
      commit(dir, { "more.md": "more\n" }, "Add more", who);
      const report = scan(dir);
      expectOnly(report, [surface]);
      expect(report.findings.map((finding) => finding.kind)).toEqual(["not-allowlisted"]);
    });
  }

  test("red:person-pair a forge identity paired with the owner name is a mismatch", () => {
    const dir = cleanRepo();
    git(dir, ["switch", "-q", "-c", "side"]);
    commit(dir, { "bot.md": "bot\n" }, "Bot work", { ...ownerWho, authorAddress: bot.address });
    git(dir, ["switch", "-q", "main"]);
    const report = scan(dir);
    expectOnly(report, ["author-name"]);
    expect(report.findings[0]?.kind).toBe("pair-mismatch");
  });

  const botWho: Who = {
    authorName: bot.name,
    authorAddress: bot.address,
    committerName: bot.name,
    committerAddress: bot.address,
  };

  const trailer = `Signed-off-by: ${bot.name} <${bot.address}>`;

  test("a forge trailer address is accepted in the message of a forge-added commit", () => {
    const dir = cleanRepo();
    git(dir, ["switch", "-q", "-c", "forge/branch"]);
    commit(dir, { "bot.md": "bot\n" }, `Bot work\n\n${trailer}`, botWho);
    git(dir, ["switch", "-q", "main"]);
    expect(scan(dir).findings).toEqual([]);
  });

  test("red:strip-scope the forge trailer is refused in a commit main reaches", () => {
    const dir = cleanRepo();
    commit(dir, { "m.md": "m\n" }, `Owner work\n\n${trailer}`);
    expectOnly(scan(dir), ["commit-message"]);
  });

  test("red:strip-scope the forge trailer address is refused in a blob", () => {
    const dir = cleanRepo();
    git(dir, ["switch", "-q", "-c", "forge/branch"]);
    commit(dir, { "bot.md": `contact ${bot.address}\n` }, "Bot work", botWho);
    git(dir, ["switch", "-q", "main"]);
    expectOnly(scan(dir), ["blob"]);
  });

  test("a forge identity is accepted on a commit no trusted ref reaches", () => {
    const dir = cleanRepo();
    git(dir, ["switch", "-q", "-c", "forge/branch"]);
    commit(dir, { "bot.md": "bot\n" }, "Bot work", botWho);
    git(dir, ["switch", "-q", "main"]);
    expect(scan(dir).findings).toEqual([]);
  });

  test("red:person-address the same forge identity is refused on a commit main reaches", () => {
    const dir = cleanRepo();
    commit(dir, { "bot.md": "bot\n" }, "Bot work on main", botWho);
    const report = scan(dir);
    expectOnly(report, ["author-address", "author-name", "committer-address", "committer-name"]);
  });

  test("red:commit-message a credential in the message", () => {
    const dir = cleanRepo();
    commit(dir, { "m.md": "m\n" }, `Add m\n\nfound ${canary.credential} in the log`);
    expectOnly(scan(dir), ["commit-message"]);
  });

  test("red:commit-message a personal address in a trailer", () => {
    const dir = cleanRepo();
    commit(dir, { "m.md": "m\n" }, `Add m\n\nCo-authored-by: Someone <${canary.email}>`);
    expectOnly(scan(dir), ["commit-message"]);
  });

  test("red:commit-utf8 a message that is not UTF-8 is refused", () => {
    const dir = cleanRepo();
    craftedCommit(dir, "", Buffer.from([0x62, 0xff, 0xfe, 0x0a]));
    const report = scan(dir);
    expect(surfaces(report)).toContain("commit");
    expect(report.findings.some((finding) => finding.kind === "not-utf8")).toBe(true);
  });

  test("red:commit-header a header the scan does not handle is refused", () => {
    const dir = cleanRepo();
    craftedCommit(dir, "encoding ISO-8859-1\n", Buffer.from("legacy encoding\n"));
    const report = scan(dir);
    expect(report.findings.some((finding) => finding.kind === "header-not-handled")).toBe(true);
  });

  test("red:commit-signature a credential inside a signature header", () => {
    const dir = cleanRepo();
    craftedCommit(
      dir,
      `gpgsig -----BEGIN PGP SIGNATURE-----\n ${canary.credential}\n -----END PGP SIGNATURE-----\n`,
      Buffer.from("signed\n"),
    );
    const report = scan(dir);
    expect(surfaces(report)).toContain("commit-signature");
    expect(report.counters.signatures).toBe(1);
  });

  test("red:commit-link a parent absent from the object store is refused", () => {
    const dir = cleanRepo();
    craftedCommit(
      dir,
      "parent 0123456789abcdef0123456789abcdef01234567\n",
      Buffer.from("orphan link\n"),
    );
    // With a trusted ref, the history walk fails first and the scan is refused as a whole
    // ("read"); without one, the per-commit link check is what names the object.
    expect(surfaces(scan(dir))).toEqual(["object-store", "read"]);
    const report = scan(dir, { trustedRef: undefined });
    expect(report.findings.some((finding) => finding.kind === "link-missing")).toBe(true);
  });
});

describe("annotated tags", () => {
  function tag(dir: string, name: string, message: string, who: Who = ownerWho): void {
    git(dir, ["tag", "-a", "--no-sign", "-m", message, name], identityEnvironment(who));
  }

  test("an annotated tag by the owner is accepted and counted", () => {
    const dir = cleanRepo();
    tag(dir, "v1", "release");
    const report = scan(dir);
    expect(report.findings).toEqual([]);
    expect(report.counters.tags).toBe(1);
  });

  test("red:person-name tagger name outside the allowlist", () => {
    const dir = cleanRepo();
    tag(dir, "v1", "release", { ...ownerWho, committerName: "Someone Else" });
    expectOnly(scan(dir), ["tagger-name"]);
  });

  test("red:person-address tagger address outside the allowlist", () => {
    const dir = cleanRepo();
    tag(dir, "v1", "release", {
      ...ownerWho,
      committerAddress: ["someone.else", "elsewhere-mail.net"].join("@"),
    });
    expectOnly(scan(dir), ["tagger-address"]);
  });

  test("red:tag-message a credential in the tag message", () => {
    const dir = cleanRepo();
    tag(dir, "v1", `release ${canary.credential}`);
    expectOnly(scan(dir), ["tag-message"]);
  });

  test("red:tag-name a credential in the tag name", () => {
    const dir = cleanRepo();
    tag(dir, canary.credential, "release");
    expect(surfaces(scan(dir))).toContain("tag-name");
  });

  test("red:tagger-missing a tag object without a tagger is refused", () => {
    const dir = cleanRepo();
    const head = git(dir, ["rev-parse", "HEAD"]);
    const oid = writeObject(
      dir,
      "tag",
      Buffer.from(`object ${head}\ntype commit\ntag v1\n\nno tagger\n`),
    );
    git(dir, ["update-ref", "refs/tags/v1", oid]);
    const report = scan(dir);
    expect(surfaces(report)).toContain("tagger-name");
    expect(report.findings.some((finding) => finding.kind === "tagger-missing")).toBe(true);
  });
});

describe("repository state", () => {
  test("red:shallow a shallow clone is refused before anything is read", () => {
    const source = cleanRepo("source");
    const target = join(freshDir("shallow"), "clone");
    git(source, ["clone", "-q", "--depth", "1", `file://${source}`, target]);
    const report = scan(target);
    expectOnly(report, ["clone"]);
    expect(report.findings[0]?.kind).toBe("shallow");
  });

  test("red:fsck an object store git itself rejects is refused", () => {
    const dir = cleanRepo();
    const blob = git(dir, ["rev-parse", "HEAD:README.md"]);
    rmSync(join(dir, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
    const report = scan(dir);
    expect(surfaces(report)).toContain("object-store");
    expect(report.findings.some((finding) => finding.kind === "fsck-failed")).toBe(true);
  });

  test("red:unreachable an object no ref reaches is refused", () => {
    const dir = cleanRepo();
    git(dir, ["hash-object", "-w", "--stdin"], {}, "dangling content\n");
    const report = scan(dir);
    expectOnly(report, ["object"]);
    expect(report.findings[0]?.kind).toBe("unreachable-from-refs");
    expect(report.counters.unreachableObjects).toBe(1);
  });

  test("red:object-type a type other than commit, tree, blob or tag is not handled", () => {
    const entries = [
      { oid: "a".repeat(40), type: "blob", size: 1 },
      { oid: "b".repeat(40), type: "bogus", size: 2 },
    ];
    const findings: Finding[] = [];
    const refused = refuseUnhandled(entries, (surface, kind, oid) =>
      findings.push({ surface, kind, oid }),
    );
    expect(refused.map((entry) => entry.type)).toEqual(["bogus"]);
    expect(findings).toEqual([
      { surface: "object", kind: "type-not-handled", oid: "b".repeat(40) },
    ]);
  });

  test("a loose object of an unknown type makes git refuse, and the scan with it", () => {
    const dir = cleanRepo();
    const body = Buffer.concat([Buffer.from("bogus 2\0"), Buffer.from("hi")]);
    const sha = createHash("sha1").update(body).digest("hex");
    mkdirSync(join(dir, ".git", "objects", sha.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, ".git", "objects", sha.slice(0, 2), sha.slice(2)), deflateSync(body));
    const report = scan(dir);
    expect(surfaces(report)).toEqual(["object-store", "read"]);
    expect(() => buildManifest(dir, "fixture/repo")).toThrow();
  });
});

describe("diagnostics", () => {
  test("a report never carries the sensitive bytes it found", () => {
    const dir = cleanRepo();
    commit(
      dir,
      {
        "a.txt": `${canary.credential}\n${canary.localPath}\n${canary.cookie}\n`,
        "b.txt": `${canary.email} ${canary.phone} ${canary.instance} ${canary.literal}\n`,
      },
      `Add files\n\n${canary.credential}`,
    );
    const report = scan(dir, { denyLiterals: [canary.literal] });
    expect(report.findings.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(report);
    for (const secret of [
      canary.credential,
      "fixtureuser",
      "sessionid=abcdef",
      canary.email,
      "12 34 56 78",
      "demo-app",
      canary.literal,
    ])
      expect(serialised.includes(secret)).toBe(false);
  });

  test("contentClasses names classes only and sorts them", () => {
    const classes = contentClasses(`${canary.credential} ${canary.localPath}`, options);
    expect(classes).toEqual(["credential", "local-path"]);
  });
});

describe("manifest", () => {
  const script = join(import.meta.dir, "manifest.sh");

  function shellManifest(dir: string): { code: number; out: Buffer } {
    const result = Bun.spawnSync(["sh", script, dir], {
      env: { ...baseEnvironment, REPO: "fixture/repo" },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: result.exitCode, out: Buffer.from(result.stdout) };
  }

  test("the shell reference needs jq, and a missing jq is a failure, not a skip", () => {
    const result = Bun.spawnSync(["jq", "--version"], { env: baseEnvironment });
    expect(result.exitCode).toBe(0);
  });

  test("both implementations produce the same bytes, with refs, tags and a merge", () => {
    const dir = cleanRepo();
    git(dir, ["switch", "-q", "-c", "side"]);
    commit(dir, { "side.md": "side\n" }, "Side work");
    git(dir, ["switch", "-q", "main"]);
    commit(dir, { "main.md": "main\n" }, "Main work");
    git(
      dir,
      ["merge", "-q", "--no-ff", "--no-gpg-sign", "-m", "Merge side", "side"],
      identityEnvironment(ownerWho),
    );
    git(dir, ["tag", "-a", "--no-sign", "-m", "release", "v1"], identityEnvironment(ownerWho));
    git(dir, ["update-ref", "refs/pull/1/head", "HEAD"]);
    const typescript = buildManifest(dir, "fixture/repo");
    const shell = shellManifest(dir);
    expect(shell.code).toBe(0);
    expect(shell.out.toString()).toBe(typescript);
    expect(typescript.endsWith("\n")).toBe(false);
    expect(buildManifest(dir, "fixture/repo")).toBe(typescript);
    const parsed = JSON.parse(typescript) as { refs: Array<{ name: string }>; objects: unknown[] };
    expect(parsed.refs.map((ref) => ref.name)).toEqual([
      "refs/heads/main",
      "refs/heads/side",
      "refs/pull/1/head",
      "refs/tags/v1",
    ]);
  });

  test("red:manifest-shallow a shallow clone makes both implementations fail closed", () => {
    const source = cleanRepo("source");
    const target = join(freshDir("shallow"), "clone");
    git(source, ["clone", "-q", "--depth", "1", `file://${source}`, target]);
    expect(() => buildManifest(target, "fixture/repo")).toThrow("shallow");
    expect(shellManifest(target).code).not.toBe(0);
  });

  test("red:manifest-ascii a non-ASCII path makes both implementations fail closed", () => {
    const dir = cleanRepo();
    commit(dir, { "café.txt": "x\n" }, "Add an accented name");
    expect(() => buildManifest(dir, "fixture/repo")).toThrow();
    expect(shellManifest(dir).code).not.toBe(0);
  });

  function python(...args: string[]): { code: number; out: string } {
    const result = Bun.spawnSync(
      ["python3", "-I", join(import.meta.dir, "canonicalize.py"), ...args],
      {
        env: baseEnvironment,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return { code: result.exitCode, out: result.stdout.toString() };
  }

  test("the independent Python derivation reproduces the same bytes and digest", () => {
    const dir = cleanRepo();
    commit(dir, { "dir/nested.md": "nested\n" }, "Add a nested file");
    const expected = buildManifest(dir, "fixture/repo");
    const path = join(freshDir("manifest"), "manifest.jcs.json");
    writeFileSync(path, expected);
    const digest = createHash("sha256").update(expected).digest("hex");
    const derived = python("derive", dir, "fixture/repo", path);
    expect(derived.code).toBe(0);
    expect(derived.out).toContain(digest);
    const verified = python("verify", path);
    expect(verified.code).toBe(0);
    expect(verified.out).toContain(digest);
  });

  test("red:python-verify a retained manifest with a terminal newline or a changed byte is refused", () => {
    const dir = cleanRepo();
    const expected = buildManifest(dir, "fixture/repo");
    const base = freshDir("manifest");
    writeFileSync(join(base, "newline.json"), `${expected}\n`);
    writeFileSync(join(base, "unsorted.json"), '{"schemaVersion":"x","gitObjectFormat":"sha1"}');
    writeFileSync(join(base, "spaced.json"), JSON.stringify(JSON.parse(expected), null, 1));
    for (const name of ["newline.json", "unsorted.json", "spaced.json"])
      expect(python("verify", join(base, name)).code).not.toBe(0);
    writeFileSync(join(base, "other.json"), expected);
    expect(python("derive", dir, "fixture/other", join(base, "other.json")).code).not.toBe(0);
  });

  test("red:manifest-number a float, a negative or an unsafe integer is refused", () => {
    for (const bad of [1.5, -1, 9007199254740992, Number.NaN])
      expect(() => canonicalJson(bad)).toThrow("outside the admitted JCS subset");
    expect(canonicalJson(9007199254740991)).toBe("9007199254740991");
  });

  test("canonicalJson sorts keys and refuses what JCS cannot carry here", () => {
    expect(canonicalJson({ b: 1, a: ["x", 2], c: 'q"\\\n' })).toBe(
      '{"a":["x",2],"b":1,"c":"q\\"\\\\\\n"}',
    );
    expect(() => canonicalJson(1.5)).toThrow();
    expect(() => canonicalJson(-1)).toThrow();
    expect(() => canonicalJson("é")).toThrow();
  });

  test("an attestation's refs are read back from the manifest bytes", () => {
    const dir = cleanRepo();
    const path = join(freshDir("manifest"), "manifest.jcs.json");
    writeFileSync(path, buildManifest(dir, "fixture/repo"));
    const refs = readAttestedRefs(path);
    expect(refs).toEqual([{ name: "refs/heads/main", objectId: git(dir, ["rev-parse", "HEAD"]) }]);
    expect(scan(dir, { attestedRefs: refs }).findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Refusal sites added after the quality review of bd195d65: each has a `red:` test, and
// neutralise-check.ts counts the sites independently of the markers.
// ---------------------------------------------------------------------------

function collect(): {
  findings: Finding[];
  add: (surface: string, kind: string, oid: string) => void;
} {
  const findings: Finding[] = [];
  return {
    findings,
    add: (surface, kind, oid) => {
      findings.push({ surface, kind, oid });
    },
  };
}

function shellOf(dir: string): { code: number; out: string; err: string } {
  const result = Bun.spawnSync(["sh", join(import.meta.dir, "manifest.sh"), dir], {
    env: { ...baseEnvironment, REPO: "fixture/repo" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

function pythonOf(flags: string[], ...args: string[]): { code: number; out: string } {
  const result = Bun.spawnSync(
    ["python3", ...flags, join(import.meta.dir, "canonicalize.py"), ...args],
    { env: baseEnvironment, stdout: "pipe", stderr: "pipe" },
  );
  return { code: result.exitCode, out: result.stdout.toString() };
}

function craftedTag(
  dir: string,
  extraHeaders: string,
  message: Uint8Array,
  target?: string,
): string {
  const head = target ?? git(dir, ["rev-parse", "HEAD"]);
  const text = `object ${head}\ntype commit\ntag v9\n${extraHeaders}tagger ${owner.name} <${owner.address}> 1767225600 +0000\n\n`;
  const oid = writeObject(dir, "tag", Buffer.concat([Buffer.from(text), message]));
  git(dir, ["update-ref", "refs/tags/v9", oid]);
  return oid;
}

describe("repository access", () => {
  test("red:git-exit a directory that is not a repository is refused, not read as empty", () => {
    const report = scanRepository(freshDir("not-a-repository"), options);
    expectOnly(report, ["read"]);
    expect(() => buildManifest(freshDir("not-a-repository"), "fixture/repo")).toThrow();
  });

  test("red:git-failure the refusal names the read failure and no object", () => {
    const report = scanRepository(freshDir("not-a-repository"), options);
    expect(report.findings).toEqual([{ surface: "read", kind: "git-failure", oid: "" }]);
  });

  test("red:unreadable an object git listed but cannot read is refused, not skipped", () => {
    const entry = { oid: "a".repeat(40), type: "blob", size: 1 };
    const { findings, add } = collect();
    const readable = readableObjects([entry], new Map([[entry.oid, null]]), add);
    expect(readable).toEqual([]);
    expect(findings).toEqual([{ surface: "object", kind: "unreadable", oid: entry.oid }]);
  });

  test("red:manifest-type the manifest refuses an object type it cannot describe", () => {
    expect(() => assertHandledTypes([{ oid: "a".repeat(40), type: "bogus", size: 1 }])).toThrow(
      "object type not handled",
    );
    expect(() =>
      assertHandledTypes([{ oid: "a".repeat(40), type: "blob", size: 1 }]),
    ).not.toThrow();
  });

  test("red:tree-malformed a truncated tree entry is refused by the scan and the manifest", () => {
    const dir = cleanRepo();
    const tree = writeObject(
      dir,
      "tree",
      Buffer.concat([Buffer.from("100644 x\0"), Buffer.from("abc")]),
    );
    pointMainAt(dir, tree);
    const report = scan(dir);
    expect(report.findings).toContainEqual({ surface: "read", kind: "git-failure", oid: "" });
    expect(() => buildManifest(dir, "fixture/repo")).toThrow("tree entry malformed");
  });
});

describe("content windows and address boundaries", () => {
  test("red:window-tail a secret beyond the first window is found", () => {
    const text = `${"x".repeat(windowSize * 2 + 100)}\n${canary.credential}\n`;
    expect(contentClasses(text, options)).toContain("credential");
  });

  test("red:window-overlap a secret straddling a window boundary is found", () => {
    expect(windowOverlap).toBeGreaterThanOrEqual(canary.credential.length);
    const text = `${"x".repeat(windowSize - 8)}${canary.credential}${"x".repeat(windowSize)}`;
    expect(contentClasses(text, options)).toContain("credential");
  });

  test("red:blob-utf8 a compatibility-form secret is only visible through the UTF-8 reading", () => {
    const wide = [...canary.credential]
      .map((character) => String.fromCodePoint((character.codePointAt(0) ?? 0) + 0xfee0))
      .join("");
    const dir = cleanRepo();
    commit(dir, { "wide.txt": `${wide}\n` }, "Add wide characters");
    expectOnly(scan(dir), ["blob"]);
  });

  test("red:strip-boundary an address that continues a longer address is not masked", () => {
    const forge = (text: string) => contentClasses(text, options, true);
    expect(forge(`jane.doe.${bot.address}`)).toEqual(["personal-data"]);
    expect(forge(`jane-${bot.address}`)).toEqual(["personal-data"]);
    expect(forge(`${bot.address}.elsewhere-mail.net`)).toEqual(["personal-data"]);
    expect(forge(`${bot.address}x`)).toEqual(["personal-data"]);
    expect(contentClasses(`jane.doe${owner.address}`, options)).toEqual(["personal-data"]);
    // Delimited occurrences are still removed.
    expect(forge(`Signed-off-by: x <${bot.address}>.`)).toEqual([]);
    expect(forge(`(${bot.address}), ${bot.address}`)).toEqual([]);
    expect(stripAllowedAddresses(`<${owner.address}>`, identities, false)).toBe("<>");
  });
});

describe("tree path and identity header refusals", () => {
  test("red:tree-path-dot a .git or .. path component is refused", () => {
    for (const name of [".git", ".."]) {
      const dir = cleanRepo();
      const blob = git(dir, ["hash-object", "-w", "--stdin"], {}, "x");
      pointMainAt(dir, writeObject(dir, "tree", rawTree([{ mode: "100644", name, oid: blob }])));
      const report = scan(dir);
      expect(report.findings).toContainEqual(
        expect.objectContaining({ surface: "tree-path", kind: "unsafe-component" }),
      );
    }
  });

  test("red:person-malformed an author or committer line that is not a person is refused", () => {
    const dir = cleanRepo();
    const tree = git(dir, ["rev-parse", "HEAD^{tree}"]);
    const oid = writeObject(
      dir,
      "commit",
      Buffer.from(`tree ${tree}\nauthor garbage\ncommitter garbage\n\nmessage\n`),
    );
    git(dir, ["update-ref", "refs/heads/main", oid]);
    const report = scan(dir);
    expect(report.findings).toContainEqual({
      surface: "author-name",
      kind: "header-malformed",
      oid,
    });
    expect(report.findings).toContainEqual({
      surface: "committer-name",
      kind: "header-malformed",
      oid,
    });
  });

  test("red:commit-headers a commit header line without a name is refused", () => {
    const dir = cleanRepo();
    const oid = craftedCommit(dir, "broken\n", Buffer.from("message\n"));
    expect(scan(dir).findings).toContainEqual({
      surface: "commit",
      kind: "headers-malformed",
      oid,
    });
  });
});

describe("tag object refusals", () => {
  test("red:tag-header an extra tag header is refused and passes git fsck --strict", () => {
    const dir = cleanRepo();
    const oid = craftedTag(dir, "x-extra payload\n", Buffer.from("message\n"));
    const fsck = Bun.spawnSync(["git", "-C", dir, "fsck", "--strict"], { env: baseEnvironment });
    expect(fsck.exitCode).toBe(0);
    expect(scan(dir).findings).toContainEqual({ surface: "tag", kind: "header-not-handled", oid });
  });

  test("red:tag-utf8 a tag message that is not UTF-8 is refused", () => {
    const dir = cleanRepo();
    const oid = craftedTag(dir, "", Buffer.from([0x62, 0xff, 0xfe, 0x0a]));
    expect(scan(dir).findings).toContainEqual({ surface: "tag", kind: "not-utf8", oid });
  });

  test("red:tag-headers a tag header line without a name is refused", () => {
    const dir = cleanRepo();
    const oid = craftedTag(dir, "broken\n", Buffer.from("message\n"));
    expect(scan(dir).findings).toContainEqual({ surface: "tag", kind: "headers-malformed", oid });
  });

  test("red:tag-link a tag pointing at an absent object is refused", () => {
    const dir = cleanRepo();
    const oid = craftedTag(
      dir,
      "",
      Buffer.from("message\n"),
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(scan(dir).findings).toContainEqual({ surface: "tag", kind: "link-missing", oid });
  });
});

describe("operator input", () => {
  const cliPath = join(import.meta.dir, "git-attestation.ts");
  const repository = cleanRepo("cli");
  const identitiesPath = join(freshDir("identities"), "identities.json");
  writeFileSync(identitiesPath, JSON.stringify(identities));

  function cli(...args: string[]): { code: number; out: string; err: string } {
    const result = Bun.spawnSync(["bun", cliPath, ...args], {
      env: baseEnvironment,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
  }

  test("control: a clean scan exits 0, a dirty one exits 1, and both print counters", () => {
    expect(cli("scan", repository, "--identities", identitiesPath).code).toBe(0);
    const dirty = cleanRepo("dirty");
    commit(dirty, { "leak.txt": `${canary.credential}\n` }, "Add a leak");
    const result = cli("scan", dirty, "--identities", identitiesPath);
    expect(result.code).toBe(1);
    expect(result.out).toContain('"blobs"');
    expect(result.out).not.toContain(canary.credential);
  });

  test("red:cli-flag-value a flag without a value, or followed by a flag, exits 2", () => {
    const missing = cli("scan", repository, "--identities", identitiesPath, "--attestation");
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("--attestation needs a value");
    const swallowed = cli("scan", repository, "--trusted-ref", "--identities", identitiesPath);
    expect(swallowed.code).toBe(2);
  });

  test("red:cli-flag-unknown an unknown flag exits 2", () => {
    expect(cli("scan", repository, "--identities", identitiesPath, "--nope", "x").code).toBe(2);
  });

  test("red:cli-flag-duplicate a repeated single-value flag exits 2", () => {
    expect(
      cli("scan", repository, "--identities", identitiesPath, "--identities", identitiesPath).code,
    ).toBe(2);
  });

  test("red:cli-b64-form a deny literal that is not canonical base64 exits 2 and is not echoed", () => {
    for (const bad of ["not base64!", "YQ", "", "YQ=a"]) {
      const result = cli("scan", repository, "--identities", identitiesPath, "--deny-b64", bad);
      expect(result.code).toBe(2);
      if (bad.length > 3) expect(result.err.includes(bad)).toBe(false);
    }
    expect(decodeDenyLiteral(Buffer.from("literal").toString("base64"))).toBe("literal");
  });

  test("red:cli-b64-utf8 a deny literal that is not UTF-8 exits 2", () => {
    const encoded = Buffer.from([0xff, 0xfe]).toString("base64");
    expect(
      cli("scan", repository, "--identities", identitiesPath, "--deny-b64", encoded).code,
    ).toBe(2);
    expect(() => decodeDenyLiteral(encoded)).toThrow("not UTF-8");
  });

  test("red:cli-positional manifest without a repository name, or with extras, exits 2", () => {
    expect(cli("manifest", repository).code).toBe(2);
    expect(cli("manifest", repository, "fixture/repo", "extra").code).toBe(2);
    expect(cli("manifest", repository, "fixture/repo").code).toBe(0);
  });

  test("red:cli-scan-usage scan without an identities file, or with extras, exits 2", () => {
    expect(cli("scan", repository).code).toBe(2);
    expect(cli("scan", repository, "extra", "--identities", identitiesPath).code).toBe(2);
  });

  test("red:cli-text-usage text without files or without identities exits 2; hits name a class only", () => {
    expect(cli("text", "--identities", identitiesPath).code).toBe(2);
    const base = freshDir("text");
    writeFileSync(join(base, "clean.log"), "step ok\n");
    writeFileSync(join(base, "dirty.log"), `token ${canary.credential} at ${canary.localPath}\n`);
    expect(cli("text", join(base, "clean.log")).code).toBe(2);
    expect(cli("text", join(base, "clean.log"), "--identities", identitiesPath).code).toBe(0);
    const dirty = cli(
      "text",
      join(base, "clean.log"),
      join(base, "dirty.log"),
      "--identities",
      identitiesPath,
    );
    expect(dirty.code).toBe(1);
    expect(JSON.parse(dirty.out)).toMatchObject({ files: 2 });
    expect(dirty.out).toContain('"credential"');
    expect(dirty.out.includes(canary.credential)).toBe(false);
    expect(dirty.out.includes("fixtureuser")).toBe(false);
  });

  test("red:cli-command an unknown command exits 2", () => {
    expect(cli("frobnicate", repository, "--identities", identitiesPath).code).toBe(2);
    expect(cli("frobnicate", repository).code).toBe(2);
    expect(cli().code).toBe(2);
  });

  test("parseArguments keeps repeatable flags and positional order", () => {
    const parsed = parseArguments(["scan", "dir", "--deny-b64", "YQ==", "--deny-b64", "Yg=="]);
    expect(parsed.positional).toEqual(["scan", "dir"]);
    expect(parsed.flags.get("--deny-b64")).toEqual(["YQ==", "Yg=="]);
  });

  const ownerEntry: Identity = { name: "N", address: "a@b", scope: "anywhere" };

  test("red:identities-json an identities file that is not JSON is refused", () => {
    expect(() => parseIdentities("{")).toThrow("not JSON");
  });

  test("red:identities-array an identities file that is not a non-empty array is refused", () => {
    expect(() => parseIdentities("{}")).toThrow("non-empty array");
    expect(() => parseIdentities("[]")).toThrow("non-empty array");
  });

  test("red:identities-object an entry that is not an object is refused", () => {
    expect(() => parseIdentities("[1]")).toThrow("not an object");
    expect(() => parseIdentities("[null]")).toThrow("not an object");
  });

  test("red:identities-keys an entry with a missing or extra field is refused", () => {
    expect(() => parseIdentities(JSON.stringify([{ name: "N", scope: "anywhere" }]))).toThrow(
      "exactly",
    );
    expect(() => parseIdentities(JSON.stringify([{ ...ownerEntry, extra: 1 }]))).toThrow("exactly");
  });

  test("red:identities-strings an entry with an empty or non-string name or address is refused", () => {
    expect(() => parseIdentities(JSON.stringify([{ ...ownerEntry, name: "" }]))).toThrow(
      "non-empty",
    );
    expect(() => parseIdentities(JSON.stringify([{ ...ownerEntry, address: 7 }]))).toThrow(
      "non-empty",
    );
  });

  test("red:identities-scope an unknown scope is refused", () => {
    expect(() => parseIdentities(JSON.stringify([{ ...ownerEntry, scope: "everywhere" }]))).toThrow(
      "scope must be",
    );
    expect(() => parseIdentities(JSON.stringify([{ ...ownerEntry, scope: "Anywhere" }]))).toThrow(
      "scope must be",
    );
  });

  test("red:identities-owner a file without an owner entry is refused", () => {
    expect(() =>
      parseIdentities(JSON.stringify([{ ...ownerEntry, scope: "forge-added-only" }])),
    ).toThrow("no owner entry");
    expect(parseIdentities(JSON.stringify([ownerEntry]))).toEqual([ownerEntry]);
  });

  test("the committed allowlist shape is accepted and a bad file exits 2 end to end", () => {
    const base = freshDir("identities");
    writeFileSync(join(base, "bad.json"), JSON.stringify([{ ...ownerEntry, scope: "owner" }]));
    expect(cli("scan", repository, "--identities", join(base, "bad.json")).code).toBe(2);
    expect(parseIdentities(JSON.stringify(identities))).toEqual(identities);
  });

  test("red:attestation-refs a manifest without a refs array is refused", () => {
    const base = freshDir("attestation");
    for (const [name, body] of [
      ["a.json", "{}"],
      ["b.json", "[]"],
      ["c.json", '{"refs":"main"}'],
    ] as const) {
      writeFileSync(join(base, name), body);
      expect(() => readAttestedRefs(join(base, name))).toThrow("no refs array");
    }
  });

  test("red:attestation-ref a manifest ref without a name or an object id is refused", () => {
    const base = freshDir("attestation");
    for (const [name, body] of [
      ["a.json", '{"refs":[{"name":"refs/heads/main"}]}'],
      ["b.json", '{"refs":[1]}'],
      ["c.json", '{"refs":[{"name":1,"objectId":"x"}]}'],
    ] as const) {
      writeFileSync(join(base, name), body);
      expect(() => readAttestedRefs(join(base, name))).toThrow("ref malformed");
    }
  });
});

describe("shell and Python derivations on hard inputs", () => {
  test("red:manifest-newline a path holding a newline appears in both implementations", () => {
    const dir = cleanRepo();
    commit(dir, { "a\nb.txt": "x\n" }, "Add a path with a newline");
    const typescript = buildManifest(dir, "fixture/repo");
    const shell = shellOf(dir);
    expect(shell.code).toBe(0);
    expect(shell.out).toBe(typescript);
    const parsed = JSON.parse(typescript) as { treeEntries: Array<{ name: string }> };
    expect(parsed.treeEntries.some((entry) => entry.name === "a\nb.txt")).toBe(true);
  });

  test("red:manifest-count the shell never succeeds with bytes that differ from the TypeScript ones", () => {
    const dir = cleanRepo();
    commit(dir, { "a\nb.txt": "x\n" }, "Add a path with a newline");
    const typescript = buildManifest(dir, "fixture/repo");
    const shell = shellOf(dir);
    if (shell.code === 0) expect(shell.out).toBe(typescript);
    else expect(shell.err).toContain("tree entries dropped");
  });

  test("red:python-derive the derivation refuses a differing manifest, also under -O", () => {
    const dir = cleanRepo();
    const bogus = join(freshDir("python"), "bogus.json");
    writeFileSync(bogus, "{}");
    for (const flags of [["-I"], ["-I", "-O"]])
      expect(pythonOf(flags, "derive", dir, "fixture/repo", bogus).code).not.toBe(0);
  });

  test("red:python-verify a non-canonical manifest is refused, also under -O", () => {
    const bogus = join(freshDir("python"), "unsorted.json");
    writeFileSync(bogus, '{"b":1,"a":2}');
    for (const flags of [["-I"], ["-I", "-O"]])
      expect(pythonOf(flags, "verify", bogus).code).not.toBe(0);
  });
});
