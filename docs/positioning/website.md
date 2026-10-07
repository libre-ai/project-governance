# Positionnement du site public

**Autorité :** décision produit du 2026-07-12, positionnement validé le 2026-07-14.
**Portée :** mission éditoriale et frontières du site public. La cible technique est
tenue par [I-06](../decisions/INVARIANTS.md) et [ADR-0001](../adr/0001-bun-fullstack-rust-specialized-big-bang.md),
pas par ce document.

Ce document est l'extraction du positionnement encore en vigueur porté par la cible
`Website` de 2026-07-12, avant l'oubli de l'arbre d'entrées dont il provenait
(voir [`ecosystem/FORGOTTEN.yaml`](../../ecosystem/FORGOTTEN.yaml), entrée
`forgotten.website-cdc-bmad`). Toute évolution passe par une décision propriétaire,
pas par une édition d'opportunité.

## Hypothèse de conception

Le site décrit honnêtement l'état courant des produits au lieu de projeter une
disponibilité finale. Un produit peut être `discovery`, `private-alpha`,
`public-alpha` ou `stable`. Seuls les deux derniers états peuvent exposer une URL
applicative, et uniquement avec une preuve datée et une attestation propre au produit.

## Mission

Libre AI aide chacun à comprendre, choisir et utiliser l'intelligence artificielle sans
subir les discours marketing ni les dépendances irréversibles. Elle enseigne, oriente et
construit des produits vérifiables, accessibles et résilients.

La souveraineté n'est jamais présentée comme un état absolu. Elle est l'effet toujours
partiel d'une résilience opérationnelle démontrée : comprendre, remplacer, exporter,
restaurer et continuer à agir en mode dégradé.

## Public servi

Le site s'adresse au grand public. Il doit rester utile à plusieurs niveaux de maîtrise
sans mélanger leurs parcours :

- **comprendre** sans jargon ni prérequis ;
- **apprendre** grâce à des ressources progressives ;
- **agir** en découvrant un produit ou une pratique adaptée ;
- **vérifier** les sources, méthodes, limites et corrections ;
- **contribuer** à un collectif ouvert lorsque son cadre sera prêt.

## Expérience canonique

Une personne qui ne connaît pas Libre AI doit pouvoir :

1. comprendre sa mission et son exigence de vérité ;
2. comprendre la mission, l'état public, la frontière et les limites de chaque produit ;
3. identifier le produit ou la ressource adapté à son besoin ;
4. consulter les preuves et limites associées ;
5. poursuivre vers le produit ou le site spécialisé sans compte obligatoire.

## Responsabilité éditoriale

Le site possède :

- les pages institutionnelles : mission, résilience, méthode, gouvernance, corrections
  et contribution ;
- la présentation honnête des produits publics ;
- des ressources éditoriales revues ;
- les annonces institutionnelles et sorties produit.

Le site ne possède pas :

- les cours interactifs, exercices, mini-jeux ou progressions, qui appartiennent à
  **Practices** ;
- les sessions collectives, qui appartiennent à **Sessions** ;
- un annuaire de logiciels, un wiki technique ou des tutoriels d'exploitation par outil ;
- une veille exhaustive ou un observatoire d'incidents ;
- l'orchestration, l'inspection ou la distribution des autres produits ;
- un CMS, un compte utilisateur ou une collecte comportementale par défaut.

## Ligne éditoriale

Le site publie peu et répond à une décision réelle. Une ressource doit aider une personne à :

1. comprendre un mécanisme ou une controverse ;
2. comparer des options selon des critères explicites ;
3. décider sans déléguer son jugement ;
4. vérifier les preuves, limites et corrections.

Les unités éditoriales admises sont :

- **explication** — rendre un mécanisme compréhensible sans simplification trompeuse ;
- **guide de décision** — comparer des options sans transformer une préférence en vérité
  universelle ;
- **rapport de preuve** — publier un protocole, un résultat reproductible et ses limites ;
- **position** — assumer une recommandation normative, clairement séparée des faits ;
- **correction** — rendre une erreur et sa réparation visibles.

Un contenu n'est pas commandé parce qu'un outil, une actualité ou un dépôt existe. Il
part d'une question durable pour le public. Les pages produit expliquent un problème, une
disponibilité, des frontières et des preuves ; elles ne servent pas de vitrine à chaque
dépôt.

## Exigence de vérité

« Ne jamais accepter le mensonge » signifie : ne jamais masquer une incertitude,
présenter une hypothèse comme un fait, fabriquer une preuve ou laisser persister
silencieusement une erreur connue.

Chaque ressource publiée doit :

- déclarer sa nature : fait documenté, analyse, opinion ou guide ;
- identifier un auteur humain responsable ;
- déclarer l'assistance IA utilisée pour sa préparation ou sa révision ;
- rattacher les affirmations importantes à leurs sources ;
- expliciter la méthode de tout chiffre ou graphique ;
- porter une date de dernière revue ;
- rendre les corrections visibles ;
- échouer à la validation plutôt que recevoir une valeur inventée par défaut.

## Distribution mobile

La distribution mobile est une cible produit, pas une affirmation de disponibilité. Elle
devient publiable uniquement lorsque la matrice de preuve couvre au minimum : navigation
et lecture hors ligne ; cycle de vie, veille et reprise ; retour système et liens
profonds ; VoiceOver et TalkBack ; permissions minimales ; contenu embarqué versionné et
vérifiable ; installation, mise à jour et rollback ; paquet signé et testé sur appareils
réels. Avant ces preuves, Android et iOS restent explicitement `experimental`.

## Règle d'arrêt

Un ajout est refusé s'il augmente le volume sans renforcer une décision du public, part
d'un outil plutôt que d'un besoin, introduit une affirmation invérifiable, duplique un
autre produit ou rend le site dépendant d'un service non remplaçable.

## Ce qui n'est délibérément pas repris

La cible d'origine portait une section technique — implémentation Dioxus, primitives
d'un kit client retiré, contraintes de publication statique associées. Elle est morte et
n'est pas extraite : la stack web est fixée par I-06 (Bun fullstack, TypeScript strict,
React 19) et le site vit dans le dépôt `libre-ai/website` ([ADR-0008](../adr/0008-multi-repo-target-topology-and-brand.md), activé par ADR-0020).
Le décompte de produits qu'elle figeait n'est pas repris non plus : la carte canonique
est tenue par [`docs/decisions/LEXICON.md`](../decisions/LEXICON.md) §2.
