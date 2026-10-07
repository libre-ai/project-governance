import { describe, expect, test } from "bun:test";

import { buildPublicBrandProjection, renderPublicBrandProjection } from "./build-public-projection";

const french = `# Plateforme de marque

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
`;

const english = `# Brand platform

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

const proofMatrix = `# Matrice de preuve

| Affirmation | Mécanisme | Source | Vérifié le | Limite |
| --- | --- | --- | --- | --- |
| Logiciels ouverts | Code et licences sont publics, versionnés et inspectables. | https://github.com/libre-ai | 2026-09-09 | La présence d'un dépôt ne prouve ni disponibilité ni parité fonctionnelle. |
| Souveraineté | Les choix d'hébergement, dépendances et mécanismes de réversibilité sont publiés. | https://github.com/libre-ai/governance/blob/main/docs/decisions/INVARIANTS.md | 2026-09-09 | La cible runtime est documentée ; aucun déploiement non prouvé n'est présenté comme actif. |
| Explicabilité | Décisions, états et limites sont reliés à des sources versionnées. | https://github.com/libre-ai/governance | 2026-09-09 | Cette traçabilité n'implique pas que toute sortie de modèle soit causalement explicable. |
`;

describe("buildPublicBrandProjection", () => {
  test("projects the approved copy and proof order", () => {
    const projection = buildPublicBrandProjection(french, english, proofMatrix);

    expect(projection.schema_version).toBe("libre-ai.public-brand.v1");
    expect(projection.generated_from).toEqual([
      "brand/README.md",
      "brand/README.en.md",
      "brand/proof-matrix.md",
    ]);
    expect(projection.copy.fr.tension).toBe(
      "Les plateformes propriétaires vous louent le produit.",
    );
    expect(projection.copy.fr.promise).toBe("Possédez la fabrique.");
    expect(projection.copy.fr.primaryCta).toBe("Prenez les clés.");
    expect(projection.products).toEqual([
      { repository: "libre-ai/notebook", publicName: "Libre AI Notebook" },
    ]);
    expect(projection.proofs).toHaveLength(3);
    expect(projection.proofs.map(({ claim }) => claim)).toEqual([
      "Logiciels ouverts",
      "Souveraineté",
      "Explicabilité",
    ]);
  });

  test("refuses a missing canonical copy marker", () => {
    const missingMarker = french.replace("<!-- libre-ai:brand:tension -->", "");

    expect(() => buildPublicBrandProjection(missingMarker, english, proofMatrix)).toThrow(
      "brand.public_copy_marker_missing:tension",
    );
  });

  test("refuses a duplicated canonical copy marker", () => {
    const duplicatedMarker = french.replace(
      "<!-- libre-ai:brand:tension -->",
      "<!-- libre-ai:brand:tension -->\n<!-- libre-ai:brand:tension -->",
    );

    expect(() => buildPublicBrandProjection(duplicatedMarker, english, proofMatrix)).toThrow(
      "brand.public_copy_marker_duplicate:tension",
    );
  });

  test("refuses duplicate or unbranded product-family entries", () => {
    const duplicate = french.replace(
      "| libre-ai/notebook | Libre AI Notebook |",
      "| libre-ai/notebook | Libre AI Notebook |\n| libre-ai/notebook | Libre AI Notebook |",
    );
    const unbranded = french.replace("Libre AI Notebook", "Notebook");

    expect(() => buildPublicBrandProjection(duplicate, english, proofMatrix)).toThrow(
      "brand.product_family_duplicate:libre-ai/notebook",
    );
    expect(() => buildPublicBrandProjection(unbranded, english, proofMatrix)).toThrow(
      "brand.product_family_name_invalid:libre-ai/notebook",
    );
  });

  test("refuses drift from the approved French promise", () => {
    const drifted = french.replace("Possédez la fabrique.", "Louez une meilleure plateforme.");

    expect(() => buildPublicBrandProjection(drifted, english, proofMatrix)).toThrow(
      "brand.public_copy_canonical_mismatch:promise",
    );
  });

  test("refuses an insecure proof source", () => {
    const matrixWithHttp = proofMatrix.replace(
      "https://github.com/libre-ai |",
      "http://github.com/libre-ai |",
    );

    expect(() => buildPublicBrandProjection(french, english, matrixWithHttp)).toThrow(
      "brand.proof_source_invalid",
    );
  });

  test("refuses malformed proof rows and unbounded proof claims", () => {
    const malformed = proofMatrix.replace(
      "| Logiciels ouverts | Code et licences sont publics, versionnés et inspectables. | https://github.com/libre-ai | 2026-09-09 | La présence d'un dépôt ne prouve ni disponibilité ni parité fonctionnelle. |",
      "| Logiciels ouverts | https://github.com/libre-ai | 2026-09-09 | Limite |",
    );
    const missingLimitation = proofMatrix.replace(
      "La présence d'un dépôt ne prouve ni disponibilité ni parité fonctionnelle.",
      "",
    );

    expect(() => buildPublicBrandProjection(french, english, malformed)).toThrow(
      "brand.proof_row_invalid",
    );
    expect(() => buildPublicBrandProjection(french, english, missingLimitation)).toThrow(
      "brand.proof_limitation_missing",
    );
  });

  test("refuses invalid proof dates and a proof count other than three", () => {
    const invalidDate = proofMatrix.replace("2026-09-09", "2026-02-30");
    const twoProofs = proofMatrix.replace(
      "| Explicabilité | Décisions, états et limites sont reliés à des sources versionnées. | https://github.com/libre-ai/governance | 2026-09-09 | Cette traçabilité n'implique pas que toute sortie de modèle soit causalement explicable. |\n",
      "",
    );

    expect(() => buildPublicBrandProjection(french, english, invalidDate)).toThrow(
      "brand.proof_date_invalid",
    );
    expect(() => buildPublicBrandProjection(french, english, twoProofs)).toThrow(
      "brand.proof_count_invalid",
    );
  });
});

describe("renderPublicBrandProjection", () => {
  test("renders stable indented JSON with a trailing newline", () => {
    const projection = buildPublicBrandProjection(french, english, proofMatrix);

    const rendered = renderPublicBrandProjection(projection);

    expect(JSON.parse(rendered)).toEqual(projection);
    expect(rendered).toContain(
      '"generated_from": ["brand/README.md", "brand/README.en.md", "brand/proof-matrix.md"]',
    );
    expect(rendered.endsWith("\n")).toBe(true);
    expect(renderPublicBrandProjection(projection)).toBe(rendered);
  });
});
