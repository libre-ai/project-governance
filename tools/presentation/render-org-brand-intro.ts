import type { PublicBrandProjection } from "../../brand/build-public-projection";

export const BRAND_INTRO_BEGIN = "<!-- libre-ai:brand-intro:begin -->";
export const BRAND_INTRO_END = "<!-- libre-ai:brand-intro:end -->";

export type BrandLanguage = "fr" | "en";

export function renderOrgBrandIntro(
  projection: PublicBrandProjection,
  language: BrandLanguage,
): string {
  const copy = projection.copy[language];
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
    `[${copy.primaryCta}](https://libre-ai.fr/#produits) · [${copy.secondaryCta}](https://libre-ai.fr/#preuves)`,
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
