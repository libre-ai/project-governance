// Commande de l'entonnoir.
// Usage : bun lancer.ts <cas.json> <résultats.jsonl>
//           [--juge-url <url locale> --juge-modele <m> --juge-version <v> --juge-famille <f>]
//           [--qualification <cas étiquetés.json>]
//
// Sans juge, chaque signal vaut « unavailable », jamais réussi. Avec un juge, les quatre
// options d'identité sont requises ; --qualification exige un juge.
// Codes de sortie :
//   0 mesure écrite ;
//   1 juge demandé mais injoignable (résultats écrits) ;
//   2 refusé avant tout appel, rien n'est écrit : usage, source illisible ou invalide, juge refusé,
//     fichier de résultats qui existe déjà (lien pendant compris, jamais remplacé), répertoire de
//     destination absent ;
//   3 écriture finale impossible alors qu'elle était possible au départ (fichier apparu ou
//     répertoire retiré pendant le run) : le fichier n'est pas touché, les lignes de résultats
//     partent sur la sortie standard et le bilan sur la sortie d'erreur.
import { REGISTRE } from "./controles";
import {
  codeDeSortie,
  EntreeInvalide,
  executer,
  formaterBilan,
  type Juge,
  JugeRefuse,
  lignesResultats,
  qualifier,
  verifierIndependance,
} from "./entonnoir";
import { jugeHttp } from "./juge-http";
import { ecrireExclusif, refusSortie } from "./sortie";
import { type Etiquetes, lireCas, lireEtiquetes } from "./sources";

const USAGE =
  "usage: bun lancer.ts <cas.json> <résultats.jsonl> " +
  "[--juge-url <url> --juge-modele <m> --juge-version <v> --juge-famille <f>] " +
  "[--qualification <étiquetés.json>]";

const OPTIONS = new Set([
  "--juge-url",
  "--juge-modele",
  "--juge-version",
  "--juge-famille",
  "--qualification",
]);

class Usage extends Error {
  override readonly name = "Usage";
}

interface Arguments {
  readonly cas: string;
  readonly sortie: string;
  readonly options: ReadonlyMap<string, string>;
}

function lireArguments(argv: readonly string[]): Arguments {
  const positionnels: string[] = [];
  const options = new Map<string, string>();
  for (let rang = 0; rang < argv.length; rang += 1) {
    const argument = argv[rang];
    if (argument === undefined) break;
    if (!argument.startsWith("--")) {
      positionnels.push(argument);
      continue;
    }
    const valeur = argv[rang + 1];
    if (!OPTIONS.has(argument) || valeur === undefined || options.has(argument)) {
      throw new Usage(`option invalide, sans valeur ou répétée : ${argument}`);
    }
    options.set(argument, valeur);
    rang += 1;
  }
  const [cas, sortie] = positionnels;
  if (cas === undefined || sortie === undefined || positionnels.length !== 2) {
    throw new Usage("deux arguments positionnels attendus");
  }
  return { cas, sortie, options };
}

function construireJuge(options: ReadonlyMap<string, string>): Juge | null {
  const url = options.get("--juge-url");
  const modele = options.get("--juge-modele");
  const version = options.get("--juge-version");
  const famille = options.get("--juge-famille");
  const fournies = [url, modele, version, famille].filter((v) => v !== undefined).length;
  if (fournies === 0) return null;
  if (url === undefined || modele === undefined || version === undefined || famille === undefined) {
    throw new Usage("un juge exige --juge-url, --juge-modele, --juge-version et --juge-famille");
  }
  try {
    return jugeHttp(url, { modele, version, famille });
  } catch (cause) {
    throw new Usage(String(cause));
  }
}

async function principal(argv: readonly string[]): Promise<number> {
  let args: Arguments;
  let juge: Juge | null;
  let etiquetes: Etiquetes | null = null;
  try {
    args = lireArguments(argv);
    const refus = refusSortie(args.sortie);
    if (refus !== null) throw new Usage(refus);
    juge = construireJuge(args.options);
    const qualification = args.options.get("--qualification");
    if (qualification !== undefined) {
      if (juge === null) throw new Usage("--qualification exige un juge");
      etiquetes = lireEtiquetes(qualification, REGISTRE);
    }
  } catch (cause) {
    if (cause instanceof Usage) {
      console.error(`entonnoir : ${cause.message}\n${USAGE}`);
      return 2;
    }
    if (cause instanceof EntreeInvalide) {
      console.error(`entonnoir : ${cause.message}`);
      return 2;
    }
    throw cause;
  }
  let execution: Awaited<ReturnType<typeof executer>>;
  try {
    const cas = lireCas(args.cas, REGISTRE);
    // Le refus d'un juge de la famille du candidat précède tout appel, qualification comprise.
    if (juge !== null) verifierIndependance(juge.identite, cas);
    // D1 (c) : la qualification est faite avant la mesure, sur les cas étiquetés par l'auteur.
    const qualification =
      juge !== null && etiquetes !== null
        ? await qualifier(juge, etiquetes.cas, REGISTRE, etiquetes.tauxFauxSuccesMax)
        : null;
    execution = await executer(cas, { registre: REGISTRE, juge, qualification });
  } catch (cause) {
    if (cause instanceof EntreeInvalide || cause instanceof JugeRefuse) {
      console.error(`entonnoir : ${cause.message}`);
      return 2;
    }
    throw cause;
  }
  const lignes = lignesResultats(execution);
  try {
    ecrireExclusif(args.sortie, `${lignes.join("\n")}\n`);
  } catch (cause) {
    // Le chemin était libre au départ : le fichier est apparu, ou le répertoire a disparu, pendant
    // le run. Il n'est jamais remplacé ; les mesures partent sur la sortie standard plutôt que
    // d'être perdues, et le bilan sur la sortie d'erreur pour que la sortie standard reste du JSONL.
    console.error(
      `entonnoir : écriture de ${args.sortie} impossible (${String(cause)}) ; mesures ci-dessous`,
    );
    console.log(lignes.join("\n"));
    for (const ligne of formaterBilan(execution)) console.error(ligne);
    return 3;
  }
  for (const ligne of formaterBilan(execution)) console.log(ligne);
  const code = codeDeSortie(execution);
  if (code !== 0)
    console.error("entonnoir : juge demandé mais injoignable, voir les essais non notés");
  return code;
}

if (import.meta.main) {
  process.exit(await principal(Bun.argv.slice(2)));
}
