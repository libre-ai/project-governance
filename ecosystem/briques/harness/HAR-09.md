# HAR-09 — Moteur natif commun

## Contexte

ADR-0034 borne un graphe d'exécution autorisé, séquentiel et acyclique (D40). ADR-0037 en autorise le cœur natif (D43) : un crate Rust pur, sans entrée ni sortie, qui rejoue les sémantiques verrouillées à partir d'observations brutes, sans dépendance à un framework d'agent (D6). I-06 destine Rust aux moteurs spécialisés. Ce cœur vit dans `execution-continuity-evaluator`. ADR-0058, en vigueur, admet LangGraph JS comme runtime interne d'un worker TypeScript. ADR-0063, proposé, le renverserait et étendrait la règle : Rust partout où du contenu est traité, moteur de la fabrique et du harnais compris. Tant qu'il n'est pas accepté, le moteur commun reste une intention. ADR-0037 dit appliquer I-08 ; cet invariant porte sur la fiche de projet et sur le verrou des contrats, pas sur un moteur : il est voisin et n'est pas cité.

## Ce que la brique ferme

- Un worker qui choisit la prochaine étape : dans le module cité, seul le couple d'une étape et d'une issue fermée sélectionne une transition (ADR-0034 D1).
- Une sémantique des contrats réinterprétée par le cœur : le test rejoue en Rust chaque cas du document de vecteurs et compare le résultat à l'attendu littéral (ADR-0037 D3).
- Une réémission aveugle après un état d'effet inconnu, barrière de continuité pour le cœur (ADR-0037 D4) : parmi les cas rejoués, celui de l'état d'effet inconnu rend son code fermé.

## Ce qu'elle ne fait pas

- Elle ne définit pas les contrats qu'elle exécute. Sans HAR-10, elle n'a pas de sémantique verrouillée à rejouer.
- Elle n'ouvre ni persistance, ni réseau, ni effet réel, ni mission réelle (ADR-0037).
- Elle ne confine rien : l'exécution d'un worker relève de EXE-01.

## Mesure

Preuves citées : le module de graphe du cœur et son test de vecteurs, dans `execution-continuity-evaluator`. Pour cette brique, le module montre une pièce du moteur écrite en Rust, dont les imports se limitent à la bibliothèque standard, au registre de contrats embarqué et à la désérialisation. Le test rejoue les cas sémantiques des contrats, 54 selon ADR-0037 D3 et selon l'assertion du test.

Faits attendus, non montrés : un même moteur pour la fabrique et le harnais, qui est l'objet de la brique et que cette fiche ne cite réalisé nulle part ; l'absence de tout framework d'agent dans le crate entier, qu'ADR-0037 D6 exige et qu'un fichier seul ne prouve pas.

Prochaine preuve : une mission de Work Supervision dont les transitions sont décidées par ce cœur.
