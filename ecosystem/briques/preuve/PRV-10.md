# PRV-10 — Signature des modèles

## Contexte

Aucun invariant du registre ne lie la brique. ADR-0063, encore proposé, range l'admission des modèles par gate, signature comprise, parmi ce qu'il ne décide pas et l'attribue à un ADR candidat distinct. I-10 pose une règle voisine pour les seules exportations, qu'il veut authentifiées « par AEAD ou par signature, jamais par un digest nu » ; il n'est pas cité. La brique dépend de PRV-03 : sans mécanisme de signature et de vérification, elle n'a rien à appliquer aux poids.

## Ce que la brique ferme

Aucune de ces fermetures n'est réalisée : la brique n'a ni dépôt porteur ni preuve.

- Les poids substitués entre leur éditeur et le poste : une empreinte publiée à côté du fichier ne prouve pas qui l'a publiée.
- Le modèle chargé avant vérification.
- Le modèle sans origine : un modèle non signé ne serait pas chargé.

## Ce qu'elle ne fait pas

- Elle ne juge pas le modèle : l'admission est GOV-04.
- Elle ne tient pas la liste des modèles : c'est PRV-09.
- Elle ne gère pas les clés de confiance : c'est PRV-04.

## Mesure

- Preuve citée : aucune. La seule décision citée est un ADR encore proposé. Dans les noms de fichiers des dépôts publics de l'inventaire, lus par l'API de la forge le 2026-11-11, aucun ne contient `weights`, `poids`, `safetensors` ni `gguf`.
- Prochain fait observable : un ADR accepté sur l'admission des modèles, puis un test où un fichier de poids à signature absente ou invalide est refusé avant chargement.
