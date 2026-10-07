import { describe, expect, test } from "bun:test";

import {
  buildPublicBrandProjection,
  renderPublicBrandProjection,
} from "../../brand/build-public-projection";
import { type BrandDocuments, validateBrandPlatform } from "./check-brand-platform";

const french = `# Plateforme
<!-- libre-ai:brand:tension -->
Les plateformes propriétaires vous louent le produit.
<!-- libre-ai:brand:promise -->
Possédez la fabrique.
<!-- libre-ai:brand:explanation -->
Libre AI réunit les logiciels, la méthode et les preuves pour construire des outils d'IA que vous pouvez vérifier, modifier et déployer où vous le décidez.
<!-- libre-ai:brand:qualification -->
Ouverts, souverains et explicables.
<!-- libre-ai:brand:reason-to-believe -->
Conçus dans une fabrique ouverte où la preuve fait partie du produit.
<!-- libre-ai:brand:primary-cta -->
Prenez les clés.
<!-- libre-ai:brand:secondary-cta -->
Voir les preuves.

<!-- libre-ai:brand:product-family:begin -->
| Repository | Nom public |
| --- | --- |
| libre-ai/notebook | Libre AI Notebook |
<!-- libre-ai:brand:product-family:end -->

Sont interdits comme affirmations : « plus complet que tous les concurrents ».
`;

const english = `# Platform
<!-- libre-ai:brand:tension -->
Proprietary platforms rent you the product.
<!-- libre-ai:brand:promise -->
Own the factory.
<!-- libre-ai:brand:explanation -->
Libre AI brings together the software, method, and evidence to build AI tools you can inspect, modify, and deploy where you choose.
<!-- libre-ai:brand:qualification -->
Open, sovereign, and explainable.
<!-- libre-ai:brand:reason-to-believe -->
Built in an open factory where evidence is part of the product.
<!-- libre-ai:brand:primary-cta -->
Take the keys.
<!-- libre-ai:brand:secondary-cta -->
See the evidence.
`;

const proofMatrix = `| Affirmation | Mécanisme | Source | Vérifié le | Limite |
| --- | --- | --- | --- | --- |
| Logiciels ouverts | Code public. | https://github.com/libre-ai | 2026-09-09 | Un dépôt ne prouve pas la disponibilité. |
| Souveraineté | Dépendances publiées. | https://github.com/libre-ai/governance | 2026-09-09 | Aucun runtime non prouvé n'est actif. |
| Explicabilité | Décisions sourcées. | https://github.com/libre-ai/governance | 2026-09-09 | Une sortie de modèle n'est pas causalement expliquée. |
`;

function validDocuments(): BrandDocuments {
  return {
    french,
    english,
    proofMatrix,
    projection: renderPublicBrandProjection(
      buildPublicBrandProjection(french, english, proofMatrix),
    ),
    trademarks:
      "Publication requires LicenseRef-Libre-AI-Brand-1.0 and an archived contrôle de similarité visuelle.",
    authorityMap: "| Plateforme de marque | `brand/` |",
    invariants: "| I-29 | Brand system | ADR-0033 | 2026-09-09 |",
    decisions: "| D39 | Open verifiable brand system | ADR-0033 |",
    repositoryIndex: "repositories:\n  - repository: libre-ai/notebook\n    product: Notebook\n",
  };
}

describe("validateBrandPlatform", () => {
  test("accepts one coherent authority set", () => {
    expect(validateBrandPlatform(validDocuments())).toEqual([]);
  });

  test("refuses missing doctrine and authority-map anchors", () => {
    const documents = validDocuments();

    expect(validateBrandPlatform({ ...documents, invariants: "" })).toContain(
      "brand.invariant_missing:I-29",
    );
    expect(validateBrandPlatform({ ...documents, decisions: "" })).toContain(
      "brand.decision_missing:D39",
    );
    expect(validateBrandPlatform({ ...documents, authorityMap: "" })).toContain(
      "brand.authority_map_missing:brand/",
    );
  });

  test("refuses a product inventory absent from the governed family", () => {
    const documents = validDocuments();
    expect(
      validateBrandPlatform({
        ...documents,
        repositoryIndex: `${documents.repositoryIndex}  - repository: libre-ai/radar\n    product: Radar\n`,
      }),
    ).toContain("brand.product_family_inventory_drift:libre-ai/radar");
  });

  test("refuses publication policy without both independent asset controls", () => {
    const documents = validDocuments();

    expect(
      validateBrandPlatform({
        ...documents,
        trademarks: "Publication requires LicenseRef-Libre-AI-Brand-1.0.",
      }),
    ).toContain("brand.asset_publication_guard_missing:similarity-review");
    expect(
      validateBrandPlatform({
        ...documents,
        trademarks: "Publication requires an archived contrôle de similarité visuelle.",
      }),
    ).toContain("brand.asset_publication_guard_missing:license-ref");
  });

  test("recognizes the English trademark-policy wording for similarity review", () => {
    const documents = validDocuments();

    expect(
      validateBrandPlatform({
        ...documents,
        trademarks:
          "Publication requires LicenseRef-Libre-AI-Brand-1.0 and an archived visual\nsimilarity review.",
      }),
    ).not.toContain("brand.asset_publication_guard_missing:similarity-review");
  });

  test("refuses a generated projection that no longer matches its authorities", () => {
    const documents = validDocuments();
    const staleProjection = documents.projection.replace(
      "Possédez la fabrique.",
      "Possédez la plateforme.",
    );

    expect(validateBrandPlatform({ ...documents, projection: staleProjection })).toContain(
      "brand.public_projection_stale",
    );
  });

  test("refuses a forbidden claim but permits documenting that same phrase as prohibited", () => {
    const documents = validDocuments();
    expect(validateBrandPlatform(documents)).not.toContain(
      "brand.forbidden_claim:plus complet que tous les concurrents",
    );

    const publishedClaim = documents.french.replace(
      "Sont interdits comme affirmations : « plus complet que tous les concurrents ».",
      "Libre AI est plus complet que tous les concurrents.",
    );
    expect(validateBrandPlatform({ ...documents, french: publishedClaim })).toContain(
      "brand.forbidden_claim:plus complet que tous les concurrents",
    );

    expect(
      validateBrandPlatform({
        ...documents,
        english: `${documents.english}\nLibre AI is completely free.\n`,
      }),
    ).toContain("brand.forbidden_claim:completely free");

    expect(
      validateBrandPlatform({
        ...documents,
        english: `${documents.english}\nForbidden brand claim: “completely free”.\n`,
      }),
    ).not.toContain("brand.forbidden_claim:completely free");
  });

  test("surfaces projection parser failures as gate findings", () => {
    const documents = validDocuments();

    expect(
      validateBrandPlatform({
        ...documents,
        proofMatrix: documents.proofMatrix.replace("https://", "http://"),
      }),
    ).toContain("brand.projection_invalid:brand.proof_source_invalid");
  });
});
