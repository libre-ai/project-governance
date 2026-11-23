// Juge HTTP de l'entonnoir : un serveur compatible OpenAI exécuté sur la machine.
// Comme verification/trust-bench/relecture.ts, seule une URL locale est admise (127.0.0.1 ou
// localhost, port explicite) : une URL non locale est refusée à la construction, avant tout appel,
// tout comme un proxy d'environnement qui s'interposerait, et une redirection n'est jamais suivie.
//
// D1 (e) : la consigne part dans le message système, le contenu jugé seul dans le message
// utilisateur, en dernier ; aucune instruction ne le suit.
// Un serveur qui ne répond pas, ou répond une erreur HTTP, lève JugeInjoignable : la commande
// sort alors en non nul. Une réponse illisible n'est pas une panne du serveur : elle est rendue
// telle quelle, et l'entonnoir la classe hors schéma, donc non notée.
import { type IdentiteModele, type Invite, type Juge, JugeInjoignable } from "./entonnoir";

const URL_LOCALE = /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/;
const DELAI_MS = 120_000;

export function estUrlLocale(url: string): boolean {
  return URL_LOCALE.test(url);
}

export type Environnement = Readonly<Record<string, string | undefined>>;

/**
 * Le `fetch` de Bun envoie au proxy que nomme l'environnement (`http_proxy`, `HTTP_PROXY`) une
 * requête même destinée à 127.0.0.1 : l'URL locale ne garantit rien tant qu'un proxy peut
 * s'interposer. Rend les noms des variables qui en définissent un, ou null quand aucune ne le
 * fait ou qu'une variable `no_proxy` (toute casse) nomme exactement l'hôte.
 *
 * Volontairement plus large que ce que Bun lit (mesuré avec Bun 1.4.4 : `ALL_PROXY` est ignoré,
 * `no_proxy=localhost` n'exempte pas 127.0.0.1) : toute variable dont le nom contient « proxy »
 * compte, pour qu'un nom qu'on n'aurait pas énuméré ne passe pas. Seuls les noms sont rendus,
 * jamais les valeurs, qui peuvent porter un identifiant.
 */
export function proxyInterpose(hote: string, env: Environnement): string | null {
  const exemptions = Object.entries(env)
    .filter(([nom]) => nom.toLowerCase() === "no_proxy")
    .flatMap(([, valeur]) => (valeur ?? "").split(","))
    .map((entree) => entree.trim().toLowerCase());
  if (exemptions.includes(hote)) return null;
  const proxys = Object.entries(env)
    .filter(
      ([nom, valeur]) =>
        /proxy/i.test(nom) && nom.toLowerCase() !== "no_proxy" && (valeur ?? "") !== "",
    )
    .map(([nom]) => nom)
    .sort();
  return proxys.length > 0 ? proxys.join(", ") : null;
}

/** Hôte d'une URL locale, ou null quand l'URL n'est pas locale. */
export function hoteLocal(url: string): string | null {
  return URL_LOCALE.exec(url)?.[1] ?? null;
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
 * aucun réseau ; par défaut, c'est `fetch`. `env` est l'environnement lu pour le proxy.
 */
export function jugeHttp(
  url: string,
  identite: IdentiteModele,
  recuperer: Recuperer = fetch,
  env: Environnement = process.env,
): Juge {
  const hote = hoteLocal(url);
  if (hote === null) {
    throw new Error(`juge HTTP : seule une URL locale est admise, reçu ${url}`);
  }
  const proxys = proxyInterpose(hote, env);
  if (proxys !== null) {
    throw new Error(
      `juge HTTP : un proxy est défini (${proxys}) et aucune variable no_proxy ne nomme ${hote} : ` +
        `l'invite partirait au proxy ; ajouter ${hote} à NO_PROXY, ou retirer le proxy`,
    );
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
