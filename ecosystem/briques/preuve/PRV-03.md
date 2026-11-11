# PRV-03 — Signature des artefacts

## Contexte

I-20 veut des « rapports signés » ; sa source est ADR-0009 §7. ADR-0042 §8 exige la signature et la notarisation de tout binaire distribué à un tiers (D57). ADR-0057 §4 fixe les contrôles par release candidate : vérification de signature, évaluation par le système et ticket de notarisation (D98). Les deux modules cités signent des enregistrements de preuve. Le paquet de provenance de `artifact-verification` signe en Ed25519 un enregistrement de lignage. Le signataire de `pi-evidence` signe par `ssh-keygen`. La brique dépend de PRV-04 : sans clé gérée, elle n'a rien avec quoi signer. Le paquet de provenance reçoit sa clé en paramètre.

## Ce que la brique ferme

- L'enregistrement de preuve falsifié après coup : la vérification échoue fermée sur toute altération ou mauvaise clé.
- L'enregistrement sans origine vérifiable : une signature asymétrique prouve l'auteur, là où une empreinte ne prouve que l'intégrité.

## Ce qu'elle ne fait pas

- Elle ne signe ni ne notarise aucun binaire : cette part du rôle, exigée par D57, n'a pas de preuve.
- Elle ne génère ni ne garde les clés : c'est PRV-04.
- Elle ne décrit pas le contenu signé : le manifeste est PRV-02.
- Elle ne signe pas les poids d'un modèle : c'est PRV-10.

## Mesure

- Preuves citées : le module de signature et de vérification du paquet de provenance, et le module signataire de `pi-evidence`, épinglés chacun à un commit. Ils montrent que des enregistrements de preuve se signent et se vérifient. Ils ne montrent aucune release signée.
- Prochain fait observable : un binaire de release candidate qui passe `codesign --verify --strict` et `spctl --assess` sur un runner macOS, avec son ticket de notarisation.
