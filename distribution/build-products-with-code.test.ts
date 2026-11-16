import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";

import type { FleetVersionsOutcome } from "../ecosystem/fleet-versions";
import schema from "../ecosystem/schemas/products-with-code.v1.schema.json";
import { GateReport } from "../tools/quality/gate-report";
import {
  PRODUCTS_WITH_CODE_PATH,
  PRODUCTS_WITH_CODE_SCHEMA_VERSION,
  projectProductsWithCode,
} from "./build-products-with-code";

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

/**
 * The list of products with code is a projection of the fleet versions gate:
 * it is written from a green gate only, holds the verified products and
 * nothing else, and its bytes depend on nothing but the products.
 */

type Outcome = Pick<FleetVersionsOutcome, "report" | "withCode" | "compteurs" | "volume">;

const P04 = {
  product: "P04",
  repository: "libre-ai/personal-knowledge-workspace",
  code: "apps/desktop",
};
const P15 = { product: "P15", repository: "libre-ai/signalement", code: "apps/extension-shared" };

function outcome(changes: Partial<Outcome> = {}): Outcome {
  const report = changes.report ?? new GateReport().check("libre-ai/notes", true, "held");
  const withCode = changes.withCode ?? [P04, P15];
  return {
    report,
    withCode,
    volume: "the volume read",
    compteurs: {
      products_verified: withCode.length,
      products_declared: withCode.length,
    } as FleetVersionsOutcome["compteurs"],
    ...changes,
  };
}

describe("projectProductsWithCode", () => {
  test("control: a green gate gives the list of its verified products, in its order", () => {
    const projection = projectProductsWithCode(outcome());
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    const document = JSON.parse(projection.json);
    expect(document.schema_version).toBe(PRODUCTS_WITH_CODE_SCHEMA_VERSION);
    expect(document.products).toEqual([P04, P15]);
    expect(projection.summary).toContain("2 product(s) = 2 verified of 2 declared");
  });

  test("a red gate gives no list, and says why", () => {
    const report = new GateReport().check(
      "libre-ai/notes",
      false,
      "products P04 names src/notes, which the served branch does not track",
    );
    const projection = projectProductsWithCode(outcome({ report }));
    expect(projection.ok).toBe(false);
    if (projection.ok) return;
    expect(projection.lines).toContain(
      "Products with code: libre-ai/notes: products P04 names src/notes, which the served branch does not track",
    );
  });

  test("a gate that asserted nothing gives no list", () => {
    const projection = projectProductsWithCode(outcome({ report: new GateReport(), withCode: [] }));
    expect(projection.ok).toBe(false);
  });

  test("a green gate without any product gives an empty list: no product has code yet", () => {
    const projection = projectProductsWithCode(outcome({ withCode: [] }));
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(JSON.parse(projection.json).products).toEqual([]);
    expect(validate(JSON.parse(projection.json))).toBe(true);
  });

  test("a list that disagrees with the verified count is not published", () => {
    const base = outcome();
    const projection = projectProductsWithCode({
      ...base,
      compteurs: { ...base.compteurs, products_verified: 3 },
    });
    expect(projection.ok).toBe(false);
  });

  test("determinism: the bytes depend on the products only, never on the volume or the time", () => {
    const first = projectProductsWithCode(outcome());
    const second = projectProductsWithCode(outcome({ volume: "another volume" }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.json).toBe(first.json);
    expect(first.json.endsWith("}\n")).toBe(true);
    expect(first.json).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test("an entry carries the product, its carrier and its path, and nothing else", () => {
    const extra = { ...P04, note: "not part of the contract" };
    const projection = projectProductsWithCode(outcome({ withCode: [extra] }));
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(JSON.parse(projection.json).products).toEqual([P04]);
  });

  test("a document outside its own schema is not published", () => {
    const projection = projectProductsWithCode(
      outcome({ withCode: [{ ...P04, code: "apps/desktop/" }] }),
    );
    expect(projection.ok).toBe(false);
    if (projection.ok) return;
    expect(projection.lines[0]).toContain("outside libre-ai.products-with-code.v1");
  });
});

describe("products-with-code.v1 schema", () => {
  test("the generated document and the committed file are valid", async () => {
    const projection = projectProductsWithCode(outcome());
    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(validate(JSON.parse(projection.json))).toBe(true);
    const committed = await Bun.file(
      new URL(`../${PRODUCTS_WITH_CODE_PATH}`, import.meta.url),
    ).json();
    expect(validate(committed), JSON.stringify(validate.errors)).toBe(true);
  });

  // Each constraint of the schema has a document it refuses: removing the
  // constraint turns its case green, and this test red.
  const valid = {
    schema_version: PRODUCTS_WITH_CODE_SCHEMA_VERSION,
    source: "ecosystem/check-fleet-versions.ts",
    products: [P04],
  };
  test.each([
    ["another schema version", { ...valid, schema_version: "libre-ai.products-with-code.v2" }],
    ["another source", { ...valid, source: "hand-written" }],
    ["a field the contract does not have", { ...valid, rule: "a sentence" }],
    ["no products field", { schema_version: valid.schema_version, source: valid.source }],
    ["a product that is not Pnn", { ...valid, products: [{ ...P04, product: "notes" }] }],
    [
      "a repository outside the organization",
      { ...valid, products: [{ ...P04, repository: "other/notes" }] },
    ],
    ["a path that leaves the repository", { ...valid, products: [{ ...P04, code: "../secrets" }] }],
    [
      "an entry without its path",
      { ...valid, products: [{ product: "P04", repository: P04.repository }] },
    ],
    ["an entry with an extra field", { ...valid, products: [{ ...P04, sha: "abc" }] }],
  ])("refused: %s", (_name, document) => {
    expect(validate(document)).toBe(false);
  });
});
