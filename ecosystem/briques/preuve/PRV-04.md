# PRV-04 — Gestion des clés

## Contexte

I-09 fonde l'autorisation sur des jetons signés en Ed25519, et son verrou de spécification impose la rotation des clés de signature. ADR-0028 nomme le déclencheur de la cérémonie de clés : le prononcé du verrou de l'orchestrateur (D35). Ce dépôt porte le mode opératoire de la cérémonie et son outil, qui génère une paire Ed25519 et scelle la clé privée. Le registre de clés publiques prévu n'existe pas dans ce dépôt.

## Ce que la brique ferme

- La clé privée qui traverse un réseau ou entre dans un dépôt : elle est générée hors ligne et n'existe sur disque que scellée.
- La clé sans fin de vie : la rotation publie la clé suivante avant de retirer l'ancienne (I-09).
- La clé d'empreinte qui survit au run : I-33 la veut jamais transmise et détruite à sa fin.
- La mutation de couche 3 sans signature : I-18 l'exige, ce qui suppose une clé gérée.

## Ce qu'elle ne fait pas

- Elle ne signe rien elle-même : PRV-03 signe avec les clés qu'elle fournit.
- Elle ne remet aucun secret à un agent (PRV-11) et n'émet aucun jeton (IDN-02).
- Elle ne gère aucune clé de paiement : seulement des clés de signature.
- Un agent n'y écrit pas seul : générer, enregistrer ou retirer une clé est un acte du propriétaire.

## Mesure

- Preuve citée : l'outil de génération de la cérémonie, dans ce dépôt. Il montre une génération et un scellement écrits et testés. Il ne montre ni cérémonie tenue ni rotation.
- Prochain fait observable : une clé publique de production enregistrée dans ce dépôt par une pull request du propriétaire.
