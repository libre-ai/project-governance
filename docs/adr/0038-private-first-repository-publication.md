# ADR-0038 — Première publication d'un repository en deux frontières

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Introduit :** I-30
- **Amende :** ADR-0009 §9 — un distant privé temporaire de prépublication n'est pas encore un repository du portefeuille
- **Applique :** I-17 (actions human-touch), I-21 (zéro donnée personnelle dans Git) et I-12 (GitHub canonique sans dépendance de données irréversible)
- **Périmètre :** première exposition publique d'un nouveau repository Libre AI
- **N'autorise pas :** création distante, exposition publique, secret, donnée utilisateur, déploiement ou activation produit

## Contexte

Un scan du seul arbre courant ne protège pas contre un secret supprimé mais encore accessible, une identité personnelle dans un commit, un tag annoté oublié ou une branche supplémentaire. Un workflow déclenché après la première exposition arrive trop tard : rendre ensuite le repository privé ne retire pas les objets déjà copiés.

L'attestation ne peut pas non plus vivre uniquement dans le repository qu'elle atteste sans créer une récursion : ajouter l'attestation modifie sa pointe et son inventaire. Governance porte donc l'autorité et l'attestation externe ; le repository candidat porte les gates reproductibles.

## Décision

### D1 — Séparer création distante et exposition publique

Après signature propriétaire du nom et de l'enrôlement, un distant de staging est créé vide et **privé**. Cette création reste une action human-touch. Ce distant n'est pas encore un repository du portefeuille : il n'entre dans aucun inventaire, aucune exposition ou projection publique. Aucun import, README automatique, branche ou tag initial n'est accepté.

Le passage `private -> public` est une seconde action human-touch, interdite tant qu'une attestation privée exacte n'a pas été fusionnée dans Governance. Un échec conserve le repository privé. Il n'existe aucun rollback capable d'annuler une divulgation publique ; repasser privé n'est qu'une mitigation, suivie de rotation/révocation et traitement d'incident si nécessaire.

### D2 — Attester des refs complètes et des objets canoniques

L'ensemble autorisé est une liste triée de tous les noms complets `refs/...` annoncés ou accessibles, chacun associé à son OID final. Toute ref locale ou distante supplémentaire, quel que soit son namespace — notamment `refs/pull/*`, notes, remotes, replace ou namespaces fournisseur — refuse la transition. `HEAD` est vérifié séparément comme symref vers la branche autorisée ; les lignes de peel `^{}` ne sont pas des refs supplémentaires mais leur OID dérivé est vérifié.

Le manifeste canonique versionné conserve, pas seulement son digest :

- repository et version de schéma ;
- ensemble exact et trié `{ ref, oid }` ;
- ensemble exact et trié de tous les objets accessibles `{ oid, type, size }` ;
- digest SHA-256 des octets UTF-8 de la forme canonique RFC 8785 (JCS) ;
- versions des outils, commandes, horodatage UTC et verdicts.

L'inventaire accepte uniquement les types Git explicitement traités (`commit`, `tree`, `blob`, `tag`). Objet manquant, clone shallow, erreur de lecture, type inconnu, ref inattendue ou inégalité d'ensemble refuse fermée. Le manifeste et l'attestation sont archivés dans `governance/docs/reviews/`; leur caractère probatoire ne les rend pas normatifs.

### D3 — Scanner chaque surface avant le premier push

Le gate de l'arbre inspecte exactement l'index destiné au commit. Le gate d'historique inspecte sans exclusion de chemin tous les objets accessibles des refs autorisées, notamment :

- octets de chaque blob historique ; octets de chaque nom de ref et de chemin,
  type et mode de chaque entrée de tree ;
- séparément le nom et l'adresse de l'auteur, le nom et l'adresse du committer, et le message de chaque commit ;
- le nom, l'adresse et le message du tagger de chaque tag annoté ;
- chemins machine locaux, secrets, credentials, cookies, données personnelles,
  artefacts de capture interdits et configurations d'instance. La seule exception
  d'identité est une allowlist nominative attestée des noms/adresses contributrices
  autorisées ; aucune catégorie ouverte « déjà publique » n'est acceptée.

Chaque lecture ou décodage non pris en charge refuse fermée. Les diagnostics ne recopient jamais l'octet sensible. Des repositories Git temporaires synthétiques démontrent un échec distinct pour blob supprimé, message de commit, auteur, committer, message de tag, tagger, nom de ref, nom/mode de tree entry, type non traité et ref inattendue. Les canaris et commits synthétiques ne sont jamais introduits dans le candidat.

### D4 — Éliminer le TOCTOU du premier push

Le push n'utilise jamais un nom de branche locale mutable. Chaque refspec prend l'OID attesté comme source, par exemple `<oid>:refs/heads/main`, avec une lease sur l'état distant attendu — vide lors du premier push. Juste avant l'appel, le manifeste est recalculé et comparé octet par octet à l'attestation ; une mutation invalide la preuve.

Après le push privé, `git ls-remote` et les contrôles fournisseur énumèrent toutes les refs annoncées/accessibles, pas seulement heads/tags, et refusent toute ref inattendue. Un fetch miroir explicite `+refs/*:refs/*` dans un dépôt neuf non shallow, sans identité ni credentials ambiants autres que l'accès de lecture borné, doit récupérer exactement cet ensemble. Il recalcule l'égalité des refs, de tous les objets et du manifeste, puis exécute les gates du repository. Une ref non récupérable, une différence avec l'API fournisseur ou une impossibilité de prouver est un refus, jamais un avertissement.

### D5 — Signer l'état privé avant l'exposition

L'attestation issue du clone privé nomme les OID distants, conserve le manifeste, les résultats positifs et les contrepreuves négatives, et reçoit des revues indépendantes sécurité, qualité et complétude. Sa fusion dans Governance constitue la signature propriétaire de cet état privé exact.

Après la fusion de l'attestation, le distant reste privé et gelé : aucun contributeur,
workflow ou automatisme ne reçoit de capacité d'écriture, et aucune mutation n'est
autorisée dans cette fenêtre. Immédiatement avant l'appel de visibilité, le contrôleur
réénumère toutes les refs distantes, refait un fetch miroir privé, recalcule le manifeste
et exige l'égalité octet par octet avec l'attestation fusionnée. La moindre écriture ou
différence depuis l'attestation refuse la bascule et exige une nouvelle preuve.

La visibilité publique ne peut ensuite viser que cet état recontrôlé. Immédiatement
après la bascule, un clone anonyme refait l'énumération complète et les gates. Cette
vérification post-exposition confirme l'état observable et alimente le truth-drift ;
elle n'est jamais présentée comme la protection initiale.

## Application initiale à Signalement

`libre-ai/signalement` est le premier candidat soumis à I-30. Le dépôt local peut être préparé avant fusion du présent ADR, mais aucun distant ne peut être créé avant la signature du nom. Le produit n'accepte jamais une vulnérabilité via son parcours fonctionnel : tout soupçon de vulnérabilité, secret exposé ou détail d'exploitation suit le canal privé défini par le `SECURITY.md` de flotte.

## Alternatives rejetées

### Publier puis laisser la CI vérifier

Rejeté : la CI détecterait une fuite après qu'elle est devenue copiable.

### Créer directement un repository public

Rejeté : cela fusionne création et exposition en une action irréversible sans preuve de l'état Git distant.

### Conserver seulement un digest ou une liste de commits

Rejeté : un digest sans manifeste ne prouve pas quel ensemble a été condensé ; les commits seuls omettent refs, tags, trees et blobs accessibles.

### Réécrire automatiquement un historique rejeté

Rejeté : l'automatisation pourrait masquer la cause ou publier un nouvel ensemble non revu. Le candidat reste privé ; toute réécriture produit une nouvelle attestation et de nouvelles revues.

## Gate d'acceptation

Une première exposition publique est autorisable seulement si :

1. le nom/enrôlement et I-30 ont été fusionnés par le propriétaire ;
2. l'arbre et l'historique complets passent avec contrepreuves rouges par surface ;
3. le manifeste RFC 8785 conservé couvre l'égalité exacte de toutes les refs
   annoncées/accessibles, tree entries et objets ;
4. les OID attestés ont été poussés vers le repository privé par refspec exact et lease ;
5. un clone privé neuf, complet et fail-closed reproduit tous les verdicts ;
6. l'attestation de cet état privé exact a été revue puis fusionnée dans Governance ;
7. le distant privé gelé est recontrôlé immédiatement avant la bascule ;
8. la bascule publique est explicitement autorisée et suivie du contrôle anonyme.

Toute mutation, ref supplémentaire, lecture partielle ou verdict indépendant bloquant invalide l'autorisation.
