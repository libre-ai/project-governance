import { describe, expect, test } from "bun:test";
import { buildIndex, INVENTORY_SOURCE } from "../../../ecosystem/build-index";
import { DEFAULT_BRANCH_NAMES } from "../../../tools/quality/check-resolved-refs";
import { PUBLIC_SURFACES, publicRawUrl } from "./cold-reader";
import { parseQuestionnaire } from "./grading";
import questionnaireJson from "./questionnaire.json";

const RAW_PREFIX = "https://raw.githubusercontent.com/";

/** The segments of a raw URL: owner/repository/<ref>/path. */
function rawSegments(url: string): { repository: string; ref: string } {
  expect(url.startsWith(RAW_PREFIX)).toBe(true);
  const [owner, name, ref] = url.slice(RAW_PREFIX.length).split("/");
  if (owner === undefined || name === undefined || ref === undefined) {
    throw new Error(`raw URL without owner/repository/ref segments: ${url}`);
  }
  return { repository: `${owner}/${name}`, ref };
}

describe("cold-reader public surfaces resolve the served branch", () => {
  test("publicRawUrl asks raw for HEAD, the repository's served branch", () => {
    expect(publicRawUrl("libre-ai/.github", "profile/README.md")).toBe(
      "https://raw.githubusercontent.com/libre-ai/.github/HEAD/profile/README.md",
    );
  });

  test("every surface is read on HEAD, never on a written default-branch name", () => {
    expect(PUBLIC_SURFACES.length).toBeGreaterThan(0);
    for (const surface of PUBLIC_SURFACES) {
      const { ref } = rawSegments(surface.url);
      expect(ref).toBe("HEAD");
      expect(DEFAULT_BRANCH_NAMES as readonly string[]).not.toContain(ref);
    }
  });
});

describe("cold-reader public surfaces are live repositories", () => {
  // The lifecycle is READ from the inventory, never written here: the day a
  // surface's repository is archived, this test turns red without anyone
  // having to remember that the cold reader reads it.
  test("no surface points at a repository the inventory does not declare active", async () => {
    const index = buildIndex(
      await Bun.file(new URL(`../../../${INVENTORY_SOURCE}`, import.meta.url)).text(),
    );
    const lifecycleOf = new Map(
      index.repositories.map((entry) => [entry.repository, entry.lifecycle]),
    );
    expect(PUBLIC_SURFACES.length).toBeGreaterThan(0);
    for (const surface of PUBLIC_SURFACES) {
      const { repository } = rawSegments(surface.url);
      // An undeclared repository is refused too: its lifecycle is unknown.
      expect({ surface: surface.id, repository, lifecycle: lifecycleOf.get(repository) }).toEqual({
        surface: surface.id,
        repository,
        lifecycle: "active",
      });
    }
  });
});

describe("the grid is sourced by what the cold reader reads", () => {
  test("every expected element cites one of the surfaces the reader is given", () => {
    // A source the reader never sees would grade the reader on a document it
    // could not have read.
    const surfaceUrls = new Set(PUBLIC_SURFACES.map((surface) => surface.url));
    const questionnaire = parseQuestionnaire(JSON.stringify(questionnaireJson));
    let cited = 0;
    for (const item of questionnaire.items) {
      for (const element of item.expectedElements) {
        expect({
          element: element.id,
          source: element.source,
          read: surfaceUrls.has(element.source),
        }).toEqual({ element: element.id, source: element.source, read: true });
        expect(rawSegments(element.source).ref).toBe("HEAD");
        cited += 1;
      }
    }
    expect(cited).toBeGreaterThan(0);
  });
});
