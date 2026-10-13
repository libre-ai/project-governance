import { describe, expect, test } from "bun:test";

import type { PublicBrandProjection } from "../../brand/build-public-projection";
import { BRAND_INTRO_BEGIN, BRAND_INTRO_END, renderOrgBrandIntro } from "./render-org-brand-intro";

const projection = (await Bun.file(
  new URL("../../brand/projections/public-brand.v1.json", import.meta.url),
).json()) as PublicBrandProjection;

describe("organization brand introduction", () => {
  test("renders the governed French platform and public journeys", () => {
    const markdown = renderOrgBrandIntro(projection, "fr");

    expect(markdown).toContain(projection.copy.fr.tension);
    expect(markdown).toContain(projection.copy.fr.promise);
    expect(markdown).toContain(projection.copy.fr.explanation);
    expect(markdown).not.toContain("libre-ai.fr/#");
    expect(markdown).toContain(
      `[${projection.copy.fr.primaryCta}](https://github.com/libre-ai/.github/blob/HEAD/profile/README.fr.md#les-produits-envisag%C3%A9s)`,
    );
    expect(markdown).toContain(
      `[${projection.copy.fr.secondaryCta}](https://github.com/libre-ai/project-governance/tree/HEAD/distribution/evidence)`,
    );
    expect(markdown.split(BRAND_INTRO_BEGIN)).toHaveLength(2);
    expect(markdown.split(BRAND_INTRO_END)).toHaveLength(2);
  });

  test("renders the governed English translation", () => {
    const markdown = renderOrgBrandIntro(projection, "en");

    expect(markdown).toContain(projection.copy.en.tension);
    expect(markdown).toContain(projection.copy.en.promise);
    expect(markdown).toContain(projection.copy.en.explanation);
    expect(markdown).not.toContain("libre-ai.fr/#");
    expect(markdown).toContain(
      "[Take the keys.](https://github.com/libre-ai/.github/blob/HEAD/profile/README.md#planned-products)",
    );
    expect(markdown).toContain(
      "[See the evidence.](https://github.com/libre-ai/project-governance/tree/HEAD/distribution/evidence)",
    );
  });

  test("never names a branch in a call-to-action target", () => {
    for (const language of ["fr", "en"] as const) {
      const markdown = renderOrgBrandIntro(projection, language);
      expect(markdown).not.toContain("/blob/main/");
      expect(markdown).not.toContain("/tree/main/");
    }
  });

  test("is byte deterministic", () => {
    expect(renderOrgBrandIntro(projection, "fr")).toBe(renderOrgBrandIntro(projection, "fr"));
  });
});
