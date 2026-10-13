# ADR-0049 — Couverture des menaces non couvertes du modèle de menace : quorum, SQL, XSS, exports et registre résiduel

- **Statut :** accepted — arbitrage propriétaire du 2026-10-10 en chat ; I-35, I-36, I-37, l'élargissement d'I-10 et D71 sont en vigueur à la fusion
- **Date :** 2026-10-10
- **Arbitrage :** le propriétaire a tranché le tri des sept menaces que `docs/security/THREAT-MODEL.md` marquait « no register invariant ». Il crée des invariants distincts sans élargir les invariants existants (Q2, option B), impose dès maintenant la diversité de famille de modèle dans le quorum agentique (Q3, option A), élargit I-10 aux exportations, et traite l'enveloppe et la chaîne d'approvisionnement par des garde-fous plutôt que par des invariants, le zero-day étant un risque accepté. La menace MLS est traitée à part par ADR-0048. Owner-arbitration: 2026-10-10 — décisions de tri des menaces arbitrées en chat
- **Portée :** les menaces 1, 2, 4, 5, 6 et 7 du tri du 2026-10-09 (XSS, intégrité des exportations, retour arrière d'`envelope.v1`, collusion d'agents, chaîne d'approvisionnement, paramétrisation SQL) et le registre résiduel du modèle de menace.
- **Élargit :** I-10 (cycle de vie des données). Le texte historique est conservé dans la ligne du registre, de sorte que toute citation antérieure reste vraie, sur le précédent d'I-05 (ADR-0031).
- **Applique :** I-17 (surface à touche humaine fermée), I-24 (décision par question structurée sur contexte restitué), ADR-0048 (convention « accepted risk » / « guardrail » dans les cellules du modèle de menace).
- **Autorise :** l'inscription d'I-35, I-36 et I-37, l'élargissement d'I-10 et la décision D71 ; la mise à jour des lignes concernées du modèle de menace et de son registre résiduel.
- **N'autorise pas :** la modification d'un contrat verrouillé (`agent-review-quorum.v1` et les contrats d'exportation restent identiques à l'octet ; une majeure qui rendrait `model-family` obligatoire ou ajouterait un digest d'exportation est une décision séparée) ; la construction des garde-fous eux-mêmes, que d'autres lots portent ; la modification du tableau d'état des contrôles K du modèle de menace.

## Contexte

L'exposition réelle est nulle. Aucun dépôt n'est au stade `proven`, et les produits concernés en sont au stade `idea` ou au début de leur réalisation. Ce sont donc des décisions « avant activation » : elles verrouillent un état encore conforme, ou fixent la règle avant le premier consommateur. Constats re-vérifiés le 2026-10-10 sur les branches servies :

**Menace 1 — XSS dans les applications locales.**
- `web-platform` sert des en-têtes stricts : `libre-ai/application-development-toolkit@5533abc:packages/web-platform/src/response.ts:1-9` (CSP `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`). Un test vérifie la CSP servie (`web-platform.test.tsx:25`).
- Le Notebook échoue fermé si la CSP ne contient pas `script-src 'self'`, et n'y ajoute que `'wasm-unsafe-eval'` (`libre-ai/personal-knowledge-notebook@22e8b2e:apps/notebook/src/server/handler.ts:72-77`). Un test unitaire (`handler.test.tsx:38`) et une assertion e2e (`apps/notebook/e2e/backup-host.e2e.ts:81`) le couvrent.
- Aucun sink HTML brut (`dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`) dans `apps/` du Notebook ni dans `packages/` du toolkit.
- **Trou :** `biome.json:9` du Notebook exclut `apps/notebook/src` et `apps/notebook/e2e` du lint, et aucun gate de flotte ne vérifie les en-têtes.

**Menace 2 — intégrité des exportations.**
- La sauvegarde du Notebook est chiffrée et authentifiée par AES-256-GCM avec séparation de domaine (`personal-knowledge-notebook@22e8b2e:crates/notebook-core/src/crypto.rs:2`, `:16-17`), avec 3 tests.
- Dans `libre-ai/schemas-and-contracts@a82d7b5`, `session-export.v1` porte un `digest` SHA-256 (`contracts/schemas/session-export.v1.schema.json:52`) et `signalement-local-export.v1` un `digest` et un `payloadDigest` (`:23`, `:42`) : un digest nu détecte la corruption, pas la falsification. `curated-item-export.v1/v2` ne portent qu'un digest par élément, aucun sur l'exportation. `practice-progress-export.v1` n'en porte aucun.
- La vérification de ces digests à l'import n'est pas mesurée ici (hypothèse : non vérifiée faute de consommateur).
- La ligne du modèle de menace attribuait ce contrôle à K3 (« K3 envelope (HMAC over snapshot) »). C'est faux : K3 lie les rappels de contenu non fiable, pas les exportations.

**Menace 4 — retour arrière d'`envelope.v1`.**
- `verifyEnvelope` n'accepte qu'une version, liée au MAC (`schemas-and-contracts@a82d7b5:packages/envelope/src/index.ts:180`).
- Le paquet n'est pas publié (`private: true`, `0.1.0`).
- **Trous :** le champ `integrity.alg` n'est pas vérifié ; aucun test ne rejoue une autre version sous un MAC valide ; aucun contrôle de monotonie dans le manifeste de composition ; la « dual-verify window » citée par le modèle de menace n'existe nulle part.

**Menace 5 — collusion d'agents.**
- `evaluate_agent_review_quorum` existe (`schemas-and-contracts@a82d7b5:crates/sdk-rs/src/quorum.rs:126`), avec 26 vecteurs (`contracts/fixtures/agent-orchestration-v1/quorum-vectors.v1.json`, `cases`). Il refuse deux revues de même famille de modèle lorsque `model-family` figure dans `diversityRequirements` (`:227-245`).
- Le contrat verrouillé `agent-review-quorum.v1` rend cette liste requise mais sans minimum (`contracts/schemas/agent-review-quorum.v1.schema.json:36`) : la diversité est optionnelle.
- Aucun consommateur n'appelle l'évaluateur. La recherche de code de l'organisation ne renvoie que le dépôt lui-même, et elle n'indexe pas les dépôts privés.

**Menace 6 — chaîne d'approvisionnement au-delà des advisories.** Les mécanismes en place sont :
- lock figé, que la composition installe avec `--ignore-scripts` (`.github/composition/prepare-composition.py:154`) ;
- épinglage des actions par SHA dans ce dépôt ;
- `cargo-deny` sur les sources ;
- `minimumReleaseAge = 259200` dans `bunfig.toml`.

Aucun gate de `tools/` ni d'`ecosystem/` ne lit `minimumReleaseAge`, et rien ne couvre le typosquat ni le zero-day au-delà de la revue.

**Menace 7 — paramétrisation SQL.**
- Les requêtes observées passent leurs valeurs en paramètres.
- Le port d'exécution expose un texte SQL brut, `exec(sql: string)` (`libre-ai/organization-data-lifecycle@56afd3b:packages/data/src/adapters/executor.ts:13`), à côté de `query(sql, params)` (`:12`).
- Aucun garde-fou n'empêche d'interpoler une valeur dans le texte.

## Options

- **Q2 (menaces 5 et 7).** (A) élargir I-18 et I-09 ; **(B, retenue)** créer des invariants distincts. Un invariant distinct se cite, se vérifie et se retire seul. I-09 porte l'identité et l'autorisation, I-18 le noyau de sécurité des boucles : leur ajouter la paramétrisation SQL ou la diversité de quorum rendrait chaque citation imprécise, ce que le gate de citations ne peut pas voir.
- **Q3 (diversité de quorum).** **(A, retenue)** l'imposer maintenant ; (B) l'imposer au premier runtime, par un ADR d'activation. Sans consommateur, l'imposer maintenant ne coûte rien et fixe la règle avant le premier runtime au lieu de la négocier contre lui.
- **Menaces 4 et 6.** Les traiter par des invariants a été écarté. Ce sont des propriétés de mécanismes (test de rejeu, vérification d'`alg`, monotonie de composition, gate de `minimumReleaseAge`, épinglage des actions sur la flotte) que d'autres lots construisent. Une doctrine qui n'ajoute rien au mécanisme ne ferait que le paraphraser.

## Décision

1. **I-35 — quorum agentique à diversité de famille de modèle, imposée dès maintenant.**
   - Un quorum de revues d'agents ne remplace une revue humaine que s'il réunit au moins deux reviewers de familles de modèle distinctes.
   - Toute politique de quorum déclare `model-family` dans ses exigences de diversité. Un quorum dont la politique l'omet, ou dont deux revues partagent une famille, ne vaut pas revue.
   - L'exigence ne relâche aucune autre exigence de diversité et ne remplace jamais la touche humaine d'I-17.
   - **Mécanisme :** l'évaluateur existe et sait vérifier `model-family`. Le contrat verrouillé ne l'impose pas, c'est donc le consommateur qui le porte. **Aucun consommateur n'existe aujourd'hui** : le premier devra prouver, par un vecteur rouge, qu'une politique sans `model-family` est refusée.
2. **I-36 — paramétrisation SQL.**
   - Une requête SQL émise par du code de la flotte reçoit toute valeur en paramètre lié. Aucune valeur issue d'une entrée, d'un utilisateur, d'un agent ou d'un contenu non fiable n'est interpolée dans son texte.
   - Un texte SQL construit dynamiquement n'est admis que pour une migration versionnée ou un identifiant pris dans une liste fermée, chacun inscrit dans une liste d'autorisation en donnée.
   - Un port d'exécution brut comme `exec(sql)` n'est appelé qu'avec un texte constant ou ainsi listé.
   - **Mécanisme :** un gate de flotte qui refuse fermé, **en construction par un autre lot**. Aujourd'hui, seule la revue tient l'invariant.
3. **I-37 — XSS et en-têtes `web-platform`.**
   - Toute application de la flotte qui sert du HTML le sert avec les en-têtes de sécurité de `web-platform`. Un relâchement de la CSP n'est admis que s'il est nommé par l'application, comme `'wasm-unsafe-eval'` pour le Notebook, et l'application échoue fermé au démarrage si la base attendue manque.
   - Aucun sink HTML ou de code brut (`dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`) n'est admis hors d'une liste d'autorisation en donnée.
   - Chaque application porte une assertion e2e de la CSP effectivement servie.
   - **Mécanisme, existant :** les en-têtes de `web-platform` et leur test, l'échec fermé et l'assertion e2e du Notebook. **En cours :** la réactivation du lint du Notebook, par un autre lot. **Manquant :** un gate de flotte des en-têtes servis.
4. **I-10 est élargi aux exportations.**
   - Toute exportation porte un digest canonique de son contenu (SHA-256 de sa forme canonique, RFC 8785 pour une exportation JSON), vérifié à l'import avec refus fermé.
   - Hors du contexte de confiance qui l'a produite (remise à un tiers, à un autre appareil ou à un autre service), elle est authentifiée par AEAD ou par signature, jamais par un digest nu.
   - La falsification d'une exportation par son propre détenteur est un risque accepté et documenté : il détient la clé ou le contenu, et aucune primitive ne l'en empêche.
   - **Écarts mesurés :** `curated-item-export` et `practice-progress-export` n'ont pas de digest d'exportation, et la vérification à l'import des deux autres n'est pas mesurée. Les combler exige une majeure de ces contrats, décision séparée. Aucun gate de flotte ne vérifie l'invariant aujourd'hui.
5. **Menaces 4 et 6 : garde-fous, sans invariant.**
   - Enveloppe : test de rejeu d'une autre version sous MAC valide, vérification d'`alg`, contrôle `is-ancestor` dans la préparation de la composition.
   - Chaîne d'approvisionnement : gate de flotte pour `minimumReleaseAge` et l'épinglage des actions sur tous les dépôts.

   Ces garde-fous sont construits par d'autres lots. Le modèle de menace les nomme comme « guardrail ».
6. **Registre résiduel.**
   - Le zero-day dans une dépendance (biscuit-auth, OpenMLS ou toute dépendance transitive) est un **risque accepté**, porté par R8.
   - La collusion d'agents (R7) est désormais portée par I-35.
   - La falsification d'une exportation par son détenteur entre au registre comme risque accepté (R9).

## Conséquences

- Le modèle de menace remplace chaque « no register invariant » des sept menaces par la couverture décidée. Il corrige aussi la cellule « Control » de la ligne des exportations, qui attribuait à tort le contrôle à K3.
- Le tableau d'état des contrôles K n'est pas modifié.
- Le gate `check:threat-model-citations` résout les nouvelles citations contre le registre. La pertinence de chaque citation reste une affaire de revue.
- Les mécanismes manquants sont nommés comme tels. Un invariant dont le mécanisme n'existe pas est tenu par la revue jusqu'à sa construction, et le modèle de menace le dit.

## Sources

- Tri des sept menaces du 2026-10-09 (analyse en lecture seule, hors dépôt), dont les constats sont restitués et re-vérifiés ci-dessus.
- `libre-ai/application-development-toolkit@5533abc`, `libre-ai/personal-knowledge-notebook@22e8b2e`, `libre-ai/schemas-and-contracts@a82d7b5`, `libre-ai/organization-data-lifecycle@56afd3b`, aux chemins cités.
- `docs/security/THREAT-MODEL.md`, `bunfig.toml` de ce dépôt.
