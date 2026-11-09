<!-- SPDX-FileCopyrightText: 2026 Libre AI contributors -->
<!-- SPDX-License-Identifier: CC-BY-4.0 -->
# ADR-0064 — Carte des briques : onze couches, un schéma de brique, un vérificateur, un statut dérivé des preuves ; les quarante produits sont des briques

- **Statut :** proposé — l'acceptation est un acte du propriétaire : il ajoute la ligne d'arbitrage datée et fait passer ce statut de proposé à en vigueur dans la pull request qu'il fusionne. Tant que ces deux lignes n'ont pas changé, l'ADR n'est pas en vigueur, fusionné ou non.
- **Arbitrage :** aucun à ce jour sur le fond. Trois choix de forme ont été pris par le propriétaire le 2026-11-09 par questions structurées en chat et sont repris ici sans réinterprétation : écrire cet ADR en premier avec la pile puriste (« 0066 + 0063 d'abord » ; le candidat 0066 de la vision complète porte ici le numéro 0064, suivant de la série) ; données des briques = « un fichier YAML par couche sous `ecosystem/briques/` + une fiche Markdown par brique » ; plateformes = « macOS d'abord, Linux au second palier avec déclencheur écrit » ; première preuve = « P02 information-watch ».
- **Date de rédaction :** 2026-11-09
- **Portée :** la représentation de la vision Libre AI en briques : couches, dépendances, schéma, données, vérificateur, statut, page générée. Ne crée aucun dépôt, n'active aucun produit, ne modifie aucun contrat canonique.
- **Amende :** ADR-0042 §1 (le catalogue d'applications) : les 40 produits P01 à P40 deviennent des briques de la couche `produit`, chacune avec une fiche et une charte ; le catalogue d'ADR-0042 reste la source de leur liste et de leur gel, la carte en est la projection vérifiée. ADR-0042 §8 (premier palier : macOS) : le palier Linux est nommé comme second palier, avec son déclencheur (D7).
- **Étend :** ADR-0009 (portefeuille et preuve : fiche `project.v1.yaml` par dépôt) — la fiche de dépôt reste ; la fiche de brique s'y ajoute et la cite. I-14 (portefeuille par couches, aucun décompte codé en dur) : les comptes de la carte sont dérivés. I-05 (la projection est l'artefact généré) : la page vision est une projection.
- **Applique :** I-05, I-08 (discipline de preuve), I-13 (la méthode est le produit zéro), I-14, I-20 (évidence publique), I-24 (restitution au point de décision), I-33 (origine déclarée, ADR-0056/0059).
- **Invariants :** aucun invariant modifié. Proposition à consigner par le propriétaire s'il accepte : une précision sous I-14, « les compteurs du portefeuille sont dérivés des données de briques par le vérificateur, jamais saisis ».
- **Origine :** inspection — vision complète du 2026-11-09 (document d'analyse hors dépôt : 11 couches, 135 briques, dont 83 dérivées par inspection d'une source externe et 52 propres) ; chartes de P15 et P02 (`docs/reviews/product-charters-2026-11-09/REVIEW.md`).

## Contexte

La vision Libre AI vit aujourd'hui en trois endroits qui ne se vérifient pas entre eux : `vision.md` (périmé, lu « sous les amendements » depuis #175), le catalogue d'ADR-0042 §1 (40 produits, en prose), et les fiches `project.v1.yaml` des 23 dépôts (état par dépôt, agrégé par les gates de flotte). Aucun ne dit **de quoi la méthode est faite** : quelles briques existent, de quoi chacune dépend, laquelle est prouvée, laquelle est une intention. Le tri du 2026-11-09 l'a mesuré autrement : 16 ADR fusionnés restaient `proposed` parce que rien ne dérivait leur statut d'un fait.

La vision complète du 2026-11-09 propose la forme qui manque : des **briques** typées, rangées en **couches** dont les dépendances sont des règles vérifiées, avec un **statut dérivé** des preuves et jamais saisi, et une **page vision générée** depuis ces données. Elle a été construite par inspection d'une vision externe (89 briques en 9 couches), dont elle reprend la forme et jamais le contenu ni les chiffres (ADR-0056 : origine déclarée). Elle ajoute deux couches qui n'ont de sens que pour un commun : `publication` et `produit`.

Ce que cet ADR décide, c'est la forme. Les 135 briques elles-mêmes sont des **données** à écrire brique par brique, chacune relue depuis la doctrine Libre AI (I-xx, ADR, dépôts) ; leur écriture est la vague V0, pas cet ADR.

## Décision proposée

- **D1. Onze couches, et leurs dépendances sont des règles.** `gouvernance`, `fabrique`, `harness`, `identité`, `passerelle`, `exécution`, `preuve`, `plateforme`, `exploitation`, `publication`, `produit`. La table ci-dessous est normative ; le vérificateur refuse toute dépendance qu'elle n'admet pas.

  | Couche | Rôle | Peut dépendre de | Règle propre |
  | --- | --- | --- | --- |
  | `gouvernance` | décider, admettre, retirer, rendre compte | aucune | seule couche sans dépendance ; toute autre brique cite au moins un invariant |
  | `fabrique` | de l'idée à la remise du code | gouvernance, harness, preuve | une brique fabrique déclare la preuve qu'elle produit |
  | `harness` | conduire les agents | gouvernance, identité, exécution | aucune brique harness ne lit du contenu hors `exécution` |
  | `identité` | qui agit, avec quel mandat | gouvernance | émet des jetons, n'en consomme jamais pour agir |
  | `passerelle` | plan de contrôle : classe, budget, routage, politique | identité, gouvernance | ne voit que des métadonnées typées |
  | `exécution` | plan de données confiné | passerelle, identité | tout ce qui traite du contenu est ici, et seulement ici |
  | `preuve` | journal, provenance, signature, menace, audit | identité | toute brique d'une autre couche écrit dans le journal |
  | `plateforme` | cœur Rust, coquilles, canaux, build, compatibilité, fin de vie, accessibilité | preuve, exécution | une coquille n'a pas de logique métier |
  | `exploitation` | observer, évaluer, mesurer, répéter, sortir | preuve, passerelle | toute mesure est reproductible par un tiers |
  | `publication` | page vision, catalogue, évidence publique, site, contributions | preuve, gouvernance | ne publie que des faits dérivés, jamais saisis |
  | `produit` | P01 à P40 | plateforme, passerelle, exécution, identité | jamais dépendance d'une brique de méthode |

- **D2. Un schéma de brique, en données.** Chaque brique porte : `id` (préfixe de couche + numéro, `GOV-01`, `PRD-02`…), `couche`, `nom`, `role` (une phrase), `depend_de` (ids), `invariants` (I-xx cités, au moins un hors `gouvernance`), `decisions` (ADR ou D-xx), `depots` (dépôts porteurs, ids d'`ecosystem/repositories.v1.yaml`), `origine` (`inspection` avec la source nommée, `observed` daté, ou `propre`), `autonomie` (`discover`, `modify` ou `govern` : ce qu'un agent peut faire seul sur cette brique), `preuve` (liste de preuves datées : chemin vers un artefact du dépôt porteur, ou une release liée à son évidence), `charte` (pour la couche `produit` : valeur, pour qui, dégel, abandon, refus — champ proposé par la revue des chartes), `jetable` (facultatif : `until=<condition>`, pour une brique transitoire). Le schéma est un contrat versionné (`brique.v1`) dans `libre-ai/schemas-and-contracts`, avec ses vecteurs valides et invalides ; sa première version est écrite par la pull request d'implémentation, pas ici.
- **D3. Données : un fichier YAML par couche, une fiche Markdown par brique.** `ecosystem/briques/<couche>.v1.yaml` porte les champs typés de toutes les briques de la couche ; `ecosystem/briques/<couche>/<id>.md` porte la fiche lisible (contexte, ce que la brique ferme, ce qu'elle ne fait pas, mesure). Le YAML est la source pour le vérificateur et la page ; la fiche est la source pour le lecteur ; le vérificateur refuse une brique présente dans l'un et absente de l'autre.
- **D4. Le statut est dérivé, jamais saisi.** Quatre valeurs, calculées par le vérificateur : `decrite` (fiche et YAML présents, aucune preuve), `en_cours` (au moins une preuve datée dont la cible existe, aucune release), `prototypee` (une release signée du dépôt porteur liée à son évidence publiée, retour arrière nommé), `retiree` (fiche conservée, `jetable` échu ou retrait par D-xx). Aucun champ `statut` n'existe dans le YAML ; un tel champ est une violation.
- **D5. Un vérificateur, gate de flotte.** `ecosystem/check-briques.ts` lit les onze YAML et les fiches, vérifie le schéma, les règles de dépendance de D1, l'existence des dépôts et des preuves citées, la règle produit (une brique `produit` n'est la dépendance de rien), et imprime ses compteurs : briques lues par couche, preuves résolues, violations nommées (règle, brique, invariant). Une source déclarée et illisible est un échec, jamais un zéro. Il est requis dès qu'une brique existe en données.
- **D6. La page vision est générée.** `distribution/vision/` est produite par un générateur qui lit les seules sorties du vérificateur : graphe des couches, fiches, compteurs par statut. Rien n'y est saisi ; `vision.md` est remplacé par un renvoi vers la page le jour où elle existe, et son texte est archivé. Français d'abord, anglais à l'ouverture publique (décision du propriétaire du 2026-11-09) ; publication privée d'abord sous ADR-0038.
- **D7. Plateformes : macOS d'abord, Linux au second palier avec déclencheur écrit.** Le premier palier reste macOS (ADR-0042 §8, Tauri 2 par ADR-0057). Le second palier est Linux (coquille Tauri 2 sur WebKitGTK, paquet Flatpak). Son déclencheur, à écrire dans la charte de chaque produit : **un produit ouvre son palier Linux quand il est `prototypee` sur macOS et que sa matrice de parité (I-27) est verte pour macOS**. Aucun produit n'ouvre Linux avant ; aucun produit ne saute macOS.
- **D8. Première preuve : P02.** La première brique `produit` qui doit atteindre `prototypee` est `PRD-02` (`information-watch`), sous la pile d'ADR-0063 ; P15 (`signalement`) est la seconde. Le compteur « produits prototypés » vaut 0 aujourd'hui et ne bouge qu'à cette preuve.

## Ce qui n'est pas décidé ici

- Le contenu des 135 fiches : écrit brique par brique à la vague V0, chacune relue depuis la doctrine Libre AI, jamais recopiée d'une source externe.
- Les identifiants définitifs des briques (le LEXICON les fixe) et le découpage fin de la couche `produit` au-delà des 40 produits du catalogue.
- La forme du générateur de page (langage, gabarit) au-delà de « lit les sorties du vérificateur » : pull request d'implémentation, sous ADR-0063 (outillage sous Bun admis).
- Les classes de données et les zones, l'admission des modèles, la forge substituable : trois ADR candidats distincts, nommés par la vision complète.
- Le sort de `vision.md` entre aujourd'hui et la page générée : il reste lu « sous les amendements » (#175).

## Conséquences

- Si accepté : ADR-0042 reçoit « Amendé par : ADR-0064 » sur sa ligne de statut ; une pull request d'implémentation écrit `brique.v1` (contrats), `ecosystem/briques/` (données, en commençant par les couches `gouvernance`, `preuve`, `fabrique`, `publication` et `produit`), `ecosystem/check-briques.ts` et son test (preuve de discrimination : une brique `produit` déclarée dépendance d'une brique `harness` rougit ; un champ `statut` rougit ; une preuve dont la cible n'existe pas rougit) ; le générateur de page vient ensuite. Les chartes de P15 et P02 (revue du 2026-11-09) deviennent les deux premières fiches `produit`.
- Si renversé : la vision reste en prose dans ADR-0042 et `vision.md`, et le tri des ADR se refait à la main.
- Coût assumé : 135 fiches à écrire et à relire ; c'est le travail de la vision, pas un surcoût de la méthode. Les comptes de la vision complète (135, 83, 52) ne sont pas repris ici comme faits : ils deviennent des compteurs du vérificateur ou disparaissent.

## Retour arrière

Porte à deux sens : annuler la fusion rend l'état antérieur. Les données de briques sont des fichiers ajoutés, supprimables sans effet sur un autre gate tant que `check-briques` n'est pas requis ; le rendre requis est un acte du propriétaire (ruleset), postérieur à la première donnée.
