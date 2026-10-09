import { describe, expect, test } from "bun:test";
import { DEFAULT_BRANCH_NAMES } from "../../../tools/quality/check-resolved-refs";
import { PUBLIC_SURFACES, publicRawUrl } from "./cold-reader";

const RAW_PREFIX = "https://raw.githubusercontent.com/";

/** The ref segment of a raw URL: owner/repository/<ref>/path. */
function refSegment(url: string): string {
  expect(url.startsWith(RAW_PREFIX)).toBe(true);
  const segments = url.slice(RAW_PREFIX.length).split("/");
  const ref = segments[2];
  if (ref === undefined) {
    throw new Error(`raw URL without a ref segment: ${url}`);
  }
  return ref;
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
      const ref = refSegment(surface.url);
      expect(ref).toBe("HEAD");
      expect(DEFAULT_BRANCH_NAMES as readonly string[]).not.toContain(ref);
    }
  });
});
