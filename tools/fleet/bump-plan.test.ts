import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  citedPaths,
  fileSites,
  type HistoricalSite,
  type PlanContext,
  planRepository,
  type RepositoryPlan,
  type Snapshot,
  scanSnapshot,
} from "./bump-plan";

// The fixtures are the files today's bump pull requests changed, copied byte
// for byte from the merged commit (`after/`) and its first parent (`before/`),
// suffixed `.fixture` so no linter, formatter or manifest scanner of this
// repository mistakes them for its own files. product-research is private: its
// fixture is a reconstruction from the public fleet template, compared byte for
// byte with the private files outside this repository on 2026-10-09.
const FIXTURES = join(import.meta.dir, "fixtures");

const M = "7c2238d6185e59d446586688ca7db32e6a17d3e0";
const N = "46061644fb17bc14e67d3501602b7904fce75ae0";
const P = "1c8b37c80beb41f640982768ec27304a911e0b8e";
// The integrity signalement#12 recorded for P, equal to the sha512 of the
// legacy tarball GitHub serves for P (measured on 2026-10-09).
const P_INTEGRITY =
  "sha512-DNwtexx4cSl8Em0vEs9lTyFfLwBHVMfAAK8DvP5N4eJn7rzDrXlEoMTylkq+a9Xf/HF5AHYfTWmdoA4eRRQyzw==";
const ATTESTATION =
  "docs/reviews/signalement-bootstrap/8b02f8e61e1675948caaea5be3c57a898cbd624b/ATTESTATION.md";
const ADT_HISTORICAL = "8a27b8f5bf774fad04b8478fa9179eefdba0eaf7";

function readTree(directory: string, prefix = ""): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      for (const [inner, text] of readTree(path, `${prefix}${name}/`)) files.set(inner, text);
    } else if (name.endsWith(".fixture")) {
      files.set(`${prefix}${name.slice(0, -".fixture".length)}`, readFileSync(path, "utf8"));
    }
  }
  return files;
}

const fixture = (name: string, side: "before" | "after"): Map<string, string> =>
  readTree(join(FIXTURES, name, side));
const governance = (sha: string, file: string): string =>
  readFileSync(join(FIXTURES, "project-governance", sha.slice(0, 8), `${file}.fixture`), "utf8");

const HISTORICAL: readonly HistoricalSite[] = [
  {
    repository: "libre-ai/application-development-toolkit",
    path: ".github/workflows/playwright-guid-diagnostic.yml",
    sha: ADT_HISTORICAL,
    reason: "replays the tooling of the run it investigates",
  },
];

const context = (overrides: Partial<PlanContext> = {}): PlanContext => ({
  target: P,
  generations: [M, N, P],
  historical: HISTORICAL,
  composition: new Map([
    [M, governance(M, "manifest.json")],
    [N, governance(N, "manifest.json")],
    [P, governance(P, "manifest.json")],
  ]),
  targetManifest: governance(P, "package.json"),
  targetIntegrity: P_INTEGRITY,
  targetPaths: new Set([ATTESTATION]),
  ...overrides,
});

const plan = (
  repository: string,
  files: ReadonlyMap<string, string>,
  overrides: Partial<PlanContext> = {},
): RepositoryPlan => {
  const snapshot: Snapshot = { repository, files };
  const ctx = context(overrides);
  return planRepository(snapshot, scanSnapshot(snapshot, ctx.historical), ctx);
};

const editedFiles = (result: RepositoryPlan): Map<string, string> =>
  new Map(result.edits.map((edit) => [edit.path, edit.after]));

// Each merged bump pull request of the P wave whose diff is pin surfaces only:
// the plan computed on its first parent must BE the merged files, byte for
// byte, and touch no other file.
const PURE_BUMPS: readonly {
  name: string;
  repository: string;
  from: string;
  pinFiles: string[];
}[] = [
  {
    name: "signalement-12",
    repository: "libre-ai/signalement",
    from: M,
    pinFiles: [
      ".github/workflows/ci.yml",
      ".github/workflows/context-hygiene.yml",
      "README.md",
      "bun.lock",
      "package.json",
      "project.v1.yaml",
    ],
  },
  {
    name: "personal-knowledge-workspace-9",
    repository: "libre-ai/personal-knowledge-workspace",
    from: N,
    pinFiles: [
      ".github/workflows/code-validation.yml",
      ".github/workflows/notebook-webkit-macos.yml",
      "project.v1.yaml",
    ],
  },
  {
    name: "product-research-6",
    repository: "libre-ai/product-research",
    from: M,
    pinFiles: [".github/workflows/licensing.yml", "toolchains/github-actions.json"],
  },
  {
    name: "schemas-and-contracts-13",
    repository: "libre-ai/schemas-and-contracts",
    from: M,
    pinFiles: [
      ".github/workflows/ci.yml",
      ".github/workflows/code-validation.yml",
      "project.v1.yaml",
    ],
  },
  {
    name: "pi-evidence-11",
    repository: "libre-ai/pi-evidence",
    from: M,
    pinFiles: [
      ".github/workflows/context-hygiene.yml",
      ".github/workflows/licensing.yml",
      "project.v1.yaml",
    ],
  },
  {
    name: "carriere-13",
    repository: "libre-ai/carriere",
    from: M,
    pinFiles: [".github/workflows/context-hygiene.yml", ".github/workflows/licensing.yml"],
  },
  {
    name: "project-website-8",
    repository: "libre-ai/project-website",
    from: N,
    pinFiles: [".github/workflows/code-validation.yml"],
  },
  {
    name: "application-development-toolkit-9",
    repository: "libre-ai/application-development-toolkit",
    from: M,
    pinFiles: [".github/workflows/code-validation.yml", "project.v1.yaml"],
  },
];

describe("the plan reproduces the merged P-wave pull requests byte for byte", () => {
  for (const bump of PURE_BUMPS) {
    test(bump.name, () => {
      const before = fixture(bump.name, "before");
      const after = fixture(bump.name, "after");
      const result = plan(bump.repository, before);
      expect(result.refusals).toEqual([]);
      expect(result.status).toBe("bump");
      expect(result.from).toBe(bump.from);
      expect([...editedFiles(result).keys()].sort()).toEqual([...bump.pinFiles].sort());
      for (const [path, text] of editedFiles(result)) {
        expect({ path, text }).toEqual({ path, text: after.get(path) as string });
      }
      // Every fixture file the pull request did not change is left untouched.
      for (const [path, text] of before) {
        if (!bump.pinFiles.includes(path)) expect(after.get(path)).toBe(text);
      }
    });
  }

  test("signalement: the seven-character lock key, its tarball name and the integrity move together", () => {
    const result = plan("libre-ai/signalement", fixture("signalement-12", "before"));
    const lock = result.edits.find((edit) => edit.path === "bun.lock") as { after: string };
    expect(lock.after).toContain(`#${P.slice(0, 7)}"`);
    expect(lock.after).toContain(`libre-ai-project-governance-${P.slice(0, 7)}"`);
    expect(lock.after).toContain(P_INTEGRITY);
    expect(lock.after).not.toContain(M.slice(0, 7));
    expect(result.sites.map((site) => site.form).sort()).toEqual([
      "card-pin-bare",
      "git-dep",
      "git-dep",
      "governance-url",
      "governance-url",
      "governance-url",
      "lock-resolution",
      "tooling_ref",
      "uses",
      "uses",
    ]);
  });

  test("application-development-toolkit: the historical diagnostic pin is left, with its reason", () => {
    const result = plan(
      "libre-ai/application-development-toolkit",
      fixture("application-development-toolkit-9", "before"),
    );
    expect(result.left).toEqual([
      {
        path: ".github/workflows/playwright-guid-diagnostic.yml",
        line: 35,
        reason: "historical site: replays the tooling of the run it investigates",
      },
    ]);
    expect(editedFiles(result).has(".github/workflows/playwright-guid-diagnostic.yml")).toBe(false);
  });

  // execution-sandbox#7 bundled the bump with converting its contract types
  // from a sibling path to a git rev. The tool owns the bump half only: every
  // line it writes is a line the pull request wrote, and every other line the
  // pull request wrote carries no governance generation.
  test("execution-sandbox-7: the pin half of a mixed pull request, and nothing more", () => {
    const before = fixture("execution-sandbox-7", "before");
    const after = fixture("execution-sandbox-7", "after");
    const result = plan("libre-ai/execution-sandbox", before);
    expect(result.status).toBe("bump");
    const edited = editedFiles(result);
    expect([...edited.keys()].sort()).toEqual([
      ".github/workflows/code-validation.yml",
      "project.v1.yaml",
    ]);
    expect(edited.get(".github/workflows/code-validation.yml")).toBe(
      after.get(".github/workflows/code-validation.yml") as string,
    );
    const lines = (text: string): Set<string> => new Set(text.split("\n"));
    const beforeLines = lines(before.get("project.v1.yaml") as string);
    const written = [...lines(edited.get("project.v1.yaml") as string)].filter(
      (l) => !beforeLines.has(l),
    );
    const merged = [...lines(after.get("project.v1.yaml") as string)].filter(
      (l) => !beforeLines.has(l),
    );
    expect(written).toEqual([`    pinned: "github:libre-ai/project-governance#${P}"`]);
    for (const line of written) expect(merged).toContain(line);
    for (const line of merged.filter((l) => !written.includes(l))) {
      expect(line).not.toContain(P);
      expect(line).not.toContain(M);
    }
  });

  test("a repository already on the target is up to date and edits nothing", () => {
    const result = plan("libre-ai/signalement", fixture("signalement-12", "after"));
    expect(result.status).toBe("up-to-date");
    expect(result.edits).toEqual([]);
  });

  test("the plan is idempotent: re-planning its own output finds the target", () => {
    const first = plan("libre-ai/pi-evidence", fixture("pi-evidence-11", "before"));
    const files = new Map(fixture("pi-evidence-11", "before"));
    for (const edit of first.edits) files.set(edit.path, edit.after);
    expect(plan("libre-ai/pi-evidence", files).status).toBe("up-to-date");
  });
});

describe("Cargo sources coupled to the composition", () => {
  const coupled = (): Map<string, string> => {
    const files = new Map(fixture("execution-sandbox-7", "after"));
    // The merged state carries P; re-pin it on M so the bump is M -> P.
    for (const [path, text] of files) files.set(path, text.split(P).join(M));
    return files;
  };
  const manifestWith = (repository: string, ref: string): string => {
    const manifest = JSON.parse(governance(P, "manifest.json")) as {
      repositories: Record<string, { ref: string }>;
    };
    (manifest.repositories[repository] as { ref: string }).ref = ref;
    return JSON.stringify(manifest);
  };

  test("a rev whose composed ref is the same at both generations is left with its reason", () => {
    const result = plan("libre-ai/execution-sandbox", coupled());
    expect(result.status).toBe("bump");
    expect(result.left).toEqual([
      {
        path: "Cargo.toml",
        line: null,
        reason:
          "dependencies.libre-ai-contract-types rev 4f3d53c3: libre-ai/schemas-and-contracts is composed at the same ref by both generations",
      },
    ]);
    expect(editedFiles(result).has("Cargo.toml")).toBe(false);
  });

  test("a rev whose composed ref moves is refused: not a pin edit", () => {
    const moved = "0123456789abcdef0123456789abcdef01234567";
    const result = plan("libre-ai/execution-sandbox", coupled(), {
      composition: new Map([
        [M, governance(M, "manifest.json")],
        [P, manifestWith("schemas-and-contracts", moved)],
      ]),
    });
    expect(result.status).toBe("refused");
    expect(result.edits).toEqual([]);
    expect(result.refusals.join("\n")).toContain(
      "is coupled to the composed ref of libre-ai/schemas-and-contracts, which moves to 01234567",
    );
  });

  test("a rev that already drifts from the old generation's composed ref is refused", () => {
    const files = coupled();
    files.set(
      "Cargo.toml",
      (files.get("Cargo.toml") as string).replace(
        "4f3d53c3ecd96e7064057afd1587de41b66f13c1",
        "fedcba9876543210fedcba9876543210fedcba98",
      ),
    );
    const result = plan("libre-ai/execution-sandbox", files);
    expect(result.status).toBe("refused");
    expect(result.refusals.join("\n")).toContain("the repository already drifts");
  });

  test("an unreadable composition manifest leaves the coupling unverified, which is a refusal", () => {
    const result = plan("libre-ai/execution-sandbox", coupled(), {
      composition: new Map([[M, governance(M, "manifest.json")]]),
    });
    expect(result.status).toBe("refused");
    expect(result.refusals.join("\n")).toContain(
      "could not be read, so its coupling is unverified",
    );
  });
});

describe("refusals: a doubt is never a partial edit", () => {
  const workflow = (lines: string[]): Map<string, string> =>
    new Map([[".github/workflows/ci.yml", `${lines.join("\n")}\n`]]);
  const uses = (sha: string) =>
    `    uses: libre-ai/project-governance/.github/workflows/reusable-licensing.yml@${sha}`;

  test("surfaces that disagree", () => {
    const result = plan("libre-ai/x", workflow([uses(M), `      tooling_ref: ${N}`]));
    expect(result.status).toBe("refused");
    expect(result.refusals[0]).toMatch(/^surfaces disagree — 46061644 at .*; 7c2238d6 at /);
  });

  test("a historical sha is exempted only on its own repository and path", () => {
    const files = workflow([uses(M), `      tooling_ref: ${M}`]);
    files.set(
      ".github/workflows/other.yml",
      `    with:\n      repository: libre-ai/project-governance\n      ref: ${ADT_HISTORICAL}\n`,
    );
    const result = plan("libre-ai/application-development-toolkit", files);
    expect(result.status).toBe("refused");
    expect(result.refusals[0]).toContain("surfaces disagree");
  });

  test("an occurrence of the old generation on no recognised surface", () => {
    const files = workflow([uses(M), `      tooling_ref: ${M}`]);
    files.set("README.md", `Pinned to \`${M}\` for now.\n`);
    const result = plan("libre-ai/x", files);
    expect(result.status).toBe("refused");
    expect(result.refusals).toEqual(["README.md:1 carries 7c2238d6 on no recognised pin surface"]);
  });

  test("a seven-character prefix in a workflow comment is counted too", () => {
    const result = plan("libre-ai/x", workflow([`# generation ${M.slice(0, 7)}`, uses(M)]));
    expect(result.refusals).toEqual([
      `.github/workflows/ci.yml:1 carries ${M.slice(0, 7)} on no recognised pin surface`,
    ]);
  });

  test("the eight-character prefix in README prose is a surface and moves", () => {
    const files = workflow([uses(M)]);
    files.set("README.md", `Generation ${M.slice(0, 8)} (M) is current.\n`);
    const result = plan("libre-ai/x", files);
    expect(result.status).toBe("bump");
    expect(editedFiles(result).get("README.md")).toBe(
      `Generation ${P.slice(0, 8)} (M) is current.\n`,
    );
  });

  test("the retired authority", () => {
    const result = plan(
      "libre-ai/x",
      workflow([`    uses: libre-ai/governance/.github/workflows/reusable-licensing.yml@${M}`]),
    );
    expect(result.status).toBe("refused");
    expect(result.refusals).toEqual([
      ".github/workflows/ci.yml:1 pins the retired authority libre-ai/governance",
    ]);
  });

  test("a moving ref", () => {
    const result = plan("libre-ai/x", workflow([uses("main")]));
    expect(result.refusals).toContain(
      ".github/workflows/ci.yml:1 uses is main — not a 40-character commit sha",
    );
  });

  test("a checkout of another repository is not a governance surface", () => {
    const files = workflow([
      uses(M),
      "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "        with:",
      "          repository: libre-ai/schemas-and-contracts",
      `          ref: ${N}`,
    ]);
    const result = plan("libre-ai/x", files);
    expect(result.status).toBe("bump");
    expect(editedFiles(result).get(".github/workflows/ci.yml")).toContain(`ref: ${N}`);
  });

  test("a bare card pin of another dependency is not a governance surface", () => {
    const card = [
      "dependencies:",
      "  - on: libre-ai/project-governance",
      `    pinned: "${M}"`,
      "  - on: libre-ai/schemas-and-contracts",
      `    pinned: "${N}"`,
      "",
    ].join("\n");
    const result = plan("libre-ai/x", new Map([["project.v1.yaml", card]]));
    expect(result.status).toBe("bump");
    expect(editedFiles(result).get("project.v1.yaml")).toBe(card.replace(M, P));
  });

  test("a bun.lock resolution whose recorded dependencies the target changes", () => {
    const manifest = JSON.parse(governance(P, "package.json")) as { dependencies: object };
    const result = plan("libre-ai/signalement", fixture("signalement-12", "before"), {
      targetManifest: JSON.stringify({ ...manifest, dependencies: { ajv: "9.0.0" } }),
    });
    expect(result.status).toBe("refused");
    expect(result.refusals.join("\n")).toContain("run bun install, not a pin edit");
  });

  test("a bun.lock resolution without a computed integrity", () => {
    const result = plan("libre-ai/signalement", fixture("signalement-12", "before"), {
      targetIntegrity: null,
    });
    expect(result.status).toBe("refused");
    expect(result.refusals.join("\n")).toContain(
      "integrity of the target tarball could not be computed",
    );
  });

  test("an evidence URL whose cited path does not exist at the target", () => {
    const result = plan("libre-ai/signalement", fixture("signalement-12", "before"), {
      targetPaths: new Set(),
    });
    expect(result.status).toBe("refused");
    expect(result.refusals).toHaveLength(3);
    expect(result.refusals[0]).toContain(`cites ${ATTESTATION}, which does not exist at 1c8b37c8`);
  });

  test("a target that is not a full sha", () => {
    const result = plan("libre-ai/x", workflow([uses(M)]), { target: "1c8b37c8" });
    expect(result.status).toBe("refused");
  });

  test("a repository with no surface is reported as such, not as a bump", () => {
    const result = plan("libre-ai/.github", new Map([["README.md", "Profile.\n"]]));
    expect(result.status).toBe("no-surface");
    expect(result.edits).toEqual([]);
  });

  test("an undeclared old generation is a note, not a refusal", () => {
    const result = plan("libre-ai/x", workflow([uses(M)]), { generations: [N, P] });
    expect(result.status).toBe("bump");
    expect(result.notes).toEqual(["carries 7c2238d6, which fleet-pins.v1.yaml does not declare"]);
  });

  test("line endings are preserved byte for byte", () => {
    const files = new Map([
      [".github/workflows/ci.yml", `${uses(M)}\r\n      tooling_ref: ${M}\r\n`],
    ]);
    const result = plan("libre-ai/x", files);
    expect(editedFiles(result).get(".github/workflows/ci.yml")).toBe(
      `${uses(P)}\r\n      tooling_ref: ${P}\r\n`,
    );
  });
});

describe("surface rules", () => {
  test("a commented uses line is not a pin", () => {
    expect(
      fileSites(
        ".github/workflows/ci.yml",
        `#   uses: libre-ai/project-governance/.github/workflows/x.yml@${M}\n`,
      ).sites,
    ).toEqual([]);
  });

  test("toolchain allow-list entries are read on any repository", () => {
    expect(
      fileSites(
        "toolchains/github-actions.json",
        `["libre-ai/project-governance/.github/workflows/reusable-licensing.yml@${M}"]`,
      ).sites,
    ).toEqual([
      { path: "toolchains/github-actions.json", line: 1, form: "allowed-pattern", ref: M },
    ]);
  });

  test("citedPaths lists every governance URL target once", () => {
    const files = fixture("signalement-12", "before");
    const snapshot: Snapshot = { repository: "libre-ai/signalement", files };
    expect(citedPaths([scanSnapshot(snapshot, [])])).toEqual([ATTESTATION]);
  });
});
