<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0073 — Amendement d'ADR-0042 §5 : Work Supervision v0 admet un signal de forge filtré, ingéré par le propriétaire

- **Statut :** proposé — la fusion de cette pull request vaut signature du propriétaire (ADR-0043).
- **Arbitrage :** Owner-arbitration: 2026-11-23 — réponse « a » du propriétaire, en chat, à une question structurée à options (ADR-0022/I-24) posée sur le lot L6 du drill de revue de code du 2026-11-23 (« la revue comme événement d'une mission persistante »). L'option A était l'option recommandée. Son texte et les deux confirmations qu'il porte sont cités à la section « Source ».
- **Date de rédaction :** 2026-11-23
- **Portée :** Work Supervision v0, la fabrique (`libre-ai/ai-work-supervision`). Ne touche aucun produit du catalogue d'ADR-0042 §1.
- **Connexes :** ADR-0042 §5 (D55), qui fixe la v0 « mono-utilisateur : sans tenant, sans rôles, sans approbation tierce » ; ADR-0045 (I-32) ; ADR-0046 (I-33) ; ADR-0012 (I-21, I-22) ; ADR-0043 (signature par la fusion). Implémentation : PR d'implémentation dans libre-ai/ai-work-supervision.
- **Amende :** ADR-0042 §5 (D55), paragraphe « Dérogation à I-09 » : la v0 reste mono-utilisateur, sans tenant, sans rôles, sans approbation tierce, et admet une seule entrée d'origine tierce, le signal de forge filtré de D1 à D4. Le reste du §5 est inchangé, dont la dérogation à I-09 et sa limite à la seule v0.
- **Ne modifie pas :** la dérogation à I-09 et sa portée ; le §9 (P40) ; les contrats `agent-review.v1` et `orchestrator-event.v3`, qui ne sont ni modifiés ni consommés (I-03) ; le moratoire de création de dépôt.
- **Invariants :** aucun invariant modifié. S'appliquent : I-32 (le texte d'un tiers n'entre jamais, D2) ; I-21 (la liste des expéditeurs est une configuration d'instance, hors du dépôt, D3). I-33 ne s'applique pas : voir « Invariants examinés ». I-22 : aucune donnée d'une personne tierce n'entre, pas même une empreinte de login (D2).
- **N'autorise pas :** un client réseau, un jeton ou un secret dans `ws` ; un acteur tiers authentifié, un tenant ou un rôle ; une approbation par un tiers ; la sortie d'un état terminal d'une mission ; l'entrée dans `ws` d'un texte écrit par un tiers.

## Vérification empirique

La décision suppose une forme de la réponse de l'API de la forge, lue par `gh` sur le poste du propriétaire.

- **Prémisse :** une revue de pull request porte un identifiant, un état, le sha revu et le login de son auteur, séparés de son corps en texte libre.
- **Commande :** `gh api repos/cli/cli/pulls/15144/reviews --jq '.[0] | keys | join(",")'`
- **Date de rejeu :** 2026-11-23
- **Sortie attendue :** `_links,author_association,body,commit_id,copilot_code_review_effort,html_url,id,is_copilot_code_review,node_id,pull_request_url,state,submitted_at,user`. Le texte libre est `body` ; le login est sous `user.login`.

- **Prémisse :** un check-run porte un identifiant, une conclusion, le sha de tête et l'application émettrice, séparés de son texte libre.
- **Commande :** `gh api repos/libre-ai/project-governance/commits/$(gh api repos/libre-ai/project-governance/pulls/275 --jq .head.sha)/check-runs --jq '.check_runs[0] | keys | join(",")'`
- **Date de rejeu :** 2026-11-23
- **Sortie attendue :** `app,check_suite,completed_at,conclusion,details_url,external_id,head_sha,html_url,id,name,node_id,output,pull_requests,started_at,status,url`. Le texte libre est sous `output` (titre, résumé, texte) ; `name` est aussi choisi par l'émetteur.

Les deux formes portent donc chacune un texte libre et des références. D2 ne garde que des références.

## Contexte

ADR-0042 §5 fixe la v0 de Work Supervision : « mono-utilisateur : sans tenant, sans rôles, sans approbation tierce ». En v0, rien d'une forge n'entre dans `ws`. Le relevé de l'agent L6 sur `libre-ai/ai-work-supervision`, à la révision `6b44ba1`, à rejouer avant de s'en servir :

- `crates/` et `docs/work-supervision/` ne portent aucun concept de pull request, de revue de forge, de check-run de forge ni de liste d'expéditeurs. La table locale `check_runs` désigne les contrôles de critères qu'exécute le propriétaire. Ce n'est pas un check-run de forge.
- `ws` n'a aucun client réseau. `tiny_http` sert seulement le cockpit en boucle locale.
- `ws` ne pousse jamais. Le propriétaire pousse lui-même la branche `ws/<mission>` (`docs/work-supervision/coordination-v0.md`, « Publishing a result »).
- Une mission dans un état terminal (`accepted`, `abandoned`, `cancelled`) n'accepte plus que des notes (`docs/work-supervision/mission-v0.md`).
- Le journal ne porte aucun texte libre : un texte vit dans un blob adressé par son empreinte, et l'événement porte cette empreinte. La projection refuse toute sorte d'événement hors du catalogue (`docs/work-supervision/events-v0.md`).
- `ws hook` traduit déjà une entrée passée sur l'entrée standard.

Le lot L6 du drill veut que la revue et la CI d'une pull request reviennent à la mission qui l'a produite, au lieu d'un job de revue ponctuel. Revue et CI viennent d'une forge, et leurs auteurs peuvent être des tiers. Le §5, lu à la lettre, ne dit pas si une telle entrée est admise en v0.

## Décision

### D1 — Une entrée tierce filtrée est admise en v0

Work Supervision v0 admet une entrée d'origine tierce, une seule : le signal de revue ou de CI d'une pull request de forge. Les conditions de D2 à D4 s'appliquent toutes. Les autres termes du §5 restent vrais : aucun acteur tiers authentifié, aucun tenant, aucun rôle, aucune approbation tierce.

### D2 — Le propriétaire alimente, et seules des références entrent

- `ws` reste sans réseau, sans jeton et sans secret. Le propriétaire lit la forge avec son propre `gh` et passe la sortie de `gh api …/reviews` ou `gh api …/check-runs` sur l'entrée standard de `ws forge ingest <mission>`, comme il le fait pour `ws hook`.
- Une mission est liée à une pull request par un événement `mission.forge_linked` (dépôt, numéro de pull request). Seul le propriétaire le pose.
- `ws` ne garde que des références : identifiants, état ou conclusion pris dans un vocabulaire fermé, sha. Le corps d'une revue, la sortie et le nom d'un check-run, et tout autre texte libre sont jetés avant toute écriture.
- Le login de l'expéditeur n'entre jamais au journal, ni en clair ni en empreinte. Il sert seulement à le comparer à la liste de D3, en mémoire. Un signal admis porte l'identifiant de l'entrée de la liste qui l'a reconnu, choisi par le propriétaire ; un signal ignoré ne porte que sa référence et un motif fermé.
- L'authenticité de l'expéditeur est celle du `gh` du propriétaire. `ws` ne l'authentifie pas lui-même.

### D3 — Une liste d'expéditeurs, en donnée, hors du dépôt

Les expéditeurs admis sont une liste dans la configuration privée de l'instance (`config.toml`), hors du dépôt (I-21). Un signal dont l'expéditeur n'est pas dans la liste est journalisé `forge.signal.ignored`, sans autre effet.

### D4 — Mode `observe` par défaut, effet actif borné

- Par défaut, le mode est `observe` : `ws` journalise `would_accept` et place la proposition complète dans un blob. Aucune mission n'est créée.
- Le mode `active` se déclare explicitement. Son seul effet est une mission de suite à l'état **brouillon** (`draft`). Elle dépend de la mission d'origine. Son brief est un gabarit fixe plus la référence du signal. Seul le propriétaire la fait avancer.
- Aucun signal ne fait sortir une mission d'un état terminal. Une mission close n'est jamais rouverte : la suite est une mission nouvelle.

### D5 — Sortes d'événements permanentes

Les sortes `mission.forge_linked`, `forge.signal.ignored` et celle qui porte `would_accept` entrent au catalogue des événements de `ws` (`docs/work-supervision/events-v0.md`). Le journal est chaîné et ne s'oublie pas : une sorte qui y entre y reste. Le nom exact de chaque sorte est celui de la pull request d'implémentation.

## Invariants examinés

- **I-32.** La propriété tient par construction. Aucun texte écrit par un tiers n'entre dans `ws` (D2). Le brief de la mission de suite est un gabarit fixe plus des identifiants (D4). Aucune chaîne dérivée d'un contenu non fiable n'atteint donc un exécuteur. L'état et la conclusion viennent d'un vocabulaire fermé : un tiers ne peut pas y écrire de consigne.
- **I-33.** Ne s'applique pas. I-33 régit l'observation des appels d'outil d'un harness et ce qui en sort. Le signal de forge n'est pas une observation d'appel d'outil, et le journal de `ws` reste sur le poste du propriétaire. Aucune empreinte de login n'est d'ailleurs écrite (D2).
- **I-21.** La liste des expéditeurs est une donnée d'instance. Elle vit dans la configuration privée, jamais dans le dépôt (D3).
- **I-22.** Aucune donnée d'une personne tierce n'entre dans `ws`. Un expéditeur est une personne physique qui n'utilise pas `ws` ; son login, même haché, serait une donnée pseudonyme, car une empreinte sans clé d'un login public se retrouve en hachant les logins connus (inféré, non mesuré). D2 l'écarte donc entièrement : le journal ne porte que l'identifiant d'entrée de liste choisi par le propriétaire, ou rien pour un signal ignoré. Les deux autres formes envisagées, une empreinte sous clé d'instance et une empreinte réservée aux signaux admis, laissaient une donnée pseudonyme au journal.

## Conséquences

- ADR-0042 porte la mention « Amendé par : ADR-0073 » dans sa ligne de statut. Le registre porte D121.
- L'implémentation vit dans libre-ai/ai-work-supervision, dans la PR d'implémentation ouverte en parallèle. Le catalogue des événements y gagne les sortes de D5.
- Le défaut voisin relevé par l'agent L6 n'est pas traité ici. Le texte d'une idée promue devient le brief passé à l'exécuteur, ce qui est contraire à I-32 dès qu'un agent réel tourne.

## Ce qui n'est pas décidé ici

- Le format exact de la liste d'expéditeurs et l'identifiant d'un expéditeur de check-run (l'application émettrice ou autre) relèvent de la pull request d'implémentation.
- Le passage du mode `observe` au mode `active` sur l'instance du propriétaire est un acte de configuration du propriétaire. Cet ADR ne le fait pas.

## Alternatives rejetées

La question posée au propriétaire portait quatre options. L'auteur de cet ADR les a reçues résumées, pas mot pour mot :

| Option (résumée) | Motif du rejet |
| --- | --- |
| B — un connecteur de forge dans le démon, avec un jeton | apporte réseau et secret dans `ws` ; non retenue par le propriétaire |
| C — routage par les contrats `orchestrator-event` et `agent-review.v1`, pull request sur `schemas-and-contracts` | modifie des contrats existants (I-03) ; non retenue par le propriétaire |
| D — rien avant C0 | laisse le lot L6 sans atterrissage ; non retenue par le propriétaire |

## Source

Décision du propriétaire, en chat, le 2026-11-23 : réponse « a » à une question structurée à options. L'option A était l'option recommandée. L'auteur de cet ADR a reçu son texte par son mandat, et n'a pas lu la question telle qu'elle a été posée :

> `ws` reste sans réseau ; le propriétaire alimente. Nouvel événement `mission.forge_linked` (dépôt, numéro de PR ; propriétaire seul). `ws forge ingest <mission>` traduit une sortie `gh api …/reviews` ou `…/check-runs` passée sur stdin, comme `ws hook` le fait déjà. Il ne garde que des références (identifiants, état fermé, sha, empreinte du login) et jette le corps. Une liste d'expéditeurs dans `config.toml` : hors liste, l'événement est journalisé `forge.signal.ignored`. Mode `observe` par défaut : il journalise `would_accept` avec la proposition complète en blob. Mode `active` explicite : l'effet est une mission **brouillon** de suite, dépendante de l'originale, dont le brief est un gabarit fixe plus la référence.
>
> Conséquences : aucun réseau ni secret dans `ws` ; aucune sortie d'état terminal ; I-32 tient par construction (le texte du tiers n'entre jamais) ; l'authenticité de l'expéditeur vaut celle du `gh` du propriétaire ; amende ADR-0042 §5 (une entrée tierce filtrée) et ajoute des sortes d'événements permanentes.

L'option demandait deux confirmations : une entrée tierce filtrée est admise en v0 ; l'effet actif est une mission brouillon de suite, jamais une réouverture. Elles font partie du texte de l'option choisie, donc de la réponse « a ».

## Vérification

- `git grep -n "ADR-0073" docs/adr/0042-product-vision-and-realization-method.md` répond sur la ligne de statut d'ADR-0042.
- `grep -n "^| D121 " docs/decisions/DECISION-REGISTER.md` répond une ligne qui cite ADR-0073.
- Dans libre-ai/ai-work-supervision, après la fusion de la pull request d'implémentation : `grep -n -E "forge_linked|forge.signal.ignored|would_accept" docs/work-supervision/*.md` répond. Ce contrôle ne peut pas tourner avant cette fusion.
