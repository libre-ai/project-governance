// Lecture des sources de l'entonnoir : cas à mesurer et cas étiquetés pour la qualification.
// Une source illisible, mal formée ou vide est un échec, jamais zéro cas (critère 7) : chaque
// erreur lève SourceInvalide, et la commande sort en 2.
import { readFileSync } from "node:fs";
import {
  type Cas,
  type CasEtiquete,
  EntreeInvalide,
  type IdentiteModele,
  type Registre,
} from "./entonnoir";

export class SourceInvalide extends EntreeInvalide {
  override readonly name = "SourceInvalide";
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

function texteNonVide(valeur: unknown, ou: string): string {
  if (typeof valeur !== "string" || valeur.trim() === "") {
    throw new SourceInvalide(`${ou} : texte non vide attendu`);
  }
  return valeur;
}

function lireJson(chemin: string): unknown {
  let brut: string;
  try {
    brut = readFileSync(chemin, "utf8");
  } catch (cause) {
    throw new SourceInvalide(`${chemin} : illisible (${String(cause)})`);
  }
  try {
    return JSON.parse(brut) as unknown;
  } catch (cause) {
    throw new SourceInvalide(`${chemin} : JSON invalide (${String(cause)})`);
  }
}

function listeDeCas(document: unknown, chemin: string): readonly unknown[] {
  if (!estObjet(document) || !Array.isArray(document.cas)) {
    throw new SourceInvalide(`${chemin} : objet { "cas": [...] } attendu`);
  }
  if (document.cas.length === 0) throw new SourceInvalide(`${chemin} : aucun cas`);
  return document.cas;
}

function identite(valeur: unknown, ou: string): IdentiteModele {
  if (!estObjet(valeur)) throw new SourceInvalide(`${ou} : identité de modèle attendue`);
  return {
    modele: texteNonVide(valeur.modele, `${ou}.modele`),
    version: texteNonVide(valeur.version, `${ou}.version`),
    famille: texteNonVide(valeur.famille, `${ou}.famille`),
  };
}

function enteteCas(
  brut: unknown,
  rang: number,
  chemin: string,
  registre: Registre,
  vus: Set<string>,
): {
  readonly id: string;
  readonly controles: string;
  readonly sortie: unknown;
  readonly brut: Record<string, unknown>;
} {
  const ou = `${chemin} : cas n°${rang + 1}`;
  if (!estObjet(brut)) throw new SourceInvalide(`${ou} : objet attendu`);
  const id = texteNonVide(brut.id, `${ou}.id`);
  if (vus.has(id)) throw new SourceInvalide(`${ou} : identifiant ${id} en double`);
  vus.add(id);
  const controles = texteNonVide(brut.controles, `${ou}.controles`);
  // `Object.hasOwn` : « toString » ou « constructor » ne sont pas des contrôles du registre.
  if (!Object.hasOwn(registre, controles)) {
    throw new SourceInvalide(`${ou} : contrôles inconnus « ${controles} »`);
  }
  if (!("sortie" in brut)) throw new SourceInvalide(`${ou} : « sortie » manquante`);
  return { id, controles, sortie: brut.sortie, brut };
}

export function lireCas(chemin: string, registre: Registre): readonly Cas[] {
  const vus = new Set<string>();
  return listeDeCas(lireJson(chemin), chemin).map((brut, rang) => {
    const entete = enteteCas(brut, rang, chemin, registre, vus);
    return {
      id: entete.id,
      controles: entete.controles,
      sortie: entete.sortie,
      candidat: identite(entete.brut.candidat, `${chemin} : cas ${entete.id}.candidat`),
    };
  });
}

export interface Etiquetes {
  readonly tauxFauxSuccesMax: number;
  readonly cas: readonly CasEtiquete[];
}

export function lireEtiquetes(chemin: string, registre: Registre): Etiquetes {
  const document = lireJson(chemin);
  const cas = listeDeCas(document, chemin);
  const taux = estObjet(document) ? document.tauxFauxSuccesMax : undefined;
  if (typeof taux !== "number" || !Number.isFinite(taux) || taux < 0 || taux > 1) {
    throw new SourceInvalide(`${chemin} : « tauxFauxSuccesMax » entre 0 et 1 attendu`);
  }
  const vus = new Set<string>();
  return {
    tauxFauxSuccesMax: taux,
    cas: cas.map((brut, rang) => {
      const entete = enteteCas(brut, rang, chemin, registre, vus);
      const attendu = entete.brut.attendu;
      if (typeof attendu !== "boolean") {
        throw new SourceInvalide(`${chemin} : cas ${entete.id}.attendu booléen attendu`);
      }
      return { id: entete.id, controles: entete.controles, sortie: entete.sortie, attendu };
    }),
  };
}
