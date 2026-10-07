import { describe, expect, test } from "bun:test";
import { buildIndex, isPublicCrossRepositoryTarget, renderIndex } from "./build-index";

// The index is a published machine artefact: its exact byte format is locked
// by a golden fixture, and the committed real index must always match a fresh
// regeneration — so `bun test` alone catches inventory/index drift.

const fixtureUrl = new URL("fixtures/repository-index/input.yaml", import.meta.url);
const goldenUrl = new URL("fixtures/repository-index/expected.json", import.meta.url);
const inventoryUrl = new URL("repositories.v1.yaml", import.meta.url);
const committedIndexUrl = new URL("../distribution/index/repositories.v1.json", import.meta.url);

describe("buildIndex", () => {
  test("renders the golden fixture byte-for-byte", async () => {
    const rendered = renderIndex(buildIndex(await Bun.file(fixtureUrl).text()));
    expect(rendered).toBe(await Bun.file(goldenUrl).text());
  });

  test("sorts repositories by name regardless of source order", async () => {
    const index = buildIndex(await Bun.file(fixtureUrl).text());
    expect(index.repositories.map((entry) => entry.repository)).toEqual([
      "libre-ai/alpha-hub",
      "libre-ai/product-research",
      "libre-ai/zeta-product",
    ]);
  });

  test("is deterministic across runs", async () => {
    const text = await Bun.file(fixtureUrl).text();
    expect(renderIndex(buildIndex(text))).toBe(renderIndex(buildIndex(text)));
  });

  test("omits optional fields when the source has none", async () => {
    const index = buildIndex(await Bun.file(fixtureUrl).text());
    const hub = index.repositories.find((entry) => entry.repository === "libre-ai/alpha-hub");
    expect(hub).toBeDefined();
    expect(hub?.card).toBeUndefined();
    expect(hub?.canonical_paths).toBeUndefined();
  });

  test("carries the card pointer when the source declares one", async () => {
    const index = buildIndex(await Bun.file(fixtureUrl).text());
    const zeta = index.repositories.find((entry) => entry.repository === "libre-ai/zeta-product");
    expect(zeta?.card).toBe("project.v1.yaml");
  });

  test("rejects a duplicate repository entry", () => {
    const yaml = [
      "schema_version: v",
      "updated_on: 2026-07-24",
      "repositories:",
      "  - { repository: libre-ai/twin, role: hub, layer: moyeu, visibility: public, lifecycle: active }",
      "  - { repository: libre-ai/twin, role: hub, layer: moyeu, visibility: public, lifecycle: active }",
    ].join("\n");
    expect(() => buildIndex(yaml)).toThrow("duplicate repository entry libre-ai/twin");
  });

  test("rejects a visibility outside public/private", () => {
    const yaml = [
      "schema_version: v",
      "updated_on: 2026-07-24",
      "repositories:",
      "  - { repository: libre-ai/x, role: hub, layer: moyeu, visibility: internal, lifecycle: active }",
    ].join("\n");
    expect(() => buildIndex(yaml)).toThrow('expected "public" or "private"');
  });

  test("rejects a lifecycle outside active/archived", () => {
    // Domain A re-ratification (2026-08-18, ADR-0023): general activation
    // (ADR-0020 D1) closed wave sequencing as doctrine three weeks before this
    // inventory caught up — nine entries still carried frozen-until-wave-N
    // values. The enum makes that regression structurally impossible: no wave
    // token, or any other free-form status, can survive as a lifecycle value.
    const yaml = [
      "schema_version: v",
      "updated_on: 2026-08-18",
      "repositories:",
      "  - { repository: libre-ai/x, role: reserved-product-home, layer: couche-1, visibility: public, lifecycle: frozen-until-wave-4 }",
    ].join("\n");
    expect(() => buildIndex(yaml)).toThrow('expected "active" or "archived"');
  });

  test("accepts only the exact private administrative repository shape", () => {
    const exact = privateEntry();
    expect(buildIndex(inventoryWith(exact)).repositories[0]).toEqual({
      repository: "libre-ai/product-research",
      name: "product-research",
      role: "administrative-private",
      layer: "transverse",
      visibility: "private",
      lifecycle: "active",
    });

    const invalidEntries = [
      exact.replace("administrative-private", "unknown-role"),
      exact.replace("administrative-private", "satellite"),
      exact.replace("libre-ai/product-research", "libre-ai/other-private"),
      exact.replace("visibility: private", "visibility: public"),
      exact.replace("layer: transverse", "layer: couche-1"),
      exact.replace("lifecycle: active", "lifecycle: archived"),
      `${exact}\n    card: project.v1.yaml`,
    ];
    for (const entry of invalidEntries) {
      expect(() => buildIndex(inventoryWith(entry))).toThrow();
    }
  });

  test("rejects an unknown public role", () => {
    expect(() =>
      buildIndex(
        inventoryWith(
          "  - { repository: libre-ai/x, role: invented, layer: couche-4, visibility: public, lifecycle: active }",
        ),
      ),
    ).toThrow("expected one of the closed roles");
  });

  test("classifies only public entries as cross-repository targets", () => {
    expect(isPublicCrossRepositoryTarget({ visibility: "public" })).toBe(true);
    expect(isPublicCrossRepositoryTarget({ visibility: "private" })).toBe(false);
  });

  test("the committed index matches a fresh regeneration from the inventory", async () => {
    const regenerated = renderIndex(buildIndex(await Bun.file(inventoryUrl).text()));
    expect(regenerated).toBe(await Bun.file(committedIndexUrl).text());
  });
});

function privateEntry(): string {
  return [
    "  - repository: libre-ai/product-research",
    "    role: administrative-private",
    "    layer: transverse",
    "    visibility: private",
    "    lifecycle: active",
  ].join("\n");
}

function inventoryWith(entry: string): string {
  return ["schema_version: v", "updated_on: 2026-09-11", "repositories:", entry].join("\n");
}
