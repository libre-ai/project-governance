# Outils d'écriture de flotte — le contrat

- **Portée :** ce que garantit tout outil de flotte **neuf ou modifié** qui
  écrit hors de sa propre sortie : sur la forge (branche, pull request,
  réglage, libellé), dans les fichiers d'un autre dépôt ou d'un checkout, dans
  un réglage. Huit règles numérotées et quatre codes de sortie. Méthode, pas
  doctrine : rien ici n'est un invariant, et un ADR qui tranche autrement
  prime. Les règles du dépôt restent celles d'`AGENTS.md` (« Validate every
  external input. Never log secrets, tokens or PII ») ; l'interdit des chemins
  de machine reste porté, pour tout l'arbre suivi, par
  `tools/quality/check-context-hygiene.sh`.
- **Statut :** proposé le 2026-11-17 ; la fusion de la pull request qui
  l'introduit l'inscrit dans la carte d'autorité (`docs/README.md`). Aucun
  outil n'est écrit ni modifié par ce document.

## Les huit règles

Un outil « écrit » dès qu'une de ses voies d'exécution émet une requête qui
change un état chez la forge, ou modifie un fichier qui n'est ni sa sortie
standard ni un artefact que son en-tête annonce.

### R1 — Lecture seule par défaut

Sans le drapeau d'application, l'outil n'émet aucune requête d'écriture et ne
modifie aucun fichier. Le drapeau est explicite et nommé dans l'usage ; la
présence d'un jeton, d'une variable d'environnement ou d'un fichier ne vaut
jamais drapeau. Un mode de simulation lancé sur une population vide ne modifie
rien non plus.

### R2 — Le mode lecture imprime la commande qui appliquerait

Quand le mode lecture constate qu'une écriture serait nécessaire, il imprime
la commande exacte qui l'appliquerait, arguments compris, prête à être
relancée. Dire qu'un drapeau existe ne suffit pas : l'opérateur ne reconstruit
pas la commande.

### R3 — Relecture après écriture

Après chaque écriture, l'outil relit l'état chez le serveur et le compare à ce
qu'il voulait écrire. Un refus silencieux, ou une écriture acceptée qui ne
change rien, est un échec (code 1). Le code de retour d'une requête d'écriture
n'est pas une relecture.

### R4 — Aucun secret dans la sortie

La sortie standard, la sortie d'erreur, tout résumé et tout journal ne portent
jamais de jeton ni de secret, y compris dans un message d'erreur relayé d'un
processus fils. Le jeton voyage par l'environnement du processus fils, jamais
sur une ligne de commande, dans une URL ou dans un fichier.

### R5 — Des compteurs qui somment

Un outil qui examine une population (dépôts, fichiers, libellés) imprime des
compteurs exclusifs dont la somme égale le nombre d'éléments examinés. L'outil
vérifie lui-même cette somme et échoue quand elle ne tient pas : un élément
qui n'entre dans aucun compteur n'a été ni traité ni déclaré.

### R6 — Entrées validées avant tout appel réseau

Chaque argument et chaque variable d'environnement lus sont validés avant le
premier appel réseau : forme attendue, appartenance à l'inventaire quand il y
en a un. Le chemin d'un projet, une référence ou un nom qui entre dans une URL
y est encodé.

### R7 — Ni chemin de machine ni hôte en dur

L'outil ne porte aucun chemin absolu de machine et aucun nom d'hôte de forge
en littéral. L'hôte vient de la configuration du client de forge ou de
l'environnement ; un chemin se résout depuis l'emplacement du module ou depuis
un argument.

### R8 — L'en-tête liste ce que l'outil écrit

Le commentaire d'en-tête de l'outil énumère tout ce qu'il écrit (requêtes,
branches, fichiers, résumés), et l'outil n'écrit rien d'autre. Une écriture
absente de l'en-tête est un défaut de l'outil, pas de sa documentation.

## Codes de sortie

| Code | Sens |
| --- | --- |
| 0 | Succès, ou lecture seule sans écart |
| 1 | Échec d'écriture ou invariant violé (relecture différente, compteurs qui ne somment pas, écart constaté en lecture) |
| 2 | Usage : argument manquant ou inconnu, outil requis absent |
| 3 | Source déclarée mais illisible, jamais traitée comme vide |

Une source illisible n'est ni un zéro ni un écart : elle a son code, pour
qu'un appelant distingue « rien à faire » de « rien n'a pu être lu ».

## État des outils en service

Relevé par lecture du code le 2026-11-17, sans lancer aucun outil ; à rejouer
avant de s'en servir. Une cellule vaut `conforme`, `écart` ou `sans objet`.

| Outil | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `tools/fleet/bump-generation.ts` | conforme | écart | écart | conforme | écart | conforme | écart | écart |
| `tools/fleet/sync-labels.ts` | conforme | sans objet | sans objet | conforme | conforme | conforme | conforme | conforme |
| `tools/presentation/heal-card-status.ts` | écart | écart | sans objet | sans objet | sans objet | sans objet | conforme | conforme |
| `tools/presentation/heal-org-readme.ts` | écart | écart | écart | conforme | sans objet | écart | écart | conforme |
| `tools/security/check-branch-protection.ts` | conforme | écart | écart | conforme | écart | conforme | conforme | conforme |

Chaque écart, nommé :

- **R2** · `tools/fleet/bump-generation.ts` : le plan ne cite le drapeau d'application que lorsque la cible n'est pas déclarée, pour dire qu'il serait refusé ; il n'imprime jamais la commande qui appliquerait.
- **R3** · `tools/fleet/bump-generation.ts` : après la poussée de la branche et l'ouverture de la pull request, l'outil se fie au code de retour des deux commandes et ne relit ni la branche ni la pull request.
- **R5** · `tools/fleet/bump-generation.ts` : la ligne de bilan imprime les compteurs par statut et le nombre de cibles, mais aucun contrôle ne refuse un bilan dont la somme ne tient pas.
- **R7** · `tools/fleet/bump-generation.ts` : l'URL de clonage des consommateurs et l'URL de l'archive de l'autorité portent le nom d'hôte de la forge en littéral.
- **R8** · `tools/fleet/bump-generation.ts` : l'en-tête dit que le mode par défaut n'écrit rien nulle part, alors que `--summary <fichier>` ajoute le plan à ce fichier dans les deux modes.
- **R1** · `tools/presentation/heal-card-status.ts` : sans drapeau, l'outil écrit la section d'état dans le README du checkout ; la lecture seule est l'option (`--check`), à l'inverse de la règle.
- **R2** · `tools/presentation/heal-card-status.ts` : en lecture seule, l'outil dit de relancer sans `--check` ; il n'imprime pas la commande complète.
- **R1** · `tools/presentation/heal-org-readme.ts` : la voie d'écriture s'ouvre par la seule présence du jeton dédié dans l'environnement, sans drapeau d'application.
- **R2** · `tools/presentation/heal-org-readme.ts` : sans jeton, la ligne « skipped » nomme le secret manquant et le fichier d'artefact, pas une commande qui appliquerait.
- **R3** · `tools/presentation/heal-org-readme.ts` : après le dépôt du fichier corrigé sur la branche et l'ouverture de la pull request, rien n'est relu.
- **R6** · `tools/presentation/heal-org-readme.ts` : l'adresse du run source et le répertoire de sortie sont lus de l'environnement sans validation, et l'adresse entre telle quelle dans le message de commit et le corps de la pull request.
- **R7** · `tools/presentation/heal-org-readme.ts` : l'adresse de la pull request existante et l'adresse de courriel de l'auteur du commit sont construites avec le nom d'hôte de la forge en littéral.
- **R2** · `tools/security/check-branch-protection.ts` : sans `--fix`, l'outil liste les écarts de protection sans imprimer la commande de correction.
- **R3** · `tools/security/check-branch-protection.ts` : après la modification des contrôles requis, l'outil annonce « fixed » d'après son propre plan, sans relire la protection.
- **R5** · `tools/security/check-branch-protection.ts` : le volume imprimé somme les check-runs, mais les dépôts ne sont pas répartis en compteurs exclusifs et aucune somme n'est vérifiée.

Les cellules `sans objet` tiennent à la nature de l'outil :
`tools/fleet/sync-labels.ts` refuse d'écrire, il n'a donc ni commande
d'application ni écriture à relire ; `tools/presentation/heal-card-status.ts`
édite un fichier local, sans réseau, sans jeton et sans population ;
`tools/presentation/heal-org-readme.ts` traite une paire fixe de fichiers,
chacun avec sa propre ligne de sortie.

Aucun des cinq outils ne rend le code 3 : une source illisible y sort en 1.

## Ce que ce document ne change pas

Les outils en service ne changent pas par ce document : leurs drapeaux, leurs
exports, leurs codes de sortie et leurs tests restent ceux d'aujourd'hui. Un
écart relevé dans la table est la dette d'un lot de code futur, un par outil,
chacun avec son propre test ; ce n'est pas une régression.

Le code 3 ne vaut que pour les outils neufs ou modifiés : un outil en service
garde 1 pour une source illisible jusqu'à sa migration.

Ce document n'inscrit aucun contrôle dans la chaîne `check` ni dans un
workflow, ne modifie pas `docs/decisions/INVARIANTS.md` et n'ajoute aucune
règle sur un journal d'audit local, sur la confirmation d'une opération
irréversible ou sur son retour arrière : aucun des cinq outils n'en a l'usage
aujourd'hui. Sa structure est verrouillée par
`tools/quality/fleet-write-tools-doc.test.ts`.
