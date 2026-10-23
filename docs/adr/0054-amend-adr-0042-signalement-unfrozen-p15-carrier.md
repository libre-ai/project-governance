# ADR-0054 — Amendement d'ADR-0042 §1 : `signalement` sort du gel et porte P15

- **Statut :** proposed — la fusion de cette pull request par le propriétaire
  constitue l'arbitrage.
- **Arbitrage :** décisions du propriétaire du 2026-10-22 en chat, prises par
  questions structurées (ADR-0022/I-24) pendant la session de cadrage v1.0 de
  `signalement` : lever le gel de `signalement` ; faire de `signalement` le
  seul dépôt porteur de P15, `ai-work-supervision` restant la fabrique. La
  ligne d'arbitrage daté est ajoutée par le propriétaire, pas par l'agent.
- **Date :** 2026-10-23
- **Portée :** ADR-0042 §1, « Rattachements », premier point ; préambule
  « Autorise » d'ADR-0042.
- **Amende :** ADR-0042 §1 (gel de Capture & Relay jusqu'au jalon B′). Le reste
  d'ADR-0042 est inchangé : catalogue, ordre du §3, jalon B′ et moratoire de
  création de dépôt.
- **Décision :** D81 de `docs/decisions/DECISION-REGISTER.md`.
- **Applique :** I-03 (un sujet, une autorité), I-13 (la méthode est le produit
  zéro), I-14 (portefeuille par couches).

## Contexte

ADR-0042 §1 rattache Capture & Relay (`signalement`) à P15 et le gèle :

> Capture & Relay (`signalement`) est une capacité de **P15**. Sa qualification en
> cours est terminée et publiée, puis il est gelé : aucun nouveau lot avant le
> jalon B′.

Deux faits rendent ce point inapplicable en l'état.

1. Le propriétaire veut une v1.0 commercialisable de `signalement` sans
   attendre B′. Elle signale un problème depuis une interface web et l'envoie
   au bon système de tickets, sous une politique d'organisation. Le design
   est proposé dans `libre-ai/signalement`, pull request #22,
   `docs/superpowers/specs/2026-10-22-v1-policy-routed-ticket-projection-design.md`.
2. Le catalogue ne nomme aucun dépôt porteur pour P15 (« Projets tickets et
   support »). L'inventaire de la mission de spécifications du 2026-10-14 a
   relevé un recouvrement entre `signalement` (capture, Dossier, projections)
   et `ai-work-supervision` (missions). Aucun des deux dépôts ne nomme P15 :
   `grep -rlE '\bP15\b'` sur leurs clones ne trouve rien. La question de savoir
   quel dépôt porte P15 est restée ouverte.

## Décision

### D1 — `signalement` sort du gel

Le premier point des « Rattachements » d'ADR-0042 §1 devient :

> Capture & Relay (`signalement`) est le dépôt porteur de **P15** (projets,
> tickets et support). Il sort du gel : ses lots reprennent pour livrer la v1.0
> décrite dans son dépôt. Le moratoire de création de dépôt ne s'applique pas :
> le dépôt existe.

Le préambule « Autorise » d'ADR-0042 s'étend à « la sortie du gel de
`signalement` ».

### D2 — `signalement` est le seul dépôt porteur de P15

P15 n'est pas scindé. `ai-work-supervision` relève de la fabrique (produit
zéro, I-13), comme ADR-0042 §1 le dit déjà, et ne porte aucune application du
catalogue, P15 comprise. Les documents qui associent P15 à
`ai-work-supervision` sont corrigés dans ce dépôt, par sa propre pull
request.

## Conséquences

- Les lots de `signalement` reprennent. Le premier lot de code attend que ses
  contrats publics (politique de routage, enveloppe de remise, reçu de
  projection, `ConnectorProfile`) soient verrouillés dans
  `schemas-and-contracts`, conformément à son design.
- L'ordre de réalisation d'ADR-0042 §3 ne change pas : la fabrique et B′
  restent prioritaires. `signalement` avance en parallèle, sur son propre
  dépôt, sans créer de dépôt.
- La fiche `project.v1.yaml` de `signalement` reste la source de son état ;
  cette autorité ne déclare aucune maturité à sa place.

## Ce qui n'est pas décidé ici

- Le périmètre de la v1.0 de `signalement` : il vit dans son dépôt (design,
  décisions D1 à D13 du 2026-10-22/23).
- La levée du moratoire pour un autre domaine.
