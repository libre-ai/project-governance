import type { PublicBrandProjection } from "../../brand/build-public-projection";

export const BRAND_INTRO_BEGIN = "<!-- libre-ai:brand-intro:begin -->";
export const BRAND_INTRO_END = "<!-- libre-ai:brand-intro:end -->";

export type BrandLanguage = "fr" | "en";

interface BrandCtaTargets {
  readonly primary: string;
  readonly secondary: string;
}

// The calls to action point at GitHub, not at `libre-ai.fr`: the domain does
// not resolve (measured 2026-10-13, empty A record), so its anchors led
// nowhere. `HEAD` lets GitHub serve each repository's own default branch
// instead of naming one that may not be served. The primary anchor is the
// GitHub slug of the products heading in each profile README; renaming that
// heading in libre-ai/.github breaks the anchor, not the page.
export const BRAND_CTA_TARGETS: Readonly<Record<BrandLanguage, BrandCtaTargets>> = {
  en: {
    primary: "https://github.com/libre-ai/.github/blob/HEAD/profile/README.md#planned-products",
    secondary: "https://github.com/libre-ai/project-governance/tree/HEAD/distribution/evidence",
  },
  fr: {
    primary:
      "https://github.com/libre-ai/.github/blob/HEAD/profile/README.fr.md#les-produits-envisag%C3%A9s",
    secondary: "https://github.com/libre-ai/project-governance/tree/HEAD/distribution/evidence",
  },
};

export function renderOrgBrandIntro(
  projection: PublicBrandProjection,
  language: BrandLanguage,
): string {
  const copy = projection.copy[language];
  const targets = BRAND_CTA_TARGETS[language];
  return [
    BRAND_INTRO_BEGIN,
    "# Libre AI",
    "",
    `> ${copy.tension}`,
    "",
    `## ${copy.promise}`,
    "",
    copy.explanation,
    "",
    `**${copy.qualification}** ${copy.reasonToBelieve}`,
    "",
    `[${copy.primaryCta}](${targets.primary}) · [${copy.secondaryCta}](${targets.secondary})`,
    BRAND_INTRO_END,
  ].join("\n");
}

if (import.meta.main) {
  const languageValue = process.argv[2];
  if (languageValue !== "fr" && languageValue !== "en") {
    throw new Error("brand.language_required:fr|en");
  }
  const projection = (await Bun.file(
    new URL("../../brand/projections/public-brand.v1.json", import.meta.url),
  ).json()) as PublicBrandProjection;
  console.log(renderOrgBrandIntro(projection, languageValue));
}
