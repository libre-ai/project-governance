# ADR-0021 — Qui porte l'état du monde : la demande de fusion, ou la flotte

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire, session du 2026-08-04 — les trois décisions
  (D1, D2, D3) sont retenues telles que proposées, séquencées D1 puis D2 ;
  l'alternative du `bun audit` bloquant généralisé reste écartée.
- **Date de rédaction :** 2026-08-04
- **Portée :** garde-fous de sécurité des dépendances — où s'observe une
  vulnérabilité publiée, et ce qu'elle bloque.
- **Étend :** I-17 (surface humaine fermée — établir ou muter un garde-fou est
  un acte propriétaire), ADR-0011 D4 (confiance graduée), `POLARIS.md`
  (gates d'orchestration).
- **N'amende aucun contrat verrouillé.**

## Contexte — un incident mesuré, pas une hypothèse

Le 2026-08-04, l'advisory `GHSA-7p8r-x3mc-p8w7` (high — confusion d'hôte via un
introducteur d'autorité en anti-slash) est publiée sur `fast-uri >=4.0.0
<4.1.2`. Trois faits sont établis par la mesure, non par le raisonnement :

1. **L'override de flotte épinglait `4.1.1`**, à l'intérieur de la plage
   vulnérable, dans **30 dépôts sur 31** portant un `package.json`. La
   dépendance est transitive, via `ajv`.
2. **Un seul dépôt — `governance` — exécute `bun audit` en intégration
   continue.** Les trente autres n'ont aucun contrôle qui regarde. La flotte a
   donc été alertée par le seul dépôt qui regardait ; ailleurs, le pin
   vulnérable était invisible à ses propres gates.
3. **Quatre demandes de fusion vertes la veille sont devenues rouges sans
   qu'un seul commit ait changé.** Leur contenu — deux d'entre elles ne
   touchaient que de la documentation — n'avait aucun rapport avec l'advisory.

Le troisième fait est celui qui pose la question de conception. Un contrôle qui
dépend d'un flux externe transforme l'état du monde en verdict sur un
changement. À l'échelle d'une flotte, une advisory sur une transitive commune
rougit simultanément toutes les demandes de fusion ouvertes, quel qu'en soit le
contenu.

L'incident a par ailleurs révélé un défaut voisin : la protection de `main` du
dépôt `notebook` exige un contexte de vérification nommé `Dependabot`, qui
n'existe que sur les demandes de fusion créées par Dependabot. Toute demande
humaine y est donc bloquée en permanence. C'est le même motif — un garde-fou
qui n'accomplit pas ce qu'il annonce — et il se corrige indépendamment de cet
ADR.

## Le point à trancher

**Qui porte la responsabilité de l'état du monde : la demande de fusion, ou la
flotte ?**

Aujourd'hui la réponse implicite est « la demande de fusion », et elle a deux
conséquences que l'incident rend visibles : une demande est jugée sur des faits
qu'elle n'a pas produits, et vingt-neuf dépôts sur trente ne portent aucun
jugement du tout.

## Décisions

### D1 — Un contrôle de flotte périodique porte l'état du monde

Un contrôle périodique, hébergé par `governance` aux côtés de l'outillage de
flotte existant, scanne les dépôts et **notifie** ; il ne bloque aucune
demande de fusion. C'est lui qui répond de ce qui a été publié après le dernier
changement d'un dépôt.

Il déclare ses cinq champs de boucle (`AGENTIC-LOOP-INVENTORY`), y compris
l'échec observable — **l'absence de ligne récente vaut échec**, au même titre
qu'une ligne rouge : un contrôle périodique muet est indiscernable d'un
contrôle qui n'a jamais tourné.

### D2 — Le gate par demande de fusion ne juge que ce que la demande introduit

`bun audit` reste exécuté par demande de fusion, mais son verdict porte sur la
**différence** : une advisory qui apparaît parce que le verrou de dépendances a
changé dans cette demande est bloquante ; une advisory déjà présente sur la
base ne l'est pas, elle appartient à D1.

Motif : une demande de fusion doit pouvoir être jugée sur son contenu. Une
demande de documentation rouge à cause d'une publication survenue pendant la
nuit n'apprend rien à son relecteur et enseigne à contourner le rouge — ce qui
coûte plus cher que l'advisory.

### D3 — La disponibilité du contrôle est une propriété de flotte

Trente dépôts sur trente et un n'exécutaient aucun audit. Que le verdict soit
bloquant (D2) ou informatif (D1), **le contrôle doit exister partout** ; son
absence est aujourd'hui indiscernable d'un résultat vert.

## Alternative écartée, et pourquoi elle est écartée

**Ajouter `bun audit` bloquant aux trente et un dépôts.** C'est la réponse
évidente, et elle échoue sur le fait 3 : elle généralise à toute la flotte le
comportement qui vient de rougir quatre demandes sans rapport. Chaque advisory
future sur une transitive commune arrêterait simultanément tout travail en
cours, sur trente et un dépôts, et le réflexe acquis serait de merger malgré le
rouge.

Elle restait défendable si l'arbitrage avait privilégié le fail-closed intégral
sur le coût de convoi. L'arbitrage du 2026-08-04 tranche l'inverse : une
demande de fusion est jugée sur son contenu, et l'état du monde appartient au
contrôle de flotte. Sa réintroduction exigerait un nouvel arbitrage sur pièce —
un cas mesuré où le partage D1/D2 aurait laissé passer ce que le blocage
intégral aurait retenu.

## Conséquences

- Un contrôle de flotte de plus, avec ses six champs de boucle déclarés
  (l'inventaire des boucles impose depuis le 2026-08-04 la nature de l'échec
  en sixième champ).
- Le gate par demande de fusion devient différentiel : plus complexe qu'un
  `bun audit` nu, et cette complexité est le prix de la propriété « une demande
  est jugée sur son contenu ».
- Le dépôt d'archive `libre-ai` reste porteur du pin vulnérable : il est en
  lecture seule sur la forge et ne peut pas être corrigé. Aucun contrôle ne
  doit le compter comme un rouge à traiter.
- Le registre des invariants gagne I-26 (backfill 2026-08-18, Domain I —
  Process & CI), sourcé par le présent ADR : D1/D2/D3 ci-dessus, sans
  reformulation.

Owner-arbitration: 2026-08-18

## Ce qui n'est pas décidé ici

- La correction de la protection de branche de `notebook` — réglée par un acte
  propriétaire distinct le même jour (retrait du contexte `Dependabot`, produit
  uniquement par les runs Dependabot Updates contre `main`, jamais sur une
  demande de fusion humaine ; vérifié par un scan des trente et une protections,
  seul cas de la flotte).
- Le choix de l'outil d'audit et sa cadence.
- Toute automatisation de mise à jour des dépendances.
