// Lanceur du banc de défauts semés.
// Pour chaque cas du corpus : remet la copie de travail à sa révision, applique les substitutions,
// soumet la copie à chaque couche séparément, consigne code de sortie et durée, puis restaure.
// Usage : bun lanceur.ts <corpus.json> <copie de travail> <résultats.jsonl>
//         [--diffs <répertoire>] [--delai-ms <millisecondes>]
// Une couche « attrape » un cas quand sa commande sort d'elle-même en non nul.
//
// Un cas porte soit une substitution (fichier, cherche, remplace), soit une liste « substitutions ».
// Une substitution dont « cherche » est vide crée le fichier (il ne doit pas exister).
//
// Deux arrêts, tenus par lanceur.test.ts : une substitution absente ou ambiguë arrête le banc avant
// toute mesure, et une couche qui n'est pas verte sur la révision saine l'arrête sans écrire de
// résultat.
//
// Trois refus, en sortie 2 et avant toute écriture, tenus par les mêmes tests : une copie qui porte
// du travail non commité ou non suivi (la restauration l'effacerait), un identifiant de cas réservé
// (SAIN), en double ou qui n'est pas un nom simple, et une substitution dont le fichier sort de la
// copie une fois son chemin résolu.
//
// Trois issues d'une couche qui ne sont pas un verdict d'elle-même, tenues par les mêmes tests :
// - « delai » : la commande a dépassé son délai et le lanceur l'a arrêtée ; code null ;
// - « signal » : la commande est morte d'un signal que le lanceur n'a pas envoyé (mémoire, crash) ;
//   code null, le nom du signal est consigné ;
// - « instable » : rouge puis verte au rejeu ; consignée verte, avec la marque.
// Ni un délai ni un signal ne comptent comme « attrapé », et aucun des deux n'est un vert : le
// lanceur les compte, les imprime et sort en échec pour qu'ils soient vus.
//
// Les deux passages du 2026-11-16 versionnés sous resultats/ ont été produits par ce lanceur avant
// le rejeu d'un rouge et avant la distinction du signal : leurs lignes ne portent ni « instable »
// ni « signal », et une mort par signal y aurait été consignée « delai » avec le code 124.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

interface Couche {
  readonly id: string;
  readonly cout: number;
  readonly commande: readonly string[];
}
interface Substitution {
  readonly fichier: string;
  readonly cherche: string;
  readonly remplace: string;
}
interface Cas {
  readonly id: string;
  readonly attendu: boolean;
  readonly nature: string;
  readonly origine?: string;
  readonly fichier?: string;
  readonly cherche?: string;
  readonly remplace?: string;
  readonly substitutions?: readonly Substitution[];
}
interface Corpus {
  readonly depot: string;
  readonly couches: readonly Couche[];
  readonly cas: readonly Cas[];
}

const USAGE =
  "usage: bun lanceur.ts <corpus.json> <copie> <résultats.jsonl> [--diffs <répertoire>] [--delai-ms <millisecondes>]";
function usage(motif: string): never {
  console.error(`${motif}\n${USAGE}`);
  process.exit(2);
}
// Un refus d'entrée sort en 2, comme un usage, avant que le banc ne touche à la copie.
function refuser(motif: string): never {
  console.error(`banc refusé : ${motif}`);
  process.exit(2);
}
// L'identifiant de la révision saine : un cas du corpus ne peut pas le porter.
const SAIN = "SAIN";
const [corpusPath, copieArg, sortiePath, ...options] = process.argv.slice(2);
if (!corpusPath || !copieArg || !sortiePath) usage("arguments manquants");
let diffsDir: string | null = null;
let delaiMs = 10 * 60 * 1000;
for (let i = 0; i < options.length; i += 2) {
  const valeur = options[i + 1];
  if (valeur === undefined) usage(`${options[i]} : valeur manquante`);
  if (options[i] === "--diffs") diffsDir = resolve(valeur);
  else if (options[i] === "--delai-ms") {
    if (!/^[1-9]\d*$/.test(valeur)) usage(`--delai-ms : ${valeur} n'est pas un entier positif`);
    delaiMs = Number(valeur);
  } else usage(`option inconnue : ${options[i]}`);
}
const copie = resolve(copieArg);
// {BANC} dans une commande de couche désigne le répertoire de ce lanceur, où vit le pilote.
const banc = import.meta.dir;
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

function substitutionsDe(cas: Cas): readonly Substitution[] {
  if (cas.substitutions) return cas.substitutions;
  if (cas.fichier === undefined || cas.fichier === "") return [];
  return [{ fichier: cas.fichier, cherche: cas.cherche ?? "", remplace: cas.remplace ?? "" }];
}
// Le chemin d'une substitution, résolu dans la copie ; null s'il en sort (« ../ », absolu).
// Résolution lexicale : un lien symbolique de la copie qui pointe dehors n'est pas vu.
function cheminDans(fichier: string): string | null {
  const chemin = resolve(copie, fichier);
  const rel = relative(copie, chemin);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return chemin;
}
// Calcule le contenu final de chaque fichier touché, sans écrire. Lève si une substitution
// est absente ou ambiguë : le corpus se valide en entier avant le premier lancement.
function planifier(cas: Cas): Map<string, string> {
  const etat = new Map<string, string>();
  for (const s of substitutionsDe(cas)) {
    const chemin = cheminDans(s.fichier);
    if (chemin === null) throw new Error(`${cas.id} : ${s.fichier} sort de la copie`);
    if (s.cherche === "") {
      if (etat.has(chemin) || existsSync(chemin))
        throw new Error(`${cas.id} : ${s.fichier} existe déjà, création refusée`);
      etat.set(chemin, s.remplace);
      continue;
    }
    const avant = etat.get(chemin) ?? readFileSync(chemin, "utf8");
    const occurrences = avant.split(s.cherche).length - 1;
    if (occurrences !== 1)
      throw new Error(
        `${cas.id} : ${occurrences} occurrence(s) du texte cherché dans ${s.fichier}, 1 attendue`,
      );
    etat.set(
      chemin,
      avant.replace(s.cherche, () => s.remplace),
    );
  }
  return etat;
}
function git(...args: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(["git", "-C", copie, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}
function restaurer(): void {
  const r = git("checkout", "--", ".");
  if (r.code !== 0) throw new Error(`restauration impossible : ${r.out}`);
  // Retire les fichiers créés par un cas ; sans -x, les fichiers ignorés (node_modules) restent.
  const c = git("clean", "-fd", "-q");
  if (c.code !== 0) throw new Error(`nettoyage impossible : ${c.out}`);
  const sale = git("status", "--short").out.trim();
  if (sale !== "") throw new Error(`copie de travail non propre après restauration :\n${sale}`);
}
interface Issue {
  /** Le code de sortie de la commande, null quand elle n'en a pas rendu (délai, signal). */
  readonly code: number | null;
  readonly delai: boolean;
  /** Le signal qui a tué la commande, hors arrêt pour délai par le lanceur. */
  readonly signal: string | null;
  readonly ms: number;
  readonly fin: string;
}
function executer(couche: Couche): Issue {
  const cmd = couche.commande.map((a) => a.replaceAll("{BANC}", banc).replaceAll("{COPIE}", copie));
  const debut = performance.now();
  const p = Bun.spawnSync(cmd, { cwd: copie, stdout: "pipe", stderr: "pipe", timeout: delaiMs });
  const ms = Math.round(performance.now() - debut);
  const texte = (p.stdout.toString() + p.stderr.toString()).trim().split("\n");
  const fin = texte.slice(-3).join(" ⏎ ").slice(0, 400);
  // Le lanceur arrête lui-même une commande en délai par un signal : les deux cas se distinguent
  // par ce que dit l'exécution, pas par le signal reçu.
  if (p.exitedDueToTimeout === true) return { code: null, delai: true, signal: null, ms, fin };
  if (p.exitCode === null)
    return { code: null, delai: false, signal: p.signalCode ?? "inconnu", ms, fin };
  return { code: p.exitCode, delai: false, signal: null, ms, fin };
}
function etat(r: Issue): string {
  if (r.delai) return "délai dépassé";
  if (r.signal !== null) return `tuée par ${r.signal}`;
  return `rc=${r.code}`;
}

// Une copie qui porte du travail non commité n'est pas une copie de banc : la restauration
// (checkout, clean) l'effacerait. Elle est refusée avant toute écriture.
const statut = git("status", "--porcelain");
if (statut.code !== 0) refuser(`${copie} : pas une copie de travail git (${statut.out.trim()})`);
const entrees = statut.out.split("\n").filter((ligne) => ligne !== "").length;
if (entrees > 0)
  refuser(
    `${copie} : copie non propre, ${entrees} entrée(s) non commitée(s) ou non suivie(s) ; la restauration du banc les effacerait`,
  );
// L'identifiant d'un cas nomme ses lignes de résultat et son fichier de diff : la révision saine
// a le sien, deux cas n'en partagent pas, et aucun ne désigne un chemin.
const ID_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const vus = new Set<string>();
for (const cas of corpus.cas) {
  if (typeof cas.id !== "string" || !ID_VALIDE.test(cas.id))
    refuser(`${String(cas.id)} : identifiant invalide (attendu ${ID_VALIDE.source})`);
  if (cas.id === SAIN) refuser(`${cas.id} : identifiant réservé à la révision saine`);
  if (vus.has(cas.id)) refuser(`${cas.id} : identifiant en double`);
  vus.add(cas.id);
  for (const s of substitutionsDe(cas)) {
    if (typeof s.fichier !== "string" || cheminDans(s.fichier) === null)
      refuser(`${cas.id} : ${String(s.fichier)} sort de la copie`);
  }
}
restaurer();
for (const cas of corpus.cas) {
  if (substitutionsDe(cas).length === 0) throw new Error(`${cas.id} : aucune substitution`);
  planifier(cas);
}
const revision = git("rev-parse", "HEAD").out.trim();
const lignes: string[] = [];
const sain: Cas = {
  id: SAIN,
  attendu: false,
  nature: "révision d'origine",
  origine: "référence",
};
let appliques = 0;
let delais = 0;
let signaux = 0;
for (const cas of [sain, ...corpus.cas]) {
  restaurer();
  const plan = planifier(cas);
  for (const [chemin, contenu] of plan) {
    mkdirSync(dirname(chemin), { recursive: true });
    writeFileSync(chemin, contenu);
  }
  if (plan.size > 0) {
    appliques += 1;
    if (diffsDir) {
      mkdirSync(diffsDir, { recursive: true });
      // « add -N » rend les fichiers créés visibles dans le diff sans les indexer vraiment.
      git("add", "-N", ".");
      writeFileSync(join(diffsDir, `${cas.id}.diff`), git("diff", "-U12").out);
      git("reset", "-q");
    }
  }
  for (const couche of corpus.couches) {
    let r = executer(couche);
    // Un rouge se rejoue une fois : sous charge, une suite sensible aux délais rougit sans défaut
    // (mesuré le 2026-11-16 : 4 verdicts sur 18 ont basculé). Seul un rouge confirmé compte.
    // Un délai ou un signal n'est pas un rouge : il ne se rejoue pas, il se consigne tel quel.
    let instable = false;
    if (r.code !== null && r.code !== 0) {
      const second = executer(couche);
      instable = second.code === 0;
      const fin = instable ? `rouge puis vert au rejeu ⏎ ${second.fin}` : second.fin;
      r = { ...second, ms: r.ms + second.ms, fin };
    }
    if (r.delai) delais += 1;
    if (r.signal !== null) signaux += 1;
    lignes.push(
      JSON.stringify({
        depot: corpus.depot,
        revision,
        cas: cas.id,
        attendu: cas.attendu,
        nature: cas.nature,
        couche: couche.id,
        cout: couche.cout,
        code: r.code,
        attrape: r.code !== null && r.code !== 0,
        delai: r.delai,
        signal: r.signal,
        instable,
        ms: r.ms,
        fin: r.fin,
      }),
    );
    console.log(`${cas.id}\t${couche.id}\t${etat(r)}\t${r.ms} ms`);
    // Une couche qui n'est pas verte sur la révision saine ne mesure plus rien : rouge, tout cas y
    // paraîtrait « attrapé » ; en délai ou tuée, aucun de ses verdicts ne se lirait.
    if (cas.id === SAIN && r.code !== 0) {
      restaurer();
      const issue = r.code === null ? `finit « ${etat(r)} »` : `sort en ${r.code}`;
      console.error(
        `banc interrompu : la couche ${couche.id} ${issue} sur la révision saine (${r.fin})`,
      );
      process.exit(3);
    }
  }
}
restaurer();
writeFileSync(sortiePath, `${lignes.join("\n")}\n`);
const attendues = (corpus.cas.length + 1) * corpus.couches.length;
console.log(
  `cas du corpus : ${corpus.cas.length}, cas appliqués : ${appliques}, couches : ${corpus.couches.length}, mesures écrites : ${lignes.length} (attendu ${attendues}), délais dépassés : ${delais}, couches tuées par signal : ${signaux}`,
);
// Un délai ou un signal n'est ni un vert ni un rouge : le lanceur sort en échec pour qu'il soit vu.
if (lignes.length !== attendues || appliques !== corpus.cas.length || delais + signaux > 0)
  process.exit(1);
