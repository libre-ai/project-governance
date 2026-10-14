# ADR-0038 — Première publication d'un repository en deux frontières

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Introduit :** I-30
- **Amende :** ADR-0009 §9 — un distant privé temporaire de prépublication n'est pas encore un repository du portefeuille
- **Applique :** I-17 (actions human-touch), I-21 (zéro donnée personnelle dans Git) et I-12 (GitHub canonique sans dépendance de données irréversible)
- **Périmètre :** première exposition publique d'un nouveau repository Libre AI
- **N'autorise pas :** création distante, exposition publique, secret, donnée utilisateur, déploiement ou activation produit
- **Décision :** D44 ; D2 amendée par D78 (attestation de toutes les refs annoncées, `refs/pull/*` comprises, 2026-10-14) ; D3 amendée par D79 (identités de forge admises pour les seuls commits ajoutés par la forge, 2026-10-14)
- **Arbitrage des amendements :** décisions du propriétaire en session le 2026-10-14. Owner-arbitration: 2026-10-14

## Contexte

Un scan du seul arbre courant ne protège pas contre un secret supprimé mais encore accessible, une identité personnelle dans un commit, un tag annoté oublié ou une branche supplémentaire. Un workflow déclenché après la première exposition arrive trop tard : rendre ensuite le repository privé ne retire pas les objets déjà copiés.

L'attestation ne peut pas non plus vivre uniquement dans le repository qu'elle atteste sans créer une récursion : ajouter l'attestation modifie sa pointe et son inventaire. Governance porte donc l'autorité et l'attestation externe ; le repository candidat porte les gates reproductibles.

## Décision

### D1 — Séparer création distante et exposition publique

Après signature propriétaire du nom et de l'enrôlement, un distant de staging est créé vide et **privé**. Cette création reste une action human-touch. Ce distant n'est pas encore un repository du portefeuille : il n'entre dans aucun inventaire, aucune exposition ou projection publique. Aucun import, README automatique, branche ou tag initial n'est accepté.

Le passage `private -> public` est une seconde action human-touch, interdite tant qu'une attestation privée exacte n'a pas été fusionnée dans Governance. Un échec conserve le repository privé. Il n'existe aucun rollback capable d'annuler une divulgation publique ; repasser privé n'est qu'une mitigation, suivie de rotation/révocation et traitement d'incident si nécessaire.

### D2 — Attester des refs complètes et des objets canoniques

L'ensemble autorisé est la liste triée de tous les noms complets `refs/...` annoncés ou accessibles, chacun associé à son OID final, **telle que l'attestation la capture** — quel que soit le namespace : `refs/heads/*`, tags, notes, remotes, replace, namespaces fournisseur, et aussi `refs/pull/*` et les branches créées par la forge (par exemple Dependabot). Tout objet accessible depuis toute ref attestée passe par les mêmes scans que la branche principale (D3 : historique, identités, motifs). Toute ref présente à la transition qui n'est pas dans l'attestation fusionnée, ou dont l'OID diffère de l'OID attesté, refuse la transition et exige une nouvelle attestation. `HEAD` est vérifié séparément comme symref vers la branche autorisée ; les lignes de peel `^{}` ne sont pas des refs supplémentaires mais leur OID dérivé est vérifié.

Conséquence assumée : les refs générées par la forge et attestées (`refs/pull/*`, branches Dependabot) deviennent publiques avec le repository, et leurs objets avec elles. Si l'une d'elles bouge avant la bascule (par exemple l'exécution hebdomadaire de Dependabot), la transition refuse et l'attestation est refaite. Voir « Amendement du 2026-10-14 ».

Le manifeste canonique versionné conserve, pas seulement son digest :

- repository et version de schéma ;
- ensemble exact et trié `{ ref, oid }` ;
- ensemble exact et trié de tous les objets accessibles `{ oid, type, size }` ;
- digest SHA-256 des octets UTF-8 de la forme canonique RFC 8785 (JCS) ;
- versions des outils, commandes, horodatage UTC et verdicts.

L'inventaire accepte uniquement les types Git explicitement traités (`commit`, `tree`, `blob`, `tag`). Objet manquant, clone shallow, erreur de lecture, type inconnu, ref absente de l'attestation ou d'OID différent, ou inégalité d'ensemble refuse fermée. Le manifeste et l'attestation sont archivés dans `governance/docs/reviews/`; leur caractère probatoire ne les rend pas normatifs.

### D3 — Scanner chaque surface avant le premier push

Le gate de l'arbre inspecte exactement l'index destiné au commit. Le gate d'historique inspecte sans exclusion de chemin tous les objets accessibles des refs autorisées, notamment :

- octets de chaque blob historique ; octets de chaque nom de ref et de chemin,
  type et mode de chaque entrée de tree ;
- séparément le nom et l'adresse de l'auteur, le nom et l'adresse du committer, et le message de chaque commit ;
- le nom, l'adresse et le message du tagger de chaque tag annoté ;
- chemins machine locaux, secrets, credentials, cookies, données personnelles,
  artefacts de capture interdits et configurations d'instance. La seule exception
  d'identité est une allowlist nominative attestée des noms/adresses contributrices
  autorisées ; aucune catégorie ouverte « déjà publique » n'est acceptée. Une identité
  ou une adresse de forge (auteur, committer ou trailer d'un commit créé par la forge)
  n'y est admise que pour les commits ajoutés par la forge et non atteignables depuis la
  branche servie ; les commits atteignables depuis la branche servie restent jugés sur
  les seules identités contributrices.
  Voir « Amendement du 2026-10-14 — D3 ».

Chaque lecture ou décodage non pris en charge refuse fermée. Les diagnostics ne recopient jamais l'octet sensible. Des repositories Git temporaires synthétiques démontrent un échec distinct pour blob supprimé, message de commit, auteur, committer, message de tag, tagger, nom de ref, nom/mode de tree entry, type non traité, ref absente de l'attestation et ref attestée dont l'OID a changé. Les canaris et commits synthétiques ne sont jamais introduits dans le candidat.

### D4 — Éliminer le TOCTOU du premier push

Le push n'utilise jamais un nom de branche locale mutable. Chaque refspec prend l'OID attesté comme source, par exemple `<oid>:refs/heads/main`, avec une lease sur l'état distant attendu — vide lors du premier push. Juste avant l'appel, le manifeste est recalculé et comparé octet par octet à l'attestation ; une mutation invalide la preuve.

Après le push privé, `git ls-remote` et les contrôles fournisseur énumèrent toutes les refs annoncées/accessibles, pas seulement heads/tags, et refusent toute ref absente de l'attestation ou dont l'OID diffère. Un fetch miroir explicite `+refs/*:refs/*` dans un dépôt neuf non shallow, sans identité ni credentials ambiants autres que l'accès de lecture borné, doit récupérer exactement cet ensemble. Il recalcule l'égalité des refs, de tous les objets et du manifeste, puis exécute les gates du repository. Une ref non récupérable, une différence avec l'API fournisseur ou une impossibilité de prouver est un refus, jamais un avertissement.

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

Toute mutation, ref absente de l'attestation, ref attestée d'OID différent, lecture partielle ou verdict indépendant bloquant invalide l'autorisation.

## Amendement du 2026-10-14 — D2 : attester toutes les refs annoncées, `refs/pull/*` comprises

Owner-arbitration: 2026-10-14 — owner chose "Amender D2" (attest every advertised ref, refs/pull/* included, instead of refusing them) after the square-control Dependabot refs/pull/1 incident.

**Ce qui change.** D2 refusait toute ref `refs/pull/*` ou fournisseur supplémentaire. Il attestait donc un ensemble de refs mais interdisait à la forge d'en ajouter. L'ensemble autorisé reste exact et trié, mais c'est celui que l'attestation capture, quel que soit le namespace. Les objets accessibles depuis chaque ref attestée passent par les scans de D3 comme ceux de la branche principale. Le refus fermé est conservé : une ref absente de l'attestation fusionnée, une ref attestée d'OID différent, un objet manquant, un clone shallow ou un type inconnu refusent la transition. D1 et D5 restent inchangés ; dans D3, D4, le paragraphe d'inventaire de D2 et le gate d'acceptation, seule la formulation « ref inattendue / supplémentaire » devient « ref absente de l'attestation ou d'OID différent ».

**Pourquoi.** Le gabarit de flotte impose à tout repository un `.github/dependabot.yml` octet pour octet (`distribution/templates/dependabot/`). Mesuré le 2026-10-14 sur `libre-ai/square-control`, dépôt de staging privé vide : au premier push de l'OID gelé, Dependabot s'est exécuté immédiatement, malgré `schedule: weekly`, et a ouvert la pull request #1. Elle a créé trois refs : `refs/heads/dependabot/cargo/cargo-minor-and-patch-c3be8eb6fd` et `refs/pull/1/head` (`f192917b55875fc32db5c61bed573770c1fc12ef`), puis `refs/pull/1/merge` (`b583cc527872bb4f20641a67f2c939a65ca7e6da`). Le propriétaire ne peut pas supprimer `refs/pull/*` ; seul le support de la forge le peut. Avec D2 tel qu'écrit, tout repository conforme à la flotte était donc impubliable par le circuit I-30. Le contenu des 12 objets ajoutés a été mesuré inoffensif : 2 commits (identités `dependabot[bot]` noreply et GitHub noreply), 0 occurrence des motifs interdits, seuls `Cargo.lock` et 3 `Cargo.toml` touchés.

**Conséquences.**

1. Les refs générées par la forge (`refs/pull/*`, branches Dependabot) et leurs objets deviennent publics au passage `private -> public`.
2. Si une de ces refs bouge avant l'étape 5 (par exemple l'exécution hebdomadaire de Dependabot), D5 refuse la bascule et l'attestation est refaite.
3. Aucun gate du dépôt n'encode « exactement ces refs » : l'inventaire, le recontrôle et le miroir de D4 et D5 sont exécutés par le contrôleur du candidat. Cet amendement ne modifie donc aucun comportement de gate ici.

## Amendement du 2026-10-14 — D3 : identités de forge admises pour les seuls commits de la forge

Owner-arbitration: 2026-10-14 — owner admits the forge identity and trailer for forge-added commits only; the served branch stays under the owner identity alone (chat).

**Ce qui change.** D3 n'admettait qu'une allowlist nominative de contributeurs, sans dire ce qu'elle fait d'une identité de forge. Depuis D78, les commits créés par la forge sur des refs attestées (branche Dependabot, `refs/pull/*`) passent par les scans de D3 : leurs identités et leur trailer doivent donc être allowlistés ou refusés. L'allowlist peut désormais nommer une identité ou une adresse de forge, mais avec une portée : elle ne s'applique qu'aux commits ajoutés par la forge et non atteignables depuis la branche servie, jamais à un blob. Tout commit atteignable depuis la branche servie reste soumis aux seules identités contributrices nominatives. Le refus fermé et l'interdiction de toute catégorie « déjà publique » sont conservés.

**Pourquoi.** Mesuré le 2026-10-14 sur l'attestation de `libre-ai/square-control` (`docs/reviews/square-control-bootstrap/95e1bcea42e6c20c9fc8987b65b7c55de007d2f2/`). Le commit Dependabot `f192917b55875fc32db5c61bed573770c1fc12ef`, ajouté par la forge au premier push, se termine par le trailer `Signed-off-by: dependabot[bot] <support@github.com>`. Sous la première allowlist, le scan relevait exactement un constat, ce trailer. Le même trailer a été mesuré sur un commit Dependabot de `libre-ai/signalement` (`030add73`), par un second instrument. Sans portée, admettre l'adresse aurait aussi admis un commit humain de la branche servie qui la porterait.

**Conséquences.**

1. Le scanner applique la portée par l'atteignabilité, non par l'origine : est traité comme ajouté par la forge tout commit que la ref de confiance (`--trusted-ref`, la branche servie) n'atteint pas (`tools/attestation/git-attestation.ts`, `forgeAdded`). Qu'un tel commit ait bien été créé par la forge n'est vérifié par aucun outil : c'est la revue de l'attestation qui le constate (pour Square Control, `evidence/identities.forge.txt` du dossier cité). Une identité de forge n'est admise qu'en dehors de la ref de confiance, et son adresse est alors retirée de tout le message du commit, pas seulement du trailer, jamais d'un blob (contrepreuve `red:strip-scope`, 2 tests rouges une fois neutralisés). Seules les occurrences délimitées sont retirées (`red:strip-boundary`, cinq sondes de contournement). L'allowlist de l'attestation de Square Control est `evidence/identity-allowlist.json` du dossier cité.
2. Après la bascule, un merge en squash d'une pull request de la forge écrit sur la branche servie un commit dont l'auteur et le trailer sont ceux de la forge (le committer `GitHub <noreply@github.com>` de tout merge fait par l'interface de la forge, y compris par le propriétaire, est un committer technique, distinct de l'auteur et du signataire ; un futur candidat dont l'historique privé contient de tels merges doit allowlister ce committer explicitement, faute de quoi D3 le refuse). Mesuré le 2026-10-14 sur `libre-ai/signalement` : la PR Dependabot #18 échoue au contrôle d'historique du dépôt, et sa reprise sous l'identité du propriétaire, au diff identique, passe (#21). Les PR Dependabot encore ouvertes ce jour-là sur les deux dépôts publiés par I-30 (signalement #18, square-control #1) sont reprises sous l'identité du propriétaire, par décision en session ; la seconde attend la levée du gel du dépôt.
3. Après la bascule, aucun gate de Governance ne vérifie qu'aucun commit de la branche servie n'a la forge pour auteur ou pour signataire. `libre-ai/signalement` l'impose par son propre contrôle d'historique ; `libre-ai/square-control` n'a pas de contrôle équivalent.
