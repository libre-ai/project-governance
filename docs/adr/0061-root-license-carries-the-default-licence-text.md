<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0061 — Le fichier `LICENSE` racine porte le texte intégral de la licence par défaut du dépôt ; la différenciation vit dans `LICENSING.md` et `REUSE.toml`

- **Statut :** accepted — arbitrage du propriétaire du 2026-11-09 en chat ; option A retenue (texte intégral de la licence par défaut dans `LICENSE`), option D (texte et préambule) non mesurée et écartée. D4 (job de licence en check requis) a été exécuté par le propriétaire le 2026-11-09, avant cette acceptation : le ruleset `24161111` compte 7 contextes requis, dont `Licensing and contribution governance`.
- **Arbitrage :** Owner-arbitration: 2026-11-09 — question structurée en chat (ADR-0022/I-24) : « option A » ; ligne écrite par l'agent sur autorisation explicite du propriétaire le même jour. Rédigé par l'agent sur la consigne « go all » du 2026-11-09.
- **Date de rédaction :** 2026-11-09
- **Portée :** le fichier `LICENSE` à la racine de chaque dépôt actif de l'organisation, le job de licence de ce dépôt et le ruleset de sa branche servie. Ne modifie aucune licence : la licence par défaut de chaque dépôt reste celle que `LICENSING.md` et son `REUSE.toml` déclarent.
- **Précise :** I-11 (licences différenciées, DCO, conformité REUSE) : la conformité REUSE est nécessaire, elle n'est pas suffisante pour qu'une licence soit **détectée**. I-30 (trois actes de première publication) : le troisième acte, l'exposition publique, suppose un `LICENSE` racine détectable.
- **Ne modifie pas :** ADR-0038 (privé d'abord), la politique `LICENSING.md`, les `REUSE.toml` des dépôts, le choix EUPL / Apache / CC BY par classe de fichier.
- **Invariants :** aucun invariant modifié. Proposition, à consigner par le propriétaire s'il accepte : une ligne de précision sous I-30, « exposition publique refusée tant que la licence racine n'est pas détectée égale à la licence par défaut déclarée ».
- **Origine :** inspection, mesure du 2026-11-09 (`docs/reviews/root-licences-2026-11-09/REVIEW.md`).

## Contexte

`LICENSING.md:3-5` fait du `LICENSE` racine un « résumé lisible par un humain » et de SPDX + `REUSE.toml` l'autorité par fichier. La mesure du 2026-11-09 sur les 23 dépôts actifs donne : 6 dépôts dont la licence est détectée (4 EUPL-1.2, 2 Apache-2.0), 7 dépôts dont le `LICENSE` est un pointeur de 475 à 1158 octets et dont GitHub dit `NOASSERTION`, 10 dépôts sans fichier de licence à la racine (les textes vivent dans `LICENSES/`, conformément à REUSE, là où GitHub ne regarde pas). Ce dépôt même, qui porte la doctrine de licence, est dans les 7.

Le job `Licensing and contribution governance` existe et n'est pas un check requis du ruleset de la branche servie : un rouge n'y bloque rien. Aucun gate de flotte ne compare la licence détectée à la licence déclarée.

Le propriétaire a décidé le 2026-11-09 que la flotte reste privée d'abord (ADR-0038) et s'ouvre ensuite, en français puis en anglais. Un dépôt qui s'ouvre avec `NOASSERTION` publie du code dont personne ne peut dire la licence sans lire une politique interne. C'est un défaut d'I-11 en pratique, pas en droit, et il est détectable avant l'acte.

## Options examinées

| Option | Ce qu'elle donne | Verdict |
| --- | --- | --- |
| A. `LICENSE` racine = texte intégral de la licence par défaut ; `LICENSING.md` porte la différenciation ; `REUSE.toml` reste l'autorité par fichier | détection correcte partout (c'est la forme des 4 dépôts EUPL déjà détectés) ; REUSE reste conforme (le texte racine est aussi dans `LICENSES/`) | **retenue** |
| B. Pointeur conservé, badge de licence ajouté au README | le badge est déclaratif, GitHub dit toujours `NOASSERTION`, les scanners aussi | écartée |
| C. `LICENSES/` seul, sans fichier racine | conforme REUSE, détecté par rien | écartée (c'est l'état de 10 dépôts) |
| D. `LICENSE` racine = texte intégral + en-tête d'une ligne « d'autres licences s'appliquent à des fichiers, voir LICENSING.md » | détection probable mais non mesurée : un préambule peut faire basculer la détection en `NOASSERTION` | écartée faute de mesure ; à remesurer si A s'avère insuffisant pour la lisibilité |

## Décision proposée

- **D1.** Chaque dépôt actif porte à sa racine un fichier `LICENSE` qui est le texte intégral de sa licence par défaut, telle que déclarée par son `REUSE.toml` (ou, à défaut, par `LICENSING.md`). Pour les dépôts dont le code de première partie est sous EUPL-1.2, c'est le texte de l'EUPL-1.2 (13792 octets dans sa forme déjà présente sur 4 dépôts). Pour les dépôts d'outillage sous Apache-2.0, le texte de l'Apache-2.0.
- **D2.** La différenciation par classe de fichier (EUPL / Apache / CC BY) reste écrite dans `LICENSING.md` et appliquée par `REUSE.toml` ; le `LICENSE` racine ne la résume plus. La phrase « the root `LICENSE` is only a human-readable summary » de `LICENSING.md` est remplacée par « the root `LICENSE` is the full text of the repository's default licence ; per-file licences are declared by `REUSE.toml` ».
- **D3.** Un gate de flotte, `check-root-license`, est ajouté à l'outillage de ce dépôt : pour chaque dépôt actif de l'inventaire, il lit la licence détectée (`repos/{owner}/{repo}/license`) et la licence par défaut déclarée ; `ABSENT`, `NOASSERTION` et toute inégalité sont des échecs nommés ; il imprime ses compteurs, qui somment (`depots=N detectes=N declares=N egaux=N ecarts=N`), et échoue sur une source illisible au lieu de la compter zéro. Il s'écrit avec ses cas rouges rejoués contre un mutant, comme les autres gates de ce dépôt.
- **D4.** Le job `Licensing and contribution governance` devient un check requis du ruleset de la branche servie. C'est un acte du propriétaire (ruleset) ; la commande est donnée en conséquence.
- **D5.** L'exposition publique d'un dépôt (I-30, troisième acte) est refusée tant que `check-root-license` est rouge pour ce dépôt.

## Ce qui n'est pas décidé ici

- La licence par défaut de chaque dépôt : elle reste celle que déclarent `LICENSING.md` et `REUSE.toml`. Si un dépôt n'en déclare aucune, c'est un échec de D3, pas une décision prise ici.
- La forme exacte du gate (TypeScript sous `tools/quality/`, inventaire lu depuis `ecosystem/`) : une pull request distincte, avec ses tests.
- L'option D (texte intégral avec préambule), non mesurée.

## Conséquences

- 17 dépôts changent de fichier racine (7 pointeurs remplacés, 10 fichiers créés) : une pull request par dépôt, docs seulement, porte à deux sens.
- `LICENSING.md` change une phrase dans ce dépôt.
- La CI de ce dépôt gagne un check requis ; une PR qui casse la conformité REUSE ne fusionne plus.
- Aucun changement de licence effective pour aucun fichier.

## Acte du propriétaire, prêt à lancer

Ajouter le job de licence aux checks requis du ruleset `24161111`, après lecture de son état courant :

~~~sh
gh api repos/libre-ai/project-governance/rulesets/24161111 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
# puis, le contexte exact du job étant « Licensing and contribution governance » :
gh api -X PUT repos/libre-ai/project-governance/rulesets/24161111 --input ruleset.json
~~~

`ruleset.json` est le ruleset courant (`gh api repos/libre-ai/project-governance/rulesets/24161111 > ruleset.json`) auquel on ajoute `{"context": "Licensing and contribution governance"}` dans `required_status_checks`. Retour arrière : le même PUT avec le fichier d'origine, conservé.

## Retour arrière

Porte à deux sens : annuler la fusion de cette pull request rend l'état antérieur. Les pull requests par dépôt (D1) sont chacune réversibles par revert.
