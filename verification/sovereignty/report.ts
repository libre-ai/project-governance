import type { AttestationOutcome } from "./adoption-attestation";
import type { ForgeRestoreData, ForgeRestoreOutcome } from "./forge-restore";
import type { DependencyInventory, EcosystemInventory } from "./lockfile-inventory";

/**
 * sovereignty.v1 report assembly and rendering. The report is deterministic
 * apart from the run metadata (ISO 8601 date, commit): same inputs, same
 * bytes — the golden tests pin that property. Every claim in the rendered
 * text is backed by a check result or explicitly marked pending, per the
 * no-over-claim rule of the specification.
 */
export type CheckStatus = "pass" | "fail" | "pending";

export type CheckId = "SOV-01" | "SOV-02" | "SOV-03" | "SOV-04" | "SOV-05" | "SOV-06" | "SOV-07";

interface CheckBase {
  readonly id: CheckId;
  readonly slug: string;
  readonly status: CheckStatus;
  readonly reason: string;
}

export interface Sov01Check extends CheckBase {
  readonly id: "SOV-01";
  readonly slug: "reconstruct-without-origin";
  readonly attestation: { readonly path: string; readonly status: string } | null;
}

export interface Sov02Check extends CheckBase {
  readonly id: "SOV-02";
  readonly slug: "forge-restore";
  readonly restore: ForgeRestoreData | null;
}

export interface Sov03Check extends CheckBase {
  readonly id: "SOV-03";
  readonly slug: "dependency-jurisdiction-inventory";
  readonly inventory: DependencyInventory | null;
}

export interface PendingSpecCheck extends CheckBase {
  readonly id: "SOV-04" | "SOV-05" | "SOV-06" | "SOV-07";
  readonly status: "pending";
  readonly activation: string;
}

export type SovereigntyCheck = Sov01Check | Sov02Check | Sov03Check | PendingSpecCheck;

export interface SovereigntyRunMetadata {
  readonly date: string;
  readonly commit: string;
}

export interface SovereigntyReport {
  readonly schemaVersion: "libre-ai.sovereignty.v1";
  readonly run: SovereigntyRunMetadata;
  readonly summary: { readonly pass: number; readonly fail: number; readonly pending: number };
  readonly checks: readonly SovereigntyCheck[];
}

export interface ReportInputs {
  readonly run: SovereigntyRunMetadata;
  readonly attestation: AttestationOutcome;
  readonly restore: ForgeRestoreOutcome;
  readonly inventory: DependencyInventory | { readonly error: string };
}

/**
 * Checks whose subject does not exist yet (no deployed runtime, no product
 * data, no operational secrets). Kept in the report so the uncovered share of
 * the sovereignty claim stays visible instead of silently narrowing the scope.
 */
const PENDING_SPEC_CHECKS: readonly Omit<PendingSpecCheck, "status" | "reason">[] = [
  {
    id: "SOV-04",
    slug: "second-infrastructure-deploy",
    activation: "first runtime release publicly deployed",
  },
  {
    id: "SOV-05",
    slug: "degraded-mode",
    activation: "first runtime release publicly deployed",
  },
  {
    id: "SOV-06",
    slug: "data-export-restore",
    activation: "first application in service with product data",
  },
  {
    id: "SOV-07",
    slug: "key-and-identity-rotation",
    activation: "operational secrets in service",
  },
];

function buildSov01(attestation: AttestationOutcome): Sov01Check {
  const base = { id: "SOV-01", slug: "reconstruct-without-origin" } as const;
  switch (attestation.kind) {
    case "absent":
      return {
        ...base,
        status: "pending",
        reason: "adoption attestation not yet published (positioning L3 not landed)",
        attestation: null,
      };
    case "unreadable":
      return {
        ...base,
        status: "fail",
        reason: `adoption attestation present but unverifiable: ${attestation.detail}`,
        attestation: null,
      };
    case "present": {
      const passed = attestation.status === "pass" || attestation.status === "passed";
      return {
        ...base,
        status: passed ? "pass" : "fail",
        reason: `adoption attestation reports status "${attestation.status}"`,
        attestation: { path: attestation.path, status: attestation.status },
      };
    }
  }
}

function buildSov02(restore: ForgeRestoreOutcome): Sov02Check {
  const base = { id: "SOV-02", slug: "forge-restore" } as const;
  if (restore.kind === "verified") {
    return {
      ...base,
      status: "pass",
      reason: "bundle restored in a clean directory; HEAD commit and tree hashes match",
      restore: restore.data,
    };
  }
  return { ...base, status: "fail", reason: restore.detail, restore: restore.data };
}

function isInventory(
  value: DependencyInventory | { readonly error: string },
): value is DependencyInventory {
  return !("error" in value);
}

function buildSov03(inventory: DependencyInventory | { readonly error: string }): Sov03Check {
  const base = { id: "SOV-03", slug: "dependency-jurisdiction-inventory" } as const;
  if (!isInventory(inventory)) {
    return { ...base, status: "fail", reason: inventory.error, inventory: null };
  }
  const externals = inventory.bun.totalExternal + inventory.cargo.totalExternal;
  return {
    ...base,
    status: "pass",
    reason: `lockfiles parsed; ${externals} external packages classified by distribution registry (v0 heuristic: registry is not code jurisdiction)`,
    inventory,
  };
}

export function buildSovereigntyReport(inputs: ReportInputs): SovereigntyReport {
  const checks: SovereigntyCheck[] = [
    buildSov01(inputs.attestation),
    buildSov02(inputs.restore),
    buildSov03(inputs.inventory),
    ...PENDING_SPEC_CHECKS.map(
      (check): PendingSpecCheck => ({
        ...check,
        status: "pending",
        reason: `activation condition: ${check.activation}`,
      }),
    ),
  ];
  const summary = {
    pass: checks.filter((c) => c.status === "pass").length,
    fail: checks.filter((c) => c.status === "fail").length,
    pending: checks.filter((c) => c.status === "pending").length,
  };
  return { schemaVersion: "libre-ai.sovereignty.v1", run: inputs.run, summary, checks };
}

export function renderReportJson(report: SovereigntyReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function renderEcosystemRows(inventory: EcosystemInventory): string {
  return `| ${inventory.ecosystem} | ${inventory.totalExternal} | ${inventory.directExternal} | ${inventory.firstParty} |`;
}

function renderSov03Section(check: Sov03Check): string[] {
  if (check.inventory === null) {
    return ["## SOV-03 — inventaire des dépendances", "", `Échec : ${check.reason}`, ""];
  }
  const { bun, cargo } = check.inventory;
  const lines: string[] = [
    "## SOV-03 — inventaire des dépendances par origine de distribution",
    "",
    "| Écosystème | Externes | Directes | Locales (workspace/chemin) |",
    "| --- | --- | --- | --- |",
    renderEcosystemRows(bun),
    renderEcosystemRows(cargo),
    "",
    "Répartition par registre :",
    "",
    "| Écosystème | Registre | Paquets |",
    "| --- | --- | --- |",
  ];
  for (const inventory of [bun, cargo]) {
    for (const entry of inventory.byRegistry) {
      lines.push(`| ${inventory.ecosystem} | ${entry.registry} | ${entry.count} |`);
    }
  }
  lines.push("");
  const nonStandard = [...bun.nonStandard, ...cargo.nonStandard];
  if (nonStandard.length === 0) {
    lines.push("Sources hors registres standards : aucune.");
  } else {
    lines.push("Sources hors registres standards :");
    lines.push("");
    for (const record of nonStandard) {
      lines.push(
        `- \`${record.name}@${record.version}\` (${record.ecosystem}) — \`${record.source ?? record.registry}\``,
      );
    }
  }
  lines.push(
    "",
    "**Mise en garde (heuristique v0)** : le registre de distribution n'est pas la",
    "juridiction du code. npm et crates.io sont des infrastructures de distribution",
    "opérées depuis les États-Unis, mais le code distribué est sous licences libres —",
    "réplicable, miroirable, vendorable. Ce tableau mesure la concentration du canal de",
    "distribution (dimensionnement de miroirs et de vendoring), jamais une exposition",
    "juridique du code.",
    "",
  );
  return lines;
}

function renderSov02Section(check: Sov02Check): string[] {
  const lines = ["## SOV-02 — restauration de forge", ""];
  if (check.status === "fail") {
    lines.push(`Échec : ${check.reason}`, "");
  }
  if (check.restore !== null) {
    lines.push(
      "| Empreinte | Source | Restauration |",
      "| --- | --- | --- |",
      `| Commit HEAD | \`${check.restore.sourceCommit}\` | \`${check.restore.restoredCommit}\` |`,
      `| Arbre HEAD | \`${check.restore.sourceTree}\` | \`${check.restore.restoredTree}\` |`,
      "",
    );
  }
  return lines;
}

export function renderReportMarkdown(report: SovereigntyReport): string {
  const lines: string[] = [
    "# Souveraineté testée — rapport sovereignty.v1",
    "",
    "Généré par `verification/sovereignty/run-sovereignty.ts` — registre des checks et",
    "méthodes : `verification/sovereignty/sovereignty.v1.md`. Ce rapport est de",
    "l'évidence : il prouve, il ne décide pas (`docs/README.md`).",
    "",
    `- Run : ${report.run.date}, commit \`${report.run.commit}\``,
    `- Synthèse : ${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.pending} pending`,
    "",
    "## Résultats",
    "",
    "| Id | Check | Statut | Raison |",
    "| --- | --- | --- | --- |",
  ];
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.slug} | ${check.status} | ${check.reason} |`);
  }
  lines.push("");
  for (const check of report.checks) {
    if (check.id === "SOV-02") {
      lines.push(...renderSov02Section(check));
    } else if (check.id === "SOV-03") {
      lines.push(...renderSov03Section(check));
    }
  }
  const pending = report.checks.filter((c) => c.status === "pending");
  lines.push("## Part non couverte (pending)", "");
  if (pending.length === 0) {
    lines.push("Aucun check pending : la couverture déclarée est entièrement testée.");
  } else {
    for (const check of pending) {
      lines.push(`- ${check.id} — ${check.slug} : ${check.reason}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
