/**
 * Generator of the list of products with code: the source of the "Du code
 * existe" marker of the public site (owner's choices of 2026-11-15, « Du code
 * existe », and of 2026-11-16, « Produit + chemin vérifié »).
 *
 * The list is a projection of the fleet versions gate, never an authority: a
 * product is listed when the card of the repository its fiche names as carrier
 * declares it in `products`, and the served branch of that repository tracks
 * the declared code path. The facts come from `evaluateFleetVersions`, the
 * evaluation `check-fleet-versions.ts` runs, over the same reads
 * (`readFleetVersionsInput`). A fleet with a single violation gives no list:
 * the generator exits non-zero, prints the violations and writes nothing,
 * because a list generated from a red gate would publish a marker nobody
 * verified.
 *
 * Determinism contract (same as `build-index.ts` and `build-vision.ts`): no
 * execution timestamp and no commit of the repositories read, entries sorted
 * by product then repository, so the committed file changes only when a card
 * declares, moves or drops a product, or when a code path stops being
 * tracked; a regeneration diff in CI is a drift signal. The site reads a
 * pinned copy of this file; the copy is the site's act, not this generator's.
 *
 * Usage: bun distribution/build-products-with-code.ts
 * Writes: distribution/index/products-with-code.v1.json
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { readFleetVersionsInput } from "../ecosystem/check-fleet-versions";
import {
  evaluateFleetVersions,
  type FleetVersionsOutcome,
  type ProductWithCode,
} from "../ecosystem/fleet-versions";

export const PRODUCTS_WITH_CODE_SCHEMA_VERSION = "libre-ai.products-with-code.v1";
export const PRODUCTS_WITH_CODE_PATH = "distribution/index/products-with-code.v1.json";

interface ProductsWithCodeDocument {
  readonly schema_version: typeof PRODUCTS_WITH_CODE_SCHEMA_VERSION;
  readonly source: string;
  readonly rule: string;
  readonly products: readonly ProductWithCode[];
}

export type ProductsWithCodeProjection =
  | { readonly ok: true; readonly json: string; readonly summary: string }
  | { readonly ok: false; readonly lines: readonly string[] };

export function projectProductsWithCode(
  outcome: Pick<FleetVersionsOutcome, "report" | "withCode" | "compteurs" | "volume">,
): ProductsWithCodeProjection {
  const violations = outcome.report.violations;
  if (violations.length > 0) {
    return {
      ok: false,
      lines: [
        ...violations.map((violation) => `Products with code: ${violation}`),
        `Products with code not generated: the fleet versions gate has ${violations.length} violation(s), and the list is never generated from a red gate.`,
      ],
    };
  }
  if (outcome.report.asserted === 0) {
    return {
      ok: false,
      lines: [
        "Products with code not generated: the fleet versions gate asserted nothing, so no product was verified.",
      ],
    };
  }
  // The list is the verified products and nothing else: a count that differs
  // means the evaluation and its list disagree, and neither can be published.
  if (outcome.withCode.length !== outcome.compteurs.products_verified) {
    return {
      ok: false,
      lines: [
        `Products with code not generated: ${outcome.withCode.length} product(s) listed, ${outcome.compteurs.products_verified} counted as verified.`,
      ],
    };
  }
  const document: ProductsWithCodeDocument = {
    schema_version: PRODUCTS_WITH_CODE_SCHEMA_VERSION,
    source: "ecosystem/check-fleet-versions.ts",
    rule: "A product is listed when the card of the repository its fiche names as carrier declares it in products, and the served branch of that repository tracks the declared code path.",
    products: outcome.withCode.map(({ product, repository, code }) => ({
      product,
      repository,
      code,
    })),
  };
  return {
    ok: true,
    json: `${JSON.stringify(document, null, 2)}\n`,
    summary: `Products with code written: ${outcome.withCode.length} product(s) = ${outcome.compteurs.products_verified} verified of ${outcome.compteurs.products_declared} declared — ${outcome.volume}`,
  };
}

if (import.meta.main) {
  // One root, the repository this script belongs to: the inventory and the
  // fiches are read there and the list is written there.
  const root = fileURLToPath(new URL("..", import.meta.url));
  process.chdir(root);
  const projection = projectProductsWithCode(evaluateFleetVersions(await readFleetVersionsInput()));
  if (!projection.ok) {
    for (const line of projection.lines) console.error(line);
    process.exit(1);
  }
  await Bun.write(join(root, PRODUCTS_WITH_CODE_PATH), projection.json);
  console.log(projection.summary);
}
