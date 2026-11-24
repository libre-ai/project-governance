// Registre des jeux de contrôles de l'entonnoir.
// Un seul jeu aujourd'hui, « carte.v1 », pour le corpus de démonstration : une carte d'interface
// fabriquée (titre, corps, actions). Aucune interface générée n'existe encore dans la flotte ;
// ce jeu illustre la forme, il ne décrit aucun produit.
import { definirControles, type Registre, type ResultatContrat } from "./entonnoir";

interface Action {
  readonly libelle: string;
  readonly url: string;
}

interface Carte {
  readonly composant: "carte";
  readonly titre: string;
  readonly corps: string;
  readonly actions: readonly Action[];
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur);
}

function clesExactes(objet: Record<string, unknown>, attendues: readonly string[]): string[] {
  const erreurs: string[] = [];
  for (const cle of Object.keys(objet)) {
    if (!attendues.includes(cle)) erreurs.push(`champ inattendu « ${cle} »`);
  }
  for (const cle of attendues) {
    if (!(cle in objet)) erreurs.push(`champ manquant « ${cle} »`);
  }
  return erreurs;
}

/** Étage 1 : le contrat de « carte.v1 », écrit comme une fonction typée. */
export function contratCarte(sortie: unknown): ResultatContrat<Carte> {
  if (!estObjet(sortie)) return { ok: false, erreurs: ["la sortie n'est pas un objet"] };
  const erreurs = clesExactes(sortie, ["composant", "titre", "corps", "actions"]);
  if (sortie.composant !== "carte") erreurs.push("« composant » doit valoir « carte »");
  if (typeof sortie.titre !== "string") erreurs.push("« titre » n'est pas un texte");
  if (typeof sortie.corps !== "string") erreurs.push("« corps » n'est pas un texte");
  const actions: Action[] = [];
  if (!Array.isArray(sortie.actions)) {
    erreurs.push("« actions » n'est pas une liste");
  } else {
    sortie.actions.forEach((action: unknown, rang: number) => {
      if (!estObjet(action)) {
        erreurs.push(`action n°${rang + 1} : objet attendu`);
        return;
      }
      for (const erreur of clesExactes(action, ["libelle", "url"])) {
        erreurs.push(`action n°${rang + 1} : ${erreur}`);
      }
      if (typeof action.libelle !== "string" || typeof action.url !== "string") {
        erreurs.push(`action n°${rang + 1} : « libelle » et « url » sont des textes`);
        return;
      }
      actions.push({ libelle: action.libelle, url: action.url });
    });
  }
  if (erreurs.length > 0 || typeof sortie.titre !== "string" || typeof sortie.corps !== "string") {
    return { ok: false, erreurs };
  }
  return {
    ok: true,
    valeur: { composant: "carte", titre: sortie.titre, corps: sortie.corps, actions },
  };
}

const carte = definirControles<Carte>({
  contrat: contratCarte,
  assertions: [
    {
      id: "titre-court",
      description: "le titre a entre 1 et 60 caractères",
      securite: false,
      severite: "bloquant",
      verifier: (c) => c.titre.trim().length > 0 && c.titre.length <= 60,
    },
    {
      id: "actions-au-plus-3",
      description: "la carte porte au plus 3 actions",
      securite: false,
      severite: "bloquant",
      verifier: (c) => c.actions.length <= 3,
    },
    {
      // Déclaré « signalé » à dessein : un constat de sécurité bloque quand même (D1 (d)).
      id: "liens-https",
      description: "chaque action pointe vers une URL https",
      securite: true,
      severite: "signale",
      verifier: (c) => c.actions.every((action) => action.url.startsWith("https://")),
    },
    {
      id: "libelles-distincts",
      description: "les libellés d'action sont distincts",
      securite: false,
      severite: "signale",
      verifier: (c) => new Set(c.actions.map((action) => action.libelle)).size === c.actions.length,
    },
  ],
  questions: [
    { id: "titre-fidele", texte: "Does the title faithfully summarise the body?" },
    {
      id: "actions-explicites",
      texte: "Does every action label say what the action does?",
    },
  ],
});

export const REGISTRE: Registre = { "carte.v1": carte };
