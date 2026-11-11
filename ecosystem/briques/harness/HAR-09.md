# HAR-09 — Moteur natif commun

## Contexte

ADR-0034 borne un graphe d'exécution autorisé, séquentiel et acyclique. ADR-0037 en autorise le cœur natif : un crate Rust pur, sans entrée ni sortie, qui rejoue les sémantiques verrouillées à partir d'observations brutes. Ce cœur vit dans `execution-continuity-evaluator`. ADR-0063, proposé, étend la règle : Rust partout où du contenu est traité, moteur de la fabrique et du harnais compris, et aucun framework d'agent comme runtime servi. Le cœur de Work Supervision est un second programme Rust.

## Ce que la brique ferme

- Un worker qui choisit la prochaine étape, alors que seul un résultat fermé sélectionne une transition (ADR-0037).
- Une réémission aveugle après un état d'effet inconnu, barrière de continuité pour le cœur (ADR-0037 D4).
- Un framework d'agent devenu spécification implicite, exclu par ADR-0037 D6.
- Deux moteurs qui interprètent différemment les mêmes contrats, l'un pour la fabrique, l'autre pour le harnais.

## Ce qu'elle ne fait pas

- Elle ne définit pas les contrats qu'elle exécute : ils relèvent de HAR-10.
- Elle n'ouvre ni persistance, ni réseau, ni effet réel, ni mission réelle (ADR-0037).
- Elle ne confine rien : l'exécution d'un worker relève de EXE-01.

## Mesure

Preuves citées : le module de graphe du cœur et son test de vecteurs, dans `execution-continuity-evaluator`. Le test rejoue en Rust les cas sémantiques des contrats, 54 selon ADR-0037 D3. Il ne montre pas un moteur partagé avec la fabrique.

Prochaine preuve : une mission de Work Supervision dont les transitions sont décidées par ce cœur.
