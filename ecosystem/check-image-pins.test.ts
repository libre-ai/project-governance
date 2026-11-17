import { describe, expect, test } from "bun:test";
import {
  BUILD_FILE,
  COMPOSE_FILE,
  classifyImage,
  containerFileKind,
  emptyTally,
  fleetVerdict,
  IMAGE_DIGEST,
  type ImagePinTally,
  isContainerDefinition,
  reviewRepository,
  scanBuildFile,
  scanComposeFile,
  summarizeVolume,
} from "./check-image-pins";
import type { BlobRead, FleetFileReader, TreeListing } from "./fleet-tree";

const DIGEST = `sha256:${"a1".repeat(32)}`;

function kinds(text: string, scan = scanBuildFile): string[] {
  return scan(text).references.map((r) => `${r.reference} ${r.kind}`);
}

describe("path patterns", () => {
  test("are the two patterns check-dependabot-conformance.ts recognises, byte for byte", async () => {
    const source = await Bun.file(
      new URL("./check-dependabot-conformance.ts", import.meta.url),
    ).text();
    expect(source).toContain(`["docker", ${BUILD_FILE.toString()}],`);
    expect(source).toContain(`["docker-compose", ${COMPOSE_FILE.toString()}],`);
  });

  test.each([
    ["Dockerfile", "build"],
    ["Dockerfile.dev", "build"],
    ["services/api/api.Dockerfile", "build"],
    ["deploy/Containerfile", "build"],
    ["compose.yaml", "compose"],
    ["a/b/docker-compose.prod.yml", "compose"],
    ["README.md", null],
    [".github/workflows/ci.yml", null],
  ])("%s is %p", (path, kind) => {
    expect(containerFileKind(path)).toBe(kind as ReturnType<typeof containerFileKind>);
    expect(isContainerDefinition(path)).toBe(kind !== null);
  });
});

describe("classifyImage", () => {
  test.each([
    [`debian:12@${DIGEST}`, "pinned"],
    [`debian@${DIGEST}`, "pinned"],
    ["debian:12", "unpinned"],
    ["debian", "unpinned"],
    [`debian@${DIGEST.slice(0, -1)}`, "unpinned"],
    [`debian@${DIGEST.toUpperCase()}`, "unpinned"],
    [`debian@${DIGEST} trailing`, "unpinned"],
    [`\${BASE}@${DIGEST}`, "unpinned"],
  ])("%s is %s", (reference, kind) => {
    expect(classifyImage(reference)).toBe(kind as ReturnType<typeof classifyImage>);
  });

  test("the digest rule is anchored at the end of the reference", () => {
    expect(IMAGE_DIGEST.source).toBe("@sha256:[0-9a-f]{64}$");
  });
});

describe("scanBuildFile", () => {
  test("a tag alone is unpinned, on its line", () => {
    expect(scanBuildFile("FROM debian:12\n")).toEqual({
      references: [{ line: 1, reference: "debian:12", kind: "unpinned" }],
      unreadable: null,
    });
  });

  test("a variable is unpinned, even when an ARG above carries a digest", () => {
    const text = `ARG BASE=debian@${DIGEST}\nFROM \${BASE}\n`;
    expect(scanBuildFile(text).references).toEqual([
      { line: 2, reference: `\${BASE}`, kind: "unpinned" },
    ]);
  });

  test("stages declared above, by name or by index, are not images", () => {
    const text = [
      `FROM a@${DIGEST} AS build`,
      "FROM build",
      "COPY --from=build /out /out",
      "COPY --from=0 /etc/x /etc/x",
      "",
    ].join("\n");
    expect(kinds(text)).toEqual([`a@${DIGEST} pinned`, "build stage", "build stage", "0 stage"]);
  });

  test("a stage named before its declaration, or an index that is not earlier, is unpinned", () => {
    const text = [
      `FROM a@${DIGEST}`,
      "COPY --from=later /x /x",
      "COPY --from=0 /x /x",
      `FROM a@${DIGEST} AS later`,
      "",
    ].join("\n");
    expect(scanBuildFile(text).references.slice(1, 3)).toEqual([
      { line: 2, reference: "later", kind: "unpinned" },
      { line: 3, reference: "0", kind: "unpinned" },
    ]);
  });

  test("--platform and AS are set aside", () => {
    expect(kinds("FROM --platform=linux/amd64 img:1 AS x\n")).toEqual(["img:1 unpinned"]);
  });

  test("instructions are case-insensitive and a backslash continues the line", () => {
    const text = [
      `from a@${DIGEST} as Build`,
      "copy \\",
      "  # a comment inside the continuation",
      "  --chown=1:1 --from=BUILD \\",
      "  /out /out",
      "FROM \\",
      "  img:2",
      "",
    ].join("\n");
    expect(scanBuildFile(text).references).toEqual([
      { line: 1, reference: `a@${DIGEST}`, kind: "pinned" },
      { line: 2, reference: "BUILD", kind: "stage" },
      { line: 6, reference: "img:2", kind: "unpinned" },
    ]);
  });

  test("scratch is counted apart and a commented FROM is not a reference", () => {
    expect(kinds("# FROM debian:12\nFROM scratch\n")).toEqual(["scratch scratch"]);
  });

  test("a COPY without --from names no image", () => {
    expect(kinds("FROM scratch\nCOPY --chown=1:1 a b\nCOPY a --from=img:1\n")).toEqual([
      "scratch scratch",
    ]);
  });

  test("a build file without FROM is unreadable", () => {
    expect(scanBuildFile("# nothing here\nRUN true\n").unreadable).toContain("no FROM");
  });
});

describe("scanComposeFile", () => {
  test("image values, quotes and comments stripped, with their lines", () => {
    const text = [
      "services:",
      "  db:",
      "    image: postgres:17 # the database",
      "  app:",
      `    image: "registre/app:\${TAG}"`,
      "  cache:",
      `    image: redis@${DIGEST}`,
      "",
    ].join("\n");
    expect(scanComposeFile(text)).toEqual({
      references: [
        { line: 3, reference: "postgres:17", kind: "unpinned" },
        { line: 5, reference: `registre/app:\${TAG}`, kind: "unpinned" },
        { line: 7, reference: `redis@${DIGEST}`, kind: "pinned" },
      ],
      unreadable: null,
    });
  });

  test("a flow-mapping image escapes the line scanner, so the file is unreadable", () => {
    const scan = scanComposeFile("services:\n  db: { image: postgres }\n");
    expect(scan.unreadable).toContain("one reader is blind");
  });

  test("invalid YAML is unreadable, without quoting the file", () => {
    expect(scanComposeFile("services: [\n").unreadable).toBe("YAML parse failed");
  });

  test("services that only build carry no reference", () => {
    expect(scanComposeFile("services:\n  app:\n    build: .\n")).toEqual({
      references: [],
      unreadable: null,
    });
  });
});

function reader(listing: TreeListing, files: Record<string, BlobRead>): FleetFileReader {
  return async () => ({ listing, files: new Map(Object.entries(files)) });
}

const refusing: FleetFileReader = async () => {
  throw new Error("the reader must not be called for an exempt entry");
};

const active = {
  repository: "libre-ai/sample",
  role: "satellite",
  layer: "couche-1",
  lifecycle: "active",
  visibility: "public" as const,
};

describe("reviewRepository", () => {
  test("red: an unpinned FROM fails with its line and nothing but the reference", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      reader(
        { kind: "listed", paths: ["Dockerfile", "README.md"] },
        { Dockerfile: { kind: "text", text: "FROM debian:12\nRUN echo secret-looking-content\n" } },
      ),
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]?.item).toBe("libre-ai/sample:Dockerfile");
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.note).toStartWith("line 1: `debian:12` is not pinned by digest");
    expect(checks[0]?.note).not.toContain("secret-looking-content");
    expect(tally).toMatchObject({ filesTracked: 1, filesExamined: 1, pinned: 0, unpinned: 1 });
  });

  test("green: build and compose files, every kind counted once", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      reader(
        { kind: "listed", paths: ["Dockerfile", "deploy/compose.yaml"] },
        {
          Dockerfile: {
            kind: "text",
            text: `FROM a@${DIGEST} AS build\nFROM scratch\nCOPY --from=build /o /o\n`,
          },
          "deploy/compose.yaml": {
            kind: "text",
            text: `services:\n  db:\n    image: postgres:17@${DIGEST}\n`,
          },
        },
      ),
    );
    expect(checks.map((check) => check.ok)).toEqual([true, true]);
    expect(tally).toEqual({
      repositories: 1,
      exempt: 0,
      filesTracked: 2,
      filesExamined: 2,
      pinned: 2,
      unpinned: 0,
      stage: 1,
      scratch: 1,
    });
  });

  test("a reference is printed without control characters and bounded", async () => {
    const hostile = `img:\u{1b}[31m${"x".repeat(300)}`;
    const checks = await reviewRepository(
      active,
      emptyTally(),
      reader(
        { kind: "listed", paths: ["Dockerfile"] },
        { Dockerfile: { kind: "text", text: `FROM ${hostile}\n` } },
      ),
    );
    expect(checks[0]?.note).toStartWith(`line 1: \`img:?[31m${"x".repeat(191)}\` is not pinned`);
  });

  test("a build file without FROM fails and is not counted as examined", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      reader(
        { kind: "listed", paths: ["Dockerfile"] },
        { Dockerfile: { kind: "text", text: "RUN true\n" } },
      ),
    );
    expect(checks[0]?.ok).toBe(false);
    expect(tally).toMatchObject({ filesTracked: 1, filesExamined: 0 });
  });

  test("a compose file whose readers diverge fails and counts no reference", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      reader(
        { kind: "listed", paths: ["compose.yml"] },
        { "compose.yml": { kind: "text", text: "services:\n  db: { image: postgres }\n" } },
      ),
    );
    expect(checks[0]?.ok).toBe(false);
    expect(tally).toMatchObject({ filesTracked: 1, filesExamined: 0, pinned: 0, unpinned: 0 });
  });

  test("an unreadable tree fails, as one item named after the repository", async () => {
    const checks = await reviewRepository(
      active,
      emptyTally(),
      reader({ kind: "unreadable", reason: "HTTP 502" }, {}),
    );
    expect(checks).toEqual([
      { item: "libre-ai/sample", ok: false, note: "tree unreadable at HEAD: HTTP 502" },
    ]);
  });

  test("an unreadable blob fails and is not counted as examined", async () => {
    const tally = emptyTally();
    const checks = await reviewRepository(
      active,
      tally,
      reader(
        { kind: "listed", paths: ["Dockerfile"] },
        { Dockerfile: { kind: "unreadable", reason: "truncated" } },
      ),
    );
    expect(checks[0]?.ok).toBe(false);
    expect(tally).toMatchObject({ filesTracked: 1, filesExamined: 0 });
  });

  test.each([
    [{ ...active, visibility: "private" as const }],
    [{ ...active, lifecycle: "archived" }],
  ])("an exempt entry is counted and never read (%#)", async (entry) => {
    const tally = emptyTally();
    const checks = await reviewRepository(entry, tally, refusing);
    expect(checks).toHaveLength(1);
    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.note).toStartWith("exempt: ");
    expect(tally).toMatchObject({ repositories: 0, exempt: 1 });
  });

  test("a repository without container file is a named green", async () => {
    const checks = await reviewRepository(
      active,
      emptyTally(),
      reader({ kind: "listed", paths: ["README.md"] }, {}),
    );
    expect(checks).toEqual([
      { item: "libre-ai/sample", ok: true, note: "no container definition tracked" },
    ]);
  });
});

describe("fleetVerdict", () => {
  test("zero image reference examined is a failure", () => {
    const verdict = fleetVerdict({ ...emptyTally(), repositories: 4, stage: 2, scratch: 1 });
    expect(verdict.item).toBe("fleet");
    expect(verdict.ok).toBe(false);
  });

  test("one pinned reference is enough", () => {
    expect(fleetVerdict({ ...emptyTally(), pinned: 1 }).ok).toBe(true);
  });

  test("one unpinned reference is examined too", () => {
    expect(fleetVerdict({ ...emptyTally(), unpinned: 1 }).ok).toBe(true);
  });
});

describe("summarizeVolume", () => {
  const mixed: ImagePinTally = {
    repositories: 3,
    exempt: 2,
    filesTracked: 5,
    filesExamined: 4,
    pinned: 2,
    unpinned: 1,
    stage: 3,
    scratch: 1,
  };

  test("the volume line, word for word", () => {
    expect(summarizeVolume(mixed)).toBe(
      "5 inventory entries (3 read, 2 exempt): 4 of 5 tracked container file(s) examined, 3 image reference(s) = 2 pinned by digest + 1 unpinned; 3 stage reference(s), 1 scratch",
    );
  });

  test("its counters sum: N = R + E and I = P + U", () => {
    const numbers = (summarizeVolume(mixed).match(/\d+/g) ?? []).map(Number);
    const [entries, read, exempt, , , images, pinned, unpinned] = numbers;
    expect(entries).toBe((read ?? Number.NaN) + (exempt ?? Number.NaN));
    expect(images).toBe((pinned ?? Number.NaN) + (unpinned ?? Number.NaN));
  });
});
