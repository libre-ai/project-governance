export interface PublicBrandCopy {
  readonly tension: string;
  readonly promise: string;
  readonly explanation: string;
  readonly qualification: string;
  readonly reasonToBelieve: string;
  readonly primaryCta: string;
  readonly secondaryCta: string;
}

export interface PublicProof {
  readonly claim: string;
  readonly mechanism: string;
  readonly source: string;
  readonly verifiedOn: string;
  readonly limitation: string;
}

export interface PublicProductName {
  readonly repository: string;
  readonly publicName: string;
}

export interface PublicBrandProjection {
  readonly schema_version: "libre-ai.public-brand.v1";
  readonly generated_from: readonly [
    "brand/README.md",
    "brand/README.en.md",
    "brand/proof-matrix.md",
  ];
  readonly copy: {
    readonly fr: PublicBrandCopy;
    readonly en: PublicBrandCopy;
  };
  readonly products: readonly PublicProductName[];
  readonly proofs: readonly PublicProof[];
}

const PRODUCT_FAMILY_BEGIN = "<!-- libre-ai:brand:product-family:begin -->";
const PRODUCT_FAMILY_END = "<!-- libre-ai:brand:product-family:end -->";

const copyFields = [
  ["tension", "tension"],
  ["promise", "promise"],
  ["explanation", "explanation"],
  ["qualification", "qualification"],
  ["reason-to-believe", "reasonToBelieve"],
  ["primary-cta", "primaryCta"],
  ["secondary-cta", "secondaryCta"],
] as const;

const canonicalFrench: PublicBrandCopy = {
  tension: "Les plateformes propriétaires vous louent le produit.",
  promise: "Possédez la fabrique.",
  explanation:
    "Libre AI réunit les logiciels, la méthode et les preuves pour construire des outils d'IA que vous pouvez vérifier, modifier et déployer où vous le décidez.",
  qualification: "Ouverts, souverains et explicables.",
  reasonToBelieve: "Conçus dans une fabrique ouverte où la preuve fait partie du produit.",
  primaryCta: "Prenez les clés.",
  secondaryCta: "Voir les preuves.",
};

const canonicalEnglish: PublicBrandCopy = {
  tension: "Proprietary platforms rent you the product.",
  promise: "Own the factory.",
  explanation:
    "Libre AI brings together the software, method, and evidence to build AI tools you can inspect, modify, and deploy where you choose.",
  qualification: "Open, sovereign, and explainable.",
  reasonToBelieve: "Built in an open factory where evidence is part of the product.",
  primaryCta: "Take the keys.",
  secondaryCta: "See the evidence.",
};

function readMarkedCopy(markdown: string, expected: PublicBrandCopy): PublicBrandCopy {
  const values: Partial<Record<keyof PublicBrandCopy, string>> = {};

  for (const [markerName, field] of copyFields) {
    const marker = `<!-- libre-ai:brand:${markerName} -->`;
    const occurrences = markdown.split(marker).length - 1;
    if (occurrences === 0) throw new Error(`brand.public_copy_marker_missing:${markerName}`);
    if (occurrences !== 1) throw new Error(`brand.public_copy_marker_duplicate:${markerName}`);

    const afterMarker = markdown.split(marker)[1] ?? "";
    const value = afterMarker
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (value === undefined) throw new Error(`brand.public_copy_value_missing:${markerName}`);
    if (value !== expected[field]) {
      throw new Error(`brand.public_copy_canonical_mismatch:${markerName}`);
    }
    values[field] = value;
  }

  return values as PublicBrandCopy;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

function parseProofs(markdown: string): readonly PublicProof[] {
  const tableLines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (tableLines.length < 2) throw new Error("brand.proof_table_missing");
  const header = tableLines[0]
    ?.slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  if (header?.join("|") !== "Affirmation|Mécanisme|Source|Vérifié le|Limite") {
    throw new Error("brand.proof_header_invalid");
  }

  const separator = tableLines[1]
    ?.slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  if (separator?.length !== 5 || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    throw new Error("brand.proof_separator_invalid");
  }

  const proofs = tableLines.slice(2).map((line): PublicProof => {
    const cells = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length !== 5) throw new Error("brand.proof_row_invalid");
    const [claim = "", mechanism = "", source = "", verifiedOn = "", limitation = ""] = cells;
    if (claim === "" || mechanism === "") throw new Error("brand.proof_row_invalid");
    if (!isPublicHttpsUrl(source)) throw new Error("brand.proof_source_invalid");
    if (!isIsoDate(verifiedOn)) throw new Error("brand.proof_date_invalid");
    if (limitation === "") throw new Error("brand.proof_limitation_missing");
    return { claim, mechanism, source, verifiedOn, limitation };
  });

  if (proofs.length !== 3) throw new Error("brand.proof_count_invalid");
  if (new Set(proofs.map(({ claim }) => claim)).size !== proofs.length) {
    throw new Error("brand.proof_claim_duplicate");
  }
  return proofs;
}

function parseProductFamily(markdown: string): readonly PublicProductName[] {
  const beginCount = markdown.split(PRODUCT_FAMILY_BEGIN).length - 1;
  const endCount = markdown.split(PRODUCT_FAMILY_END).length - 1;
  if (beginCount !== 1 || endCount !== 1) throw new Error("brand.product_family_sentinels_invalid");
  const begin = markdown.indexOf(PRODUCT_FAMILY_BEGIN) + PRODUCT_FAMILY_BEGIN.length;
  const end = markdown.indexOf(PRODUCT_FAMILY_END);
  if (end <= begin) throw new Error("brand.product_family_sentinels_invalid");
  const tableLines = markdown
    .slice(begin, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (tableLines.length < 3) throw new Error("brand.product_family_table_invalid");
  if (tableLines[0] !== "| Repository | Nom public |") {
    throw new Error("brand.product_family_header_invalid");
  }
  if (!/^\|\s*:?-{3,}:?\s*\|\s*:?-{3,}:?\s*\|$/.test(tableLines[1] ?? "")) {
    throw new Error("brand.product_family_separator_invalid");
  }
  const repositories = new Set<string>();
  return tableLines.slice(2).map((line): PublicProductName => {
    const [repository = "", publicName = ""] = line
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());
    if (!/^libre-ai\/[a-z0-9-]+$/.test(repository)) {
      throw new Error("brand.product_family_repository_invalid");
    }
    if (repositories.has(repository))
      throw new Error(`brand.product_family_duplicate:${repository}`);
    repositories.add(repository);
    if (!publicName.startsWith("Libre AI ") || publicName.length <= "Libre AI ".length) {
      throw new Error(`brand.product_family_name_invalid:${repository}`);
    }
    return { repository, publicName };
  });
}

export function buildPublicBrandProjection(
  frenchMarkdown: string,
  englishMarkdown: string,
  proofMatrixMarkdown: string,
): PublicBrandProjection {
  return {
    schema_version: "libre-ai.public-brand.v1",
    generated_from: ["brand/README.md", "brand/README.en.md", "brand/proof-matrix.md"],
    copy: {
      fr: readMarkedCopy(frenchMarkdown, canonicalFrench),
      en: readMarkedCopy(englishMarkdown, canonicalEnglish),
    },
    products: parseProductFamily(frenchMarkdown),
    proofs: parseProofs(proofMatrixMarkdown),
  };
}

export function renderPublicBrandProjection(projection: PublicBrandProjection): string {
  const generatedFromMultiline = `"generated_from": ${JSON.stringify(
    projection.generated_from,
    null,
    2,
  ).replaceAll("\n", "\n  ")}`;
  const generatedFromCompact = `"generated_from": [${projection.generated_from
    .map((path) => JSON.stringify(path))
    .join(", ")}]`;
  return `${JSON.stringify(projection, null, 2).replace(
    generatedFromMultiline,
    generatedFromCompact,
  )}\n`;
}

async function run(): Promise<void> {
  const root = new URL("../", import.meta.url);
  const french = await Bun.file(new URL("brand/README.md", root)).text();
  const english = await Bun.file(new URL("brand/README.en.md", root)).text();
  const proofMatrix = await Bun.file(new URL("brand/proof-matrix.md", root)).text();
  const outputUrl = new URL("brand/projections/public-brand.v1.json", root);
  const output = renderPublicBrandProjection(
    buildPublicBrandProjection(french, english, proofMatrix),
  );

  if (process.argv.includes("--check")) {
    const current = await Bun.file(outputUrl).text();
    if (current !== output) throw new Error("brand.public_projection_drift");
    console.log("Brand projection is current.");
    return;
  }

  await Bun.write(outputUrl, output);
  console.log("Generated brand/projections/public-brand.v1.json.");
}

if (import.meta.main) {
  await run();
}
