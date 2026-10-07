import { describe, expect, test } from "bun:test";
import {
  buildOrgRepositoriesQuery,
  type DeclaredRepository,
  type LiveRepository,
  parseOrgRepositoriesPage,
  reconcileInventory,
} from "./check-inventory-drift";

// The reconciliation is fail-closed in both directions except one deliberate
// case: a declared-private repository invisible to the token is consistent
// (the default CI token cannot list private repositories), so it must produce
// a note, never a drift — otherwise every public CI run would false-positive.

const declared = (...entries: [string, DeclaredRepository["visibility"]][]): DeclaredRepository[] =>
  entries.map(([name, visibility]) => ({ name, visibility }));

const live = (...entries: [string, boolean][]): LiveRepository[] =>
  entries.map(([name, isPrivate]) => ({ name, isPrivate }));

describe("reconcileInventory", () => {
  test("a matching inventory produces no drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["tool", "public"]),
      live(["hub", false], ["tool", false]),
    );
    expect(result.drifts).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  test("an observable repository absent from the inventory is drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"]),
      live(["hub", false], ["rogue", false]),
    );
    expect(result.drifts).toEqual([
      "DRIFT: repository 'rogue' is observable on GitHub but absent from the inventory",
    ]);
  });

  test("a declared public repository that is not observable is drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["ghost", "public"]),
      live(["hub", false]),
    );
    expect(result.drifts).toEqual([
      "DRIFT: inventory declares 'ghost' public but it is not observable (deleted, renamed, or made private)",
    ]);
  });

  test("a visibility mismatch is drift in both directions", () => {
    const leaked = reconcileInventory(declared(["secret", "private"]), live(["secret", false]));
    expect(leaked.drifts).toEqual([
      "DRIFT: repository 'secret' declared private but observable as public",
    ]);
    const hidden = reconcileInventory(declared(["hub", "public"]), live(["hub", true]));
    expect(hidden.drifts).toEqual([
      "DRIFT: repository 'hub' declared public but observable as private",
    ]);
  });

  test("a declared private repository invisible to the token is a note, not drift", () => {
    const result = reconcileInventory(
      declared(["hub", "public"], ["secret", "private"]),
      live(["hub", false]),
    );
    expect(result.drifts).toEqual([]);
    expect(result.notes).toEqual([
      "NOTE: 'secret' declared private and not observable with this token — consistent, unverifiable here",
    ]);
  });

  test("a renamed repository surfaces as drift on both names", () => {
    const result = reconcileInventory(declared(["old-name", "public"]), live(["new-name", false]));
    expect(result.drifts).toEqual([
      "DRIFT: repository 'new-name' is observable on GitHub but absent from the inventory",
      "DRIFT: inventory declares 'old-name' public but it is not observable (deleted, renamed, or made private)",
    ]);
  });
});

describe("buildOrgRepositoriesQuery", () => {
  test("omits the after argument on the first page", () => {
    const query = buildOrgRepositoriesQuery("libre-ai", null);
    expect(query).toContain('organization(login: "libre-ai")');
    expect(query).toContain("repositories(first: 100)");
    expect(query).not.toContain("after:");
  });

  test("carries the cursor for a subsequent page", () => {
    const query = buildOrgRepositoriesQuery("libre-ai", "cursor-abc");
    expect(query).toContain('repositories(first: 100, after: "cursor-abc")');
  });
});

describe("parseOrgRepositoriesPage", () => {
  test("reads nodes and pagination info from a well-formed page", () => {
    const page = parseOrgRepositoriesPage({
      organization: {
        repositories: {
          pageInfo: { hasNextPage: true, endCursor: "next" },
          nodes: [{ name: "governance", isPrivate: false }],
        },
      },
    });
    expect(page).toEqual({
      nodes: [{ name: "governance", isPrivate: false }],
      hasNextPage: true,
      endCursor: "next",
    });
  });

  test("returns null when the response lacks the expected shape, distinct from a real empty page", () => {
    expect(parseOrgRepositoriesPage({ organization: null })).toBeNull();
    expect(parseOrgRepositoriesPage({})).toBeNull();
  });

  test("reads a real empty last page as zero repositories, not null", () => {
    const page = parseOrgRepositoriesPage({
      organization: {
        repositories: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
      },
    });
    expect(page).toEqual({ nodes: [], hasNextPage: false, endCursor: null });
  });

  test("drops a malformed node instead of throwing", () => {
    const page = parseOrgRepositoriesPage({
      organization: {
        repositories: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ name: "ok", isPrivate: true }, null, { name: "bad" }],
        },
      },
    });
    expect(page?.nodes).toEqual([{ name: "ok", isPrivate: true }]);
  });
});
