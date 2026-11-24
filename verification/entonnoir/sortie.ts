// Contrat du fichier de résultats, commun à lancer.ts et à verification/trust-bench/relecture.ts.
//
// Un fichier laissé par un run précédent se lirait comme la mesure de celui-ci si le run s'arrêtait
// sans écrire ; l'écraser détruirait une mesure ou une entrée. Le chemin est donc refusé avant tout
// appel s'il existe déjà, et l'écriture finale est exclusive : elle ne remplace jamais un fichier
// apparu pendant le run.
import { lstatSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Motif du refus d'un chemin de sortie, ou null quand il est utilisable.
 *
 * `lstat` ne suit pas les liens : un lien, même pendant, occupe le chemin. `existsSync` le suivrait,
 * laisserait passer un lien pendant, et l'écriture exclusive échouerait alors en fin de run, après
 * l'envoi des contenus au juge.
 */
export function refusSortie(chemin: string): string | null {
  if (lstatSync(chemin, { throwIfNoEntry: false }) !== undefined) {
    return `${chemin} existe déjà ; choisir un autre chemin ou le retirer`;
  }
  // Sans répertoire de destination, chaque contenu partirait au juge pour un résultat impossible à
  // écrire : le défaut se voit ici, avant tout appel.
  if (statSync(dirname(resolve(chemin)), { throwIfNoEntry: false })?.isDirectory() !== true) {
    return `le répertoire de ${chemin} n'existe pas`;
  }
  return null;
}

/** Écriture exclusive : lève si le chemin existe, lien pendant compris, sans jamais le remplacer. */
export function ecrireExclusif(chemin: string, contenu: string): void {
  writeFileSync(chemin, contenu, { flag: "wx" });
}
