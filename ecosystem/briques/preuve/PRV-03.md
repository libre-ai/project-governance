# PRV-03 — Signature des artefacts

## Contexte

I-20 parle de rapports d'évidence signés (ADR-0009 §7). I-10 refuse qu'une exportation remise à un tiers soit authentifiée par une empreinte nue. ADR-0042 §8 exige la signature et la notarisation de tout binaire distribué à un tiers (D57), et ADR-0057 §4 fixe les contrôles par release candidate (D98). Deux modules signent aujourd'hui des enregistrements de preuve : le paquet de provenance de `artifact-verification`, en Ed25519, et le signataire de `pi-evidence`. Aucun binaire de la flotte n'est signé ni notarisé.

## Ce que la brique ferme

- L'artefact remis à un tiers sans origine vérifiable : une empreinte prouve l'intégrité, pas l'auteur (I-10).
- L'enregistrement de preuve falsifié après coup : la vérification échoue fermée sur toute altération ou mauvaise clé.
- Le binaire distribué sans signature ni notarisation, qu'un tiers pourrait substituer (D57).

## Ce qu'elle ne fait pas

- Elle ne génère ni ne garde les clés : c'est PRV-04. Les deux modules reçoivent la clé de l'appelant.
- Elle ne décrit pas le contenu signé : le manifeste est PRV-02.
- Elle ne signe pas les poids d'un modèle : c'est PRV-10.

## Mesure

- Preuves citées : le module de signature et de vérification du paquet de provenance, et le module signataire de `pi-evidence`, épinglés chacun à un commit. Ils montrent que des enregistrements de preuve se signent et se vérifient. Ils ne montrent aucune release signée.
- Prochain fait observable : un binaire de release candidate qui passe `codesign --verify --strict` et `spctl --assess` sur un runner macOS, avec son ticket de notarisation.
