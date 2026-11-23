// Corpora of the trust bench: the index that says where each corpus comes from, and the reader of
// the corpus drawn from real defects of the fleet.
//
// Two origins, never summed by the bench:
// - « synthetic » : defects seeded in a working copy and witnesses written for the bench
//   (corpus/pi-evidence.json, replayed by lanceur.ts on every layer);
// - « observed » : commits of the served branch of a fleet repository that a later, explicit fix
//   corrected, and clean witnesses of the same repositories (corpus/flotte-observee.json). Only
//   the review layer (relecture.ts) reads them, as diffs.
//
// A case of the observed corpus names its diff, it does not hold it: the repository, the commit,
// its first parent, the paths, the number of lines changed and the SHA-256 of the diff text. Like
// the diffs of the synthetic corpus, which the launcher reproduces from the corpus and the
// revision, the diff is rebuilt here from a clone of the public repository, with fixed flags, and
// refused unless its paths, its size and its fingerprint are those the corpus records. Holding the
// text would put back into this tree, verbatim, the very defects this repository's gates refuse
// (a hardcoded branch, a path the forgetting register evicted), and the gates rightly read them.
//
// The reader refuses rather than repairs: a case without a pinned public proof, a case that is not
// observed, a field outside the closed list (an author would be personal data), a witness younger
// than 14 days at the survey or of another size class than the defect it is paired with.
//
// Usage: bun verification/trust-bench/corpora.ts diffs <corpus observé> <clones> <répertoire>
//        <clones> holds one clone per repository, named <dépôt> or <dépôt>.git (bare and blobless
//        clones serve); writes <id>.diff for each case, for relecture.ts; writes nothing if one
//        diff does not match the corpus or one target already exists.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export const CORPUS_DIRECTORY = "verification/trust-bench/corpus";
const INDEX_FILE = "index.json";

export type CorpusOrigin = "synthetic" | "observed";
const ORIGINS: readonly CorpusOrigin[] = ["synthetic", "observed"];

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface CorpusIndexEntry {
  readonly fichier: string;
  readonly origine: CorpusOrigin;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";
const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(isText);

export function parseCorpusIndex(text: string): Parsed<CorpusIndexEntry[]> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    return { ok: false, errors: [`index : JSON illisible (${String(cause)})`] };
  }
  if (!isRecord(value) || !Array.isArray(value.corpus) || value.corpus.length === 0) {
    return { ok: false, errors: ["index : « corpus » doit être une liste non vide"] };
  }
  const errors: string[] = [];
  const entries: CorpusIndexEntry[] = [];
  for (const [position, entry] of value.corpus.entries()) {
    if (
      !isRecord(entry) ||
      !isText(entry.fichier) ||
      !entry.fichier.startsWith(`${CORPUS_DIRECTORY}/`) ||
      !ORIGINS.includes(entry.origine as CorpusOrigin)
    ) {
      errors.push(
        `index : entrée ${position} — un fichier sous ${CORPUS_DIRECTORY}/ et une origine parmi ${ORIGINS.join(", ")} attendus`,
      );
      continue;
    }
    entries.push({ fichier: entry.fichier, origine: entry.origine as CorpusOrigin });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: entries };
}

/** Every file of the corpus directory is declared once, and every declared file is there. */
export function checkCorpusDirectory(
  entries: readonly CorpusIndexEntry[],
  files: readonly string[],
): string[] {
  const errors: string[] = [];
  const declared = entries.map((entry) => basename(entry.fichier));
  for (const name of new Set(declared)) {
    if (declared.filter((candidate) => candidate === name).length > 1)
      errors.push(`${name} : déclaré plus d'une fois`);
  }
  for (const file of files) {
    if (file !== INDEX_FILE && !declared.includes(file))
      errors.push(`${file} : présent dans ${CORPUS_DIRECTORY}/, absent de l'index`);
  }
  for (const name of declared) {
    if (!files.includes(name)) errors.push(`${name} : déclaré par l'index, absent du répertoire`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The observed corpus.

export interface ObservedCase {
  readonly id: string;
  readonly attendu: boolean;
  readonly origine: "observed";
  readonly nature: string;
  readonly depot: string;
  readonly commit: string;
  readonly base: string;
  readonly chemins: readonly string[];
  readonly lignes_modifiees: number;
  /** SHA-256 of the diff text that `diffText` gives for this case. */
  readonly empreinte_diff: string;
  /** Defects only. */
  readonly defaut?: string;
  readonly identification?: { readonly mode: string; readonly commande: string };
  readonly preuves?: readonly string[];
  /** Witnesses only. */
  readonly apparie_a?: string;
  readonly fusionne_le?: string;
}
export interface ObservedCorpus {
  readonly corpus: string;
  readonly origine: "observed";
  readonly releve: {
    readonly date: string;
    readonly defauts_retenus: number;
    readonly temoins_retenus: number;
    readonly reverts_trouves: number;
  };
  readonly cas: readonly ObservedCase[];
}

const TOP_FIELDS = ["corpus", "origine", "note", "releve", "regles", "ecartes", "limites", "cas"];
const SURVEY_FIELDS = [
  "date",
  "perimetre",
  "methode",
  "reverts_trouves",
  "defauts_retenus",
  "temoins_retenus",
];
const COMMON_FIELDS = [
  "id",
  "attendu",
  "origine",
  "nature",
  "depot",
  "commit",
  "base",
  "chemins",
  "lignes_modifiees",
  "empreinte_diff",
];
const DEFECT_FIELDS = [...COMMON_FIELDS, "defaut", "identification", "preuves"];
const WITNESS_FIELDS = [...COMMON_FIELDS, "apparie_a", "fusionne_le"];
const IDENTIFICATION_MODES = ["citee-par-le-correctif", "retrouvee-par-l-historique"];
/** The identifier the launcher reserves for the healthy revision. */
const RESERVED_ID = "SAIN";
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPOSITORY = /^libre-ai\/[a-z0-9][a-z0-9.-]*$/;
const PINNED = /^(libre-ai\/[a-z0-9][a-z0-9.-]*)@([0-9a-f]{40}):([^\s:\\]+)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A path of a case: relative, forward slashes, no parent step. */
const PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\s:\\]+$/;
/** A witness is merged at least this long before the survey. */
const WITNESS_MIN_AGE_DAYS = 14;
/** A witness changes between half and twice the lines of the defect it is paired with. */
const SIZE_RATIO = { min: 0.5, max: 2 } as const;

const days = (from: string, to: string): number => (Date.parse(to) - Date.parse(from)) / 86_400_000;

export function parseObservedCorpus(value: unknown): Parsed<ObservedCorpus> {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["corpus : un objet JSON attendu"] };
  for (const key of Object.keys(value)) {
    if (!TOP_FIELDS.includes(key)) errors.push(`corpus : champ inconnu « ${key} »`);
  }
  if (!isText(value.corpus)) errors.push("corpus : « corpus » doit nommer le corpus");
  if (value.origine !== "observed") errors.push("corpus : « origine » doit valoir observed");
  const survey = value.releve;
  if (!isRecord(survey)) return { ok: false, errors: [...errors, "corpus : « releve » absent"] };
  for (const key of Object.keys(survey)) {
    if (!SURVEY_FIELDS.includes(key)) errors.push(`releve : champ inconnu « ${key} »`);
  }
  if (!isText(survey.date) || !ISO_DATE.test(survey.date))
    errors.push("releve : date ISO attendue");
  if (!isText(survey.perimetre) || !isTextList(survey.methode))
    errors.push("releve : « perimetre » et « methode » attendus");
  for (const key of ["reverts_trouves", "defauts_retenus", "temoins_retenus"]) {
    if (!Number.isInteger(survey[key]) || (survey[key] as number) < 0)
      errors.push(`releve : « ${key} » doit être un entier positif ou nul`);
  }
  if (!Array.isArray(value.cas) || value.cas.length === 0)
    return { ok: false, errors: [...errors, "corpus : « cas » doit être une liste non vide"] };

  const seen = new Set<string>();
  const cases: ObservedCase[] = [];
  for (const [position, raw] of value.cas.entries()) {
    const label = isRecord(raw) && isText(raw.id) ? raw.id : `cas ${position}`;
    const fail = (note: string): void => {
      errors.push(`${label} : ${note}`);
    };
    if (!isRecord(raw)) {
      fail("un objet attendu");
      continue;
    }
    if (typeof raw.attendu !== "boolean") {
      fail("« attendu » doit être un booléen");
      continue;
    }
    const allowed = raw.attendu ? DEFECT_FIELDS : WITNESS_FIELDS;
    for (const key of Object.keys(raw)) {
      if (!allowed.includes(key))
        fail(`champ « ${key} » hors de la liste fermée d'un ${raw.attendu ? "défaut" : "témoin"}`);
    }
    if (!isText(raw.id) || !ID.test(raw.id)) fail(`identifiant invalide (attendu ${ID.source})`);
    else if (raw.id === RESERVED_ID)
      fail(`${RESERVED_ID} est réservé à la révision saine du lanceur`);
    else if (seen.has(raw.id)) fail("identifiant en double");
    else seen.add(raw.id);
    if (raw.origine !== "observed") fail("« origine » doit valoir observed : aucun cas construit");
    if (!isText(raw.nature)) fail("« nature » attendue");
    if (!isText(raw.depot) || !REPOSITORY.test(raw.depot))
      fail(`« depot » hors de ${REPOSITORY.source}`);
    if (!isText(raw.commit) || !SHA.test(raw.commit)) fail("« commit » : sha complet attendu");
    if (!isText(raw.base) || !SHA.test(raw.base)) fail("« base » : sha complet attendu");
    if (raw.base === raw.commit) fail("« base » et « commit » sont le même commit");
    if (!isTextList(raw.chemins) || !raw.chemins.every((path) => PATH.test(path)))
      fail("« chemins » : liste non vide de chemins relatifs attendue");
    if (!Number.isInteger(raw.lignes_modifiees) || (raw.lignes_modifiees as number) <= 0)
      fail("« lignes_modifiees » : entier strictement positif attendu");
    if (!isText(raw.empreinte_diff) || !SHA256.test(raw.empreinte_diff))
      fail("« empreinte_diff » : SHA-256 du diff attendu");
    if (raw.attendu) {
      if (!isText(raw.defaut)) fail("« defaut » : la description du défaut attendue");
      const identification = raw.identification;
      if (
        !isRecord(identification) ||
        !IDENTIFICATION_MODES.includes(identification.mode as string) ||
        !isText(identification.commande)
      )
        fail(
          `« identification » : un mode parmi ${IDENTIFICATION_MODES.join(", ")} et sa commande`,
        );
      if (!isTextList(raw.preuves)) {
        fail("« preuves » : au moins une preuve publique épinglée attendue");
      } else {
        for (const proof of raw.preuves) {
          const match = PINNED.exec(proof);
          if (match === null)
            fail(`preuve ${proof} : not pinned (organisation/dépôt@<sha de 40>:<chemin>)`);
          else if (match[1] !== raw.depot)
            fail(`preuve ${proof} : un autre dépôt que ${String(raw.depot)}`);
          else if (match[2] === raw.commit)
            fail(`preuve ${proof} : le commit fautif ne prouve pas son correctif`);
        }
      }
    } else if (!isText(raw.fusionne_le) || !ISO_DATE.test(raw.fusionne_le)) {
      fail("« fusionne_le » : date ISO attendue");
    } else if (isText(survey.date) && days(raw.fusionne_le, survey.date) < WITNESS_MIN_AGE_DAYS) {
      fail(
        `témoin fusionné le ${raw.fusionne_le}, moins de ${WITNESS_MIN_AGE_DAYS} jours avant le relevé du ${survey.date}`,
      );
    }
    cases.push(raw as unknown as ObservedCase);
  }

  // Pairing, once every case is read.
  for (const witness of cases.filter((cas) => !cas.attendu)) {
    const paired = cases.find((cas) => cas.id === witness.apparie_a);
    if (paired === undefined || !paired.attendu || paired.depot !== witness.depot) {
      errors.push(
        `${witness.id} : « apparie_a » doit nommer un défaut du même dépôt (${String(witness.apparie_a)})`,
      );
      continue;
    }
    const ratio = witness.lignes_modifiees / paired.lignes_modifiees;
    if (!(ratio >= SIZE_RATIO.min && ratio <= SIZE_RATIO.max))
      errors.push(
        `${witness.id} : taille ${witness.lignes_modifiees} ligne(s) contre ${paired.lignes_modifiees} pour ${paired.id}, hors de [${SIZE_RATIO.min} ; ${SIZE_RATIO.max}]`,
      );
  }
  const defects = cases.filter((cas) => cas.attendu).length;
  if (survey.defauts_retenus !== defects)
    errors.push(
      `releve : « defauts_retenus » vaut ${String(survey.defauts_retenus)}, le corpus porte ${defects} défaut(s)`,
    );
  if (survey.temoins_retenus !== cases.length - defects)
    errors.push(
      `releve : « temoins_retenus » vaut ${String(survey.temoins_retenus)}, le corpus porte ${cases.length - defects} témoin(s)`,
    );
  if (defects === 0 || defects === cases.length)
    errors.push("corpus : au moins un défaut et au moins un témoin attendus");
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: value as unknown as ObservedCorpus };
}

// ---------------------------------------------------------------------------
// The diff of a case, rebuilt from a clone.

/**
 * Every flag that a configuration could otherwise change is written: colour, external diff and
 * text conversion drivers, rename detection, abbreviated object names, algorithm, heuristic,
 * context and prefixes. The process gets no inherited GIT_* variable and reads no global or
 * system configuration.
 */
const DIFF_FLAGS = [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "--full-index",
  "--diff-algorithm=myers",
  "--indent-heuristic",
  "--unified=3",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];
const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

/** The lines a unified diff adds or removes, file headers excluded. */
export function changedLines(text: string): number {
  return text.split("\n").filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
    .length;
}
/** The paths named by the `diff --git` headers of a diff. */
function diffPaths(text: string): string[] {
  const paths = new Set<string>();
  for (const match of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    if (match[1] !== undefined) paths.add(match[1]);
    if (match[2] !== undefined) paths.add(match[2]);
  }
  return [...paths];
}
export const fingerprint = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** The diff text of base..commit on the paths, as git writes it with the flags above. */
export function diffText(
  clone: string,
  base: string,
  commit: string,
  paths: readonly string[],
): string {
  const run = Bun.spawnSync(["git", "-C", clone, ...DIFF_FLAGS, base, commit, "--", ...paths], {
    env: GIT_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (run.exitCode !== 0)
    throw new Error(`git diff ${base}..${commit} dans ${clone} : ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

/** The diff of a case, refused unless its paths, its size and its fingerprint are the recorded ones. */
export function materializeDiff(clone: string, cas: ObservedCase): string {
  const text = diffText(clone, cas.base, cas.commit, cas.chemins);
  const refuse = (note: string): never => {
    throw new Error(`${cas.id} (${cas.depot}@${cas.commit}) : ${note}`);
  };
  if (!text.startsWith("diff --git ")) refuse("diff vide sur les chemins du cas");
  const named = diffPaths(text);
  if (named.length !== cas.chemins.length || !cas.chemins.every((path) => named.includes(path)))
    refuse(`le diff nomme ${named.join(", ")}, le cas ${cas.chemins.join(", ")}`);
  if (changedLines(text) !== cas.lignes_modifiees)
    refuse(
      `le diff modifie ${changedLines(text)} ligne(s), le cas en enregistre ${cas.lignes_modifiees}`,
    );
  if (fingerprint(text) !== cas.empreinte_diff)
    refuse(`empreinte ${fingerprint(text)}, le cas enregistre ${cas.empreinte_diff}`);
  return text;
}

/** The clone of a repository under the clones directory, or null when there is none. */
function cloneOf(clones: string, repository: string): string | null {
  const name = repository.slice(repository.indexOf("/") + 1);
  for (const candidate of [join(clones, `${name}.git`), join(clones, name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Writes `<id>.diff` for each case, the input of relecture.ts. All or nothing: every clone is
 * found, every diff rebuilt and checked and every target found absent before the first write.
 */
export function writeDiffs(corpus: ObservedCorpus, clones: string, dir: string): number {
  const missing = [...new Set(corpus.cas.map((cas) => cas.depot))].filter(
    (repository) => cloneOf(clones, repository) === null,
  );
  if (missing.length > 0)
    throw new Error(
      `clone absent sous ${clones} : ${missing.map((repository) => `git clone --bare --filter=blob:none https://github.com/${repository}.git`).join(" ; ")}`,
    );
  const targets = corpus.cas.map((cas) => ({ path: join(dir, `${cas.id}.diff`), cas }));
  const present = targets.filter((target) => existsSync(target.path));
  if (present.length > 0)
    throw new Error(
      `${present.map((target) => target.path).join(", ")} : existe déjà, rien n'est écrit`,
    );
  const texts = targets.map(({ path, cas }) => ({
    path,
    text: materializeDiff(cloneOf(clones, cas.depot) as string, cas),
  }));
  mkdirSync(dir, { recursive: true });
  for (const { path, text } of texts) writeFileSync(path, text);
  return texts.length;
}

if (import.meta.main) {
  const [command, corpusPath, clones, dir, ...rest] = process.argv.slice(2);
  if (
    command !== "diffs" ||
    corpusPath === undefined ||
    clones === undefined ||
    dir === undefined ||
    rest.length > 0
  ) {
    console.error(
      "usage: bun verification/trust-bench/corpora.ts diffs <corpus observé> <clones> <répertoire>",
    );
    process.exit(2);
  }
  let parsed: Parsed<ObservedCorpus>;
  try {
    parsed = parseObservedCorpus(JSON.parse(readFileSync(corpusPath, "utf8")));
  } catch (cause) {
    console.error(`corpus illisible : ${corpusPath} (${String(cause)})`);
    process.exit(1);
  }
  if (!parsed.ok) {
    console.error(`corpus refusé : ${corpusPath}\n${parsed.errors.join("\n")}`);
    process.exit(1);
  }
  try {
    const defects = parsed.value.cas.filter((cas) => cas.attendu).length;
    const written = writeDiffs(parsed.value, clones, dir);
    console.log(
      `${parsed.value.corpus} (${parsed.value.origine}) : ${written} diff(s) reconstruit(s), chemins, taille et empreinte conformes, écrits dans ${dir} — ${defects} défaut(s) et ${written - defects} témoin(s)`,
    );
  } catch (cause) {
    console.error(`diffs refusés : ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }
}
