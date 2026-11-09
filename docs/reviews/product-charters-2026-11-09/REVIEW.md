<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: proposal

# Chartes des deux produits preuves (P15 `signalement`, P02 `information-watch`) et champ `charte` pour toute brique produit

**Date :** 2026-11-09
**Objet :** écrire, pour les deux seuls produits du catalogue d'ADR-0042 §1 qui ont un dépôt porteur et un ADR de sortie de gel (P15 par ADR-0055, P02 par ADR-0054), ce qu'un lecteur extérieur doit pouvoir lire en cinq lignes : la valeur, pour qui, le critère qui fait passer le produit de « décrit » à « prototypé », le critère d'abandon, et ce que le produit ne fera pas. Puis proposer que ces cinq lignes deviennent un champ obligatoire de la fiche de toute brique produit, vérifié par le gate de la page vision.
**Nature :** proposition rédigée par l'agent sur la consigne « go all » du 2026-11-09, à partir du texte des ADR-0042, 0054 et 0055 et de la décision du propriétaire du même jour (vision dans ce dépôt, privé d'abord, français d'abord). Aucune fiche `project.v1.yaml` n'est modifiée ; aucune charte n'est en vigueur avant d'être reprise par son dépôt porteur.

## Pourquoi deux chartes et pas quarante

Le catalogue compte 40 produits, tous « décrits ». Deux ont un dépôt qui avance et un ADR qui les sort du gel. Écrire quarante chartes avant la première preuve, c'est écrire quarante intentions de plus. Écrire les deux chartes des produits qui vont produire les premiers résultats, c'est donner au lecteur le seul endroit où la méthode va pouvoir se montrer en train de prouver : la page vision comptera `produits=40 decrits=38 prototypes=2` le jour où ces deux-là auront une release liée à son évidence, et ce compteur sera la proposition de valeur.

## Charte P15 — `signalement` (projets, tickets et support)

| Champ | Texte proposé | Source |
| --- | --- | --- |
| Valeur | Un signalement part d'où l'on est (formulaire, courriel, extension) et arrive là où l'équipe travaille, avec un reçu que l'émetteur peut vérifier. Capture et relais, pas un nouvel outil de tickets. | ADR-0042 §1 (« Capture & Relay »), ADR-0055 D1 |
| Pour qui | Une organisation qui reçoit des signalements de tiers (usagers, clients, habitants) et les traite dans des outils qu'elle a déjà. | ADR-0055 contexte (« v1.0 commercialisable ») |
| Critère de dégel (décrit → prototypé) | Un signalement réel, émis depuis une surface publique, relayé vers un connecteur réel, avec reçu de projection vérifiable, sur une release signée dont l'évidence est publiée. Les contrats publics (politique de routage, enveloppe de remise, reçu de projection, `ConnectorProfile`) verrouillés dans `schemas-and-contracts`. | ADR-0055 conséquences |
| Critère d'abandon | Aucune organisation n'a relayé un signalement réel à la deuxième release signée ; ou le relais exige un connecteur qui n'existe que par un service hébergé que Libre AI ne peut pas auto-héberger. | proposition |
| Ce qu'il ne fera pas | Un back-office de tickets (P15 est porté par un seul dépôt, qui ne remplace pas l'outil cible) ; une file de messages hébergée obligatoire ; une capture qui lit le navigateur de l'utilisateur au-delà de la page signalée. | ADR-0055 D2, I-32 |

## Charte P02 — `information-watch` (veille documentaire)

| Champ | Texte proposé | Source |
| --- | --- | --- |
| Valeur | Suivre des sources (flux, pages, documents) depuis son poste, lire hors ligne ce qu'on a conservé, sans qu'aucun serveur tiers ne sache ce qu'on lit. Un serveur Rust, trois surfaces (web PWA, application macOS Tauri 2, extension navigateur sans accès réseau). | ADR-0054 §1, §3 |
| Pour qui | Une personne ou une organisation qui veille des sources et veut la garder chez elle ; en second, les organisations qui préfèrent l'offre hébergée payante, sans donnée de paiement dans l'application. | ADR-0054 §4 |
| Critère de dégel (décrit → prototypé) | Les trois surfaces construites sur le même cœur et la même API, avec les preuves par surface d'ADR-0054 §3 (Playwright trois navigateurs trois largeurs ; macOS : aucun port en écoute, signature et notarisation, mémoire résidente sous le seuil ; extension sur Chrome et Firefox réels), sur une release signée dont l'évidence est publiée. | ADR-0054 §3 |
| Critère d'abandon | Le parseur isolé par processus fils ne tient pas le seuil mémoire ou la latence fixés par la spécification sur un corpus réel ; ou l'offre hébergée exige une donnée que l'auto-hébergement ne peut pas garantir. | proposition, ADR-0054 P02-D5 |
| Ce qu'il ne fera pas | Parser des flux dans l'application macOS ou l'extension (elles délèguent à l'API) ; stocker une donnée de paiement ; mobile, Windows et Linux au premier palier ; dépendre d'un service managé pour le cœur. | ADR-0054 §3, §4 |

## Le champ `charte`, pour toute brique produit

Proposition de forme, à reprendre dans le schéma des briques de la page vision (E1 de la reprise du 2026-11-09, hors de ce dépôt tant que la pull request de schéma n'existe pas) :

~~~yaml
charte:
  valeur: <une phrase, verbe à l'indicatif, aucun adjectif d'appréciation>
  pour_qui: <le public, nommé>
  degel: <le fait observable qui fait passer de décrite à prototypée ; vérifiable par un tiers>
  abandon: <le fait observable qui retire la brique du catalogue>
  refus: [<ce que la brique ne fera pas>, ...]
~~~

Règles proposées pour le vérificateur de la page :

- une brique de couche `produit` sans `charte` complète est une erreur bloquante ; les autres couches n'en portent pas ;
- `degel` et `abandon` nomment un fait observable, jamais un délai ni un effort ; le vérificateur refuse les mots « bientôt », « rapidement », « jours », « semaines », « mois » ;
- `refus` compte au moins une entrée ; une brique qui ne refuse rien n'a pas de frontière ;
- le statut n'est jamais écrit dans la fiche : il se dérive des résultats (0 → décrite ; ≥ 1 release liée à son évidence → prototypée ; la règle d'« éprouvée » reste à fixer par le propriétaire) ; `degel` dit ce qu'il faut pour que le premier résultat existe, il ne le déclare pas.

## Ce qui est demandé au propriétaire

Rien n'est bloquant pour cette pull request. Les deux chartes deviennent vraies quand chaque dépôt porteur les reprend dans sa fiche ; le champ `charte` devient obligatoire quand le schéma des briques l'inclut. Les deux critères d'abandon sont des propositions de l'agent : ils n'ont aucune source dans la doctrine et c'est au propriétaire de les retenir, les remplacer ou les refuser.

## Ce que l'instrument exclut

Lecture des trois ADR seulement ; les fiches `project.v1.yaml` des deux dépôts porteurs, le design de `signalement` et la spécification de P02 n'ont pas été relus dans cette session. Si l'un d'eux contredit une ligne ci-dessus, c'est lui qui a raison.
