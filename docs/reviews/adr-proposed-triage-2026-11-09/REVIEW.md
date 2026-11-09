<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
Verdict: triage

# Tri des 16 ADR au statut `proposed` : ce qui les garde proposés, et ce qu'il faudrait pour les clore

**Date :** 2026-11-09
**Objet :** les 16 ADR de `docs/adr/` dont la ligne de statut dit « proposé », tous déjà fusionnés sur la branche servie `migrate/recover-code`.
**Nature :** lecture seule, par un sous-agent de tri (Claude Code), rapport rendu en texte puis recoupé au grep par l'orchestrateur. Aucun ADR n'est modifié ici : faire passer un statut est un acte du propriétaire (chemin gardé, ligne d'arbitrage requise par `tools/quality/check-doctrine-governance.sh`).
**Clone lu :** tête `8ecfd1b` de `migrate/recover-code`.

## Commandes

~~~sh
# les 16
for f in docs/adr/0*.md; do sed -n 1,15p "$f" | grep -qiE '(status|statut)[^a-z]*propos' && echo "$f"; done | wc -l
# dernier numéro et dernière décision
ls docs/adr | grep -E '^0[0-9]{3}-' | sort | tail -1
grep -oE '^\| D[0-9]+ ' docs/decisions/DECISION-REGISTER.md | tail -1
# commit d'ajout de chaque fichier
git log --diff-filter=A --format='%h %cs %s' -- <fichier>
~~~

Résultats au 2026-11-09 : 16 fichiers ; dernier numéro 0060 ; dernière décision D102. Les ADR 0033 à 0041 entrent par le commit `e8e3b51` du 2026-10-07 (#4) ; les suivants ont chacun leur pull request, de #12 à #158. Hypothèse : 0033 à 0040 avaient été fusionnés dans l'ancien dépôt `governance` avant cet import.

## Tableau

| ADR | Titre court | Ce qui le garde en `proposed`, dans son texte | Recommandation | Fait qui la fonde |
| --- | --- | --- | --- | --- |
| 0033 | Système de marque ouvert et vérifiable | « le merge signé sous I-17 reste l'acte d'adoption doctrinale » ; 5 points ouverts (licence de marque, contrôle de similarité, SVG, conformité à D4, avatar) | **clore tel quel** | les 5 points sont des conditions de publication du signe (D6 : quatre actions externes séparées), pas d'adoption de l'ADR, fusionné puis amendé par une PR fusionnée |
| 0035 | Autorisation de release locale au dépôt | « le merge de cet ADR est l'acte propriétaire qui répare la doctrine » | **clore tel quel** | la fusion est le seul acte attendu ; chaque release a son propre contrôle |
| 0038 | Première publication en deux frontières (I-30) | « la fusion constitue l'arbitrage » ; gate d'acceptation visant une exposition publique | **clore tel quel** | amendements D78 et D79 fusionnés avec `Owner-arbitration: 2026-10-14` ; le gate vise les publications, pas l'ADR |
| 0039 | Dépôt privé de recherche produit | « la fusion revue constitue la signature » ; sauvegarde et distant « restent à réaliser » | **clore tel quel** | le texte sépare lui-même ces faits d'exploitation de la ratification |
| 0040 | Persistance du contrôle de run de l'Orchestrator | « la fusion constitue l'arbitrage » ; gate d'acceptation en 11 points visant la tranche d'implémentation | **clore tel quel** | D6 : l'approbation de l'ADR ne vaut pas le prononcé de la tranche ; deux actes distincts |
| 0041 | Consolidation de l'autorité | « la fusion constitue l'arbitrage » ; le re-épinglage « exige que cette PR soit fusionnée d'abord » | **clore tel quel** | fusion faite (#4) ; tout le reste vient après, par le texte même |
| 0042 | Vision produit et méthode de réalisation | « la fusion constitue l'arbitrage » | **clore avec amendement** | ajouter en tête « Amendé par : ADR-0052, 0054, 0055, 0057 » ; sans cela, §8 (« application macOS native ») se lit comme en vigueur alors que D96 le remplace |
| 0043 | Branche de signature de doctrine et branches de session | « la fusion constitue l'arbitrage » ; retrait de `doctrine/owner-signature` renvoyé à « une décision distincte » | **clore avec amendement** | consigner D72 (retrait de la branche, de son ruleset `24725518` et de son exclusion, 2026-10-13), absent du texte ; la partie `work/**` reste en vigueur |
| 0044 | P04 : éditeur natif TextKit 2 et UniFFI | « la fusion constitue l'arbitrage » | **clore avec amendement** | marquer les décisions 1, 2 et 4 « amendées par ADR-0057 (D97) », la 3 « en vigueur » ; pas de retrait : un rouge à la qualification Tauri « retourne à ADR-0044 pour P04 » |
| 0047 | Specification Lock des vecteurs de liaison de décision | « l'arbitrage du 2026-10-13 vaut signature ; la fusion l'exécute » | **clore tel quel** | signature donnée, fusion faite (#83) |
| 0052 | Square Control : dépôt public, moratoire levé | « la fusion constitue l'arbitrage » | **clore tel quel** | la suite (staging, attestation, bascule) est décrite comme des actes postérieurs |
| 0054 | P02 v1 : surfaces, stack serveur, dépôt dédié | « la fusion vaut signature (ADR-0043) » | **clore tel quel** | seule condition écrite : la fusion, faite |
| 0055 | `signalement` sort du gel et porte P15 | « la ligne d'arbitrage daté est ajoutée par le propriétaire » | **clore avec amendement** | la ligne annoncée manque au fichier (`grep -c 'Owner-arbitration:'` : 0) ; hypothèse : elle est dans le corps de la PR #134 seulement |
| 0057 | Tauri 2, coquille macOS de tous les produits | « la fusion vaut signature (ADR-0043) » | **clore tel quel** | le propriétaire a levé lui-même la précondition (« go Tauri ») |
| 0058 | LangGraph JS, runtime des workers TS | « la fusion vaut signature (ADR-0043) » | **clore tel quel** | les gates à écrire vivent dans les dépôts consommateurs |
| 0060 | Gates exécutés depuis la PR : options mesurées | « aucune option n'est retenue ; le choix se fera par un ADR ultérieur » ; deux questions au propriétaire | **clore avec amendement** | l'ADR ultérieur n'existait pas (0060 dernier numéro, 0 D-xx le cite) : proposé comme ADR-0062 dans une PR voisine |

Compte : 16 = 11 « clore tel quel » + 5 « clore avec amendement » + 0 « retirer » + 0 « fusionner dans ».

## Ce que les 16 ont en commun

1. **Statut jamais remis à jour après la fusion** (15 sur 16). La ligne dit « la fusion constitue l'arbitrage » et la fusion a eu lieu. La formule, recopiée d'ADR en ADR depuis 0038, fait du statut un fait périmé par construction : il devient faux à la seconde où la PR fusionne. Les ADR 0045, 0046, 0048 à 0051, 0053, 0056 et 0059 sont au contraire écrits « accepted — en vigueur à la fusion » et ne posent pas ce problème. Hypothèse : différence de gabarit selon la date, aucune règle derrière.
2. **Le registre fige l'état « candidate »** : D44 et D45 portent encore « (candidate, owner signature by merge) ». Clore 0038 et 0040 demande la même retouche dans `docs/decisions/DECISION-REGISTER.md`.
3. **Conditions d'actes ultérieurs confondues avec des conditions d'acceptation** : 0033 (publication du signe), 0038 (bascule publique), 0039 (sauvegarde, distant), 0040 (merge de la tranche), 0052 (I-30). Le texte sépare les deux actes, la forme ne le montre pas.
4. **Amendements non reportés dans l'ADR amendé** : 0042 (par 0052, 0054, 0055, 0057), 0043 (par D72), 0044 (par 0057). Aucun champ « Amendé par ». Les ADR amendants étant eux-mêmes `proposed`, toute la chaîne P02 / P04 / Tauri reste au même statut.
5. **Décision renvoyée à un ADR jamais écrit** : 0060.
6. **Marqueur d'arbitrage absent du fichier** : 0055 l'annonce et ne le porte pas ; 0035 et 0040 datent d'avant le marqueur, leur arbitrage est en prose et dans D41, D45. Hypothèse : le gate `check-review-evidence` lit le marqueur dans le corps de la PR et non dans le fichier.
7. **Section « Ce qui n'est pas décidé ici » presque absente** : seul 0055 l'a. Ailleurs, le rôle est tenu par « N'autorise pas », « Conséquences et limites », « Ce qui reste ouvert », ce qui rend le tri coûteux.

## Ce que le tri propose, sans le décider

- **Une PR de clôture par le propriétaire**, ou par l'agent sur instruction explicite portant la ligne d'arbitrage : 11 statuts basculés tels quels, 5 avec l'amendement nommé, D44 et D45 retouchés. Le gate `check-doctrine-governance` exigera pour chaque ADR basculé une ligne « Arbitrage » et une citation I-## ou une ligne « No invariant » : à vérifier fichier par fichier avant de pousser.
- **Un gabarit d'ADR qui interdit « la fusion vaut signature » comme statut** : le statut est `proposed` ou `accepted`, et c'est le propriétaire qui le bascule dans la PR qu'il fusionne, en même temps qu'il ajoute la ligne d'arbitrage. Les ADR-0061 et 0062 (PR voisines) sont écrits dans cette forme.
- **Un champ « Amendé par » en tête de tout ADR amendé**, rempli par la PR qui amende : sans lui, le lecteur d'un ADR ne sait pas qu'il lit du périmé. Le même défaut touche `vision.md` (PR voisine).
- **Une section « Ce qui n'est pas décidé ici » obligatoire**, qui est aussi le seul endroit où une question laissée au propriétaire est visible. Une question ouverte sans porteur ni rappel est un garde-fou muet (0060 pendant seize jours).

## Ce que l'instrument exclut

Un seul lecteur (sous-agent), recoupé au grep sur les chiffres (16 fichiers, dernier numéro, dernière décision, 0 citation de 0060). Les hypothèses sont marquées comme telles. L'état des PR amont citées (#22 de `schemas-and-contracts`, #134) n'a pas été vérifié.
