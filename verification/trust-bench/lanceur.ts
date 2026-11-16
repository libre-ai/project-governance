// Lanceur du banc de défauts semés.
// Pour chaque cas du corpus : remet la copie de travail à sa révision, applique les substitutions,
// soumet la copie à chaque couche séparément, consigne code de sortie et durée, puis restaure.
// Usage : bun lanceur.ts <corpus.json> <copie de travail> <résultats.jsonl> [--diffs <répertoire>]
// Une couche « attrape » un cas quand sa commande sort en non nul.
//
// Un cas porte soit une substitution (fichier, cherche, remplace), soit une liste « substitutions ».
// Une substitution dont « cherche » est vide crée le fichier (il ne doit pas exister).
//
// Deux arrêts, tenus par lanceur.test.ts : une substitution absente ou ambiguë arrête le banc avant
// toute mesure, et une couche rouge sur la révision saine l'arrête sans écrire de résultat.
//
// Les deux passages du 2026-11-16 versionnés sous resultats/ ont été produits par ce lanceur sans
// le rejeu d'un rouge, ajouté après eux : leurs lignes ne portent pas le champ « instable ».
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

const DELAI_MS = 10 * 60 * 1000;
const [corpusPath, copieArg, sortiePath, drapeau, diffsArg] = process.argv.slice(2);
if (!corpusPath || !copieArg || !sortiePath) {
  console.error(
    "usage: bun lanceur.ts <corpus.json> <copie> <résultats.jsonl> [--diffs <répertoire>]",
  );
  process.exit(2);
}
const copie = resolve(copieArg);
// {BANC} dans une commande de couche désigne le répertoire de ce lanceur, où vit le pilote.
const banc = import.meta.dir;
const diffsDir = drapeau === "--diffs" && diffsArg ? resolve(diffsArg) : null;
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;

function substitutionsDe(cas: Cas): readonly Substitution[] {
  if (cas.substitutions) return cas.substitutions;
  if (cas.fichier === undefined || cas.fichier === "") return [];
  return [{ fichier: cas.fichier, cherche: cas.cherche ?? "", remplace: cas.remplace ?? "" }];
}
// Calcule le contenu final de chaque fichier touché, sans écrire. Lève si une substitution
// est absente ou ambiguë : le corpus se valide en entier avant le premier lancement.
function planifier(cas: Cas): Map<string, string> {
  const etat = new Map<string, string>();
  for (const s of substitutionsDe(cas)) {
    const chemin = join(copie, s.fichier);
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
function executer(couche: Couche): { code: number; ms: number; fin: string } {
  const cmd = couche.commande.map((a) => a.replaceAll("{BANC}", banc).replaceAll("{COPIE}", copie));
  const debut = performance.now();
  const p = Bun.spawnSync(cmd, { cwd: copie, stdout: "pipe", stderr: "pipe", timeout: DELAI_MS });
  const ms = Math.round(performance.now() - debut);
  const texte = (p.stdout.toString() + p.stderr.toString()).trim().split("\n");
  // Un délai dépassé ou un signal n'est pas un verdict : code 124, compté à part.
  const code = p.exitCode ?? 124;
  return { code, ms, fin: texte.slice(-3).join(" ⏎ ").slice(0, 400) };
}

restaurer();
for (const cas of corpus.cas) {
  if (substitutionsDe(cas).length === 0) throw new Error(`${cas.id} : aucune substitution`);
  planifier(cas);
}
const revision = git("rev-parse", "HEAD").out.trim();
const lignes: string[] = [];
const sain: Cas = {
  id: "SAIN",
  attendu: false,
  nature: "révision d'origine",
  origine: "référence",
};
let appliques = 0;
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
    let instable = false;
    if (r.code !== 0 && r.code !== 124) {
      const second = executer(couche);
      if (second.code === 0) {
        instable = true;
        r = { code: 0, ms: r.ms + second.ms, fin: `rouge puis vert au rejeu ⏎ ${second.fin}` };
      } else r = { code: second.code, ms: r.ms + second.ms, fin: second.fin };
    }
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
        attrape: r.code !== 0 && r.code !== 124,
        delai: r.code === 124,
        instable,
        ms: r.ms,
        fin: r.fin,
      }),
    );
    console.log(`${cas.id}\t${couche.id}\trc=${r.code}\t${r.ms} ms`);
    // Une couche rouge sur la révision saine ne mesure plus rien : tout cas y paraîtrait « attrapé ».
    if (cas.id === "SAIN" && r.code !== 0) {
      restaurer();
      console.error(
        `banc interrompu : la couche ${couche.id} sort en ${r.code} sur la révision saine (${r.fin})`,
      );
      process.exit(3);
    }
  }
}
restaurer();
writeFileSync(sortiePath, `${lignes.join("\n")}\n`);
const attendues = (corpus.cas.length + 1) * corpus.couches.length;
console.log(
  `cas du corpus : ${corpus.cas.length}, cas appliqués : ${appliques}, couches : ${corpus.couches.length}, mesures écrites : ${lignes.length} (attendu ${attendues})`,
);
if (lignes.length !== attendues || appliques !== corpus.cas.length) process.exit(1);
