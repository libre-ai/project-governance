import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  canonicalJson,
  KnowledgeIndex,
  type KnowledgeProjection,
  KnowledgeProjectionError,
  loadCanonicalKnowledgeProjection,
  loadKnowledgeProjection,
} from "./knowledge-projection";

const canonical = await loadCanonicalKnowledgeProjection();

function firstObject(projection: KnowledgeProjection) {
  const object = projection.objects[0];
  if (!object) throw new Error("expected one projected Knowledge Object");
  return object;
}

describe("public knowledge projection", () => {
  test("validates the checked projection and verifies its digest", () => {
    expect(canonical.projection.schemaVersion).toBe("libre-ai.knowledge-projection.v1");
    expect(Object.isFrozen(canonical.projection)).toBeTrue();
    expect(Object.isFrozen(firstObject(canonical.projection))).toBeTrue();
    // The corpus grows with what the socle actually proves (I-16), so this
    // asserts the properties that must hold at any size — non-empty, no
    // duplicate id, and the founding objects still projected — rather than a
    // frozen count that would turn every new declaration into a red build.
    // Byte-identical output for any input order is proved separately, by the
    // engine's own `public_projection` test.
    const ids = canonical.index.all().map((object) => object.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("urn:libre-ai:bet:bun-fullstack");
    expect(ids).toContain("urn:libre-ai:decision:bun-react-rust-big-bang");
  });

  test("returns deterministic accepted relationships", () => {
    expect(
      canonical.index
        .related("urn:libre-ai:bet:bun-fullstack", "implemented-by")
        .map((object) => object.id),
    ).toEqual(["urn:libre-ai:decision:bun-react-rust-big-bang"]);
    expect(canonical.index.related("urn:libre-ai:missing:anything")).toEqual([]);
  });

  test("canonical JSON is independent from object key insertion order", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: 0 })).toBe(
      canonicalJson({ a: 0, nested: { a: 1, b: 2 }, z: 1 }),
    );
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  test("rejects duplicate and unresolved projection indexes", () => {
    const object = firstObject(canonical.projection);
    expect(() => new KnowledgeIndex([object, object])).toThrow(KnowledgeProjectionError);
    expect(
      () =>
        new KnowledgeIndex([
          {
            ...object,
            relationships: [
              { type: "depends-on", target: "urn:libre-ai:missing:x", status: "accepted" },
            ],
          },
        ]),
    ).toThrow(KnowledgeProjectionError);
  });

  test("rejects tampering and unknown fields without echoing object content", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "libre-ai-knowledge-"));
    try {
      const schemaDirectory = resolve(root, "schemas");
      await mkdir(schemaDirectory);
      await Promise.all([
        Bun.write(
          resolve(schemaDirectory, "knowledge-object.schema.json"),
          Bun.file("ecosystem/schemas/knowledge-object.schema.json"),
        ),
        Bun.write(
          resolve(schemaDirectory, "knowledge-projection.schema.json"),
          Bun.file("ecosystem/schemas/knowledge-projection.schema.json"),
        ),
      ]);

      const tampered: KnowledgeProjection & { privateValue?: string } = structuredClone(
        canonical.projection,
      );
      firstObject(tampered).name = "private-value-must-not-leak";
      const tamperedPath = resolve(root, "tampered.json");
      await writeFile(tamperedPath, JSON.stringify(tampered));
      await expect(loadKnowledgeProjection(tamperedPath, schemaDirectory)).rejects.toMatchObject({
        code: "knowledge.projection_digest_mismatch",
      });

      tampered.privateValue = "private-value-must-not-leak";
      const unknownPath = resolve(root, "unknown.json");
      await writeFile(unknownPath, JSON.stringify(tampered));
      try {
        await loadKnowledgeProjection(unknownPath, schemaDirectory);
        throw new Error("unknown projection field was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(KnowledgeProjectionError);
        expect(JSON.stringify(error)).not.toContain("private-value-must-not-leak");
      }

      const metadataLeak = structuredClone(canonical.projection) as KnowledgeProjection;
      (firstObject(metadataLeak).provenance as Record<string, unknown>).model =
        "private-value-must-not-leak";
      const metadataLeakPath = resolve(root, "metadata-leak.json");
      await writeFile(metadataLeakPath, JSON.stringify(metadataLeak));
      await expect(
        loadKnowledgeProjection(metadataLeakPath, schemaDirectory),
      ).rejects.toMatchObject({ code: "knowledge.projection_invalid" });

      const draftLeak = structuredClone(canonical.projection) as KnowledgeProjection;
      firstObject(draftLeak).status = "draft";
      const draftLeakPath = resolve(root, "draft-leak.json");
      await writeFile(draftLeakPath, JSON.stringify(draftLeak));
      await expect(loadKnowledgeProjection(draftLeakPath, schemaDirectory)).rejects.toMatchObject({
        code: "knowledge.projection_invalid",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
