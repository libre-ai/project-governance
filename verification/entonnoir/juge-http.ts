// Juge HTTP de l'entonnoir : un serveur compatible OpenAI exécuté sur la machine.
// Comme verification/trust-bench/relecture.ts, seule une URL locale est admise (127.0.0.1 ou
// localhost, port explicite) : une URL non locale est refusée à la construction, avant tout appel,
// et une redirection n'est jamais suivie.
//
// D1 (e) : la consigne part dans le message système, le contenu jugé seul dans le message
// utilisateur, en dernier ; aucune instruction ne le suit.
// Un serveur qui ne répond pas, ou répond une erreur HTTP, lève JugeInjoignable : la commande
// sort alors en non nul. Une réponse illisible n'est pas une panne du serveur : elle est rendue
// telle quelle, et l'entonnoir la classe hors schéma, donc non notée.
import { type IdentiteModele, type Invite, type Juge, JugeInjoignable } from "./entonnoir";

const URL_LOCALE = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
const DELAI_MS = 120_000;

export function estUrlLocale(url: string): boolean {
  return URL_LOCALE.test(url);
}

export function corpsRequete(invite: Invite, modele: string): Record<string, unknown> {
  const proprietes: Record<string, { type: "boolean" }> = {};
  for (const id of invite.questions) proprietes[id] = { type: "boolean" };
  return {
    model: modele,
    messages: [
      { role: "system", content: invite.consigne },
      { role: "user", content: invite.contenu },
    ],
    temperature: 0,
    seed: 1,
    // Large : un modèle à raisonnement consomme des tokens avant le JSON.
    max_tokens: 4000,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "verdicts",
        strict: true,
        schema: {
          type: "object",
          properties: {
            verdicts: {
              type: "object",
              properties: proprietes,
              required: [...invite.questions],
              additionalProperties: false,
            },
            justification: { type: "string", maxLength: 600 },
          },
          required: ["verdicts", "justification"],
          additionalProperties: false,
        },
      },
    },
  };
}

type Recuperer = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Construit un juge HTTP local. `recuperer` est injectable pour que les tests n'appellent
 * aucun réseau ; par défaut, c'est `fetch`.
 */
export function jugeHttp(
  url: string,
  identite: IdentiteModele,
  recuperer: Recuperer = fetch,
): Juge {
  if (!estUrlLocale(url)) {
    throw new Error(`juge HTTP : seule une URL locale est admise, reçu ${url}`);
  }
  return {
    identite,
    async juger(invite: Invite): Promise<unknown> {
      let reponse: Response;
      try {
        reponse = await recuperer(`${url}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(corpsRequete(invite, identite.modele)),
          // Une redirection suivie enverrait l'invite à l'hôte que choisit le serveur, hors de la
          // vérification d'URL locale faite à la construction : elle est une panne, jamais suivie.
          redirect: "error",
          signal: AbortSignal.timeout(DELAI_MS),
        });
      } catch (cause) {
        throw new JugeInjoignable(`${url} : ${String(cause)}`);
      }
      if (!reponse.ok) throw new JugeInjoignable(`${url} : HTTP ${reponse.status}`);
      let corps: unknown;
      try {
        corps = await reponse.json();
      } catch (cause) {
        return `corps non JSON : ${String(cause)}`;
      }
      const texte = extraireTexte(corps);
      if (texte === null) return corps;
      try {
        return JSON.parse(texte) as unknown;
      } catch {
        // Un refus ou une prose : rendus tels quels, l'entonnoir les classe hors schéma.
        return texte;
      }
    },
  };
}

function extraireTexte(corps: unknown): string | null {
  if (typeof corps !== "object" || corps === null || !("choices" in corps)) return null;
  const { choices } = corps;
  if (!Array.isArray(choices)) return null;
  const premier: unknown = choices[0];
  if (typeof premier !== "object" || premier === null || !("message" in premier)) return null;
  const { message } = premier;
  if (typeof message !== "object" || message === null || !("content" in message)) return null;
  const { content } = message;
  return typeof content === "string" ? content : null;
}
