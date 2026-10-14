# ADR-0052 — Square Control (P40) : dépôt public `libre-ai/square-control`, moratoire levé pour le domaine Poste de travail

- **Statut :** proposed — la fusion de cette pull request constitue l'arbitrage propriétaire
- **Date :** 2026-10-14
- **Arbitrage :** décision propriétaire D28 du 2026-10-14, prise en chat. Owner-arbitration: 2026-10-14 — D28, publish Square Control as a public repository; lifts D53 and Y28 for this domain.
- **Lève :** D53 (« aucun nouveau dépôt avant B′ ») pour le seul domaine Poste de travail, par la voie qu'ADR-0042 §7 prévoit (« le moratoire est levé domaine par domaine, par ADR ») ; Y28, décision propriétaire du 2026-10-07 : « Code de Square Control local privé jusqu'à B′ ; le dépôt naîtra par ADR après B′ ».
- **Applique :** ADR-0042 §3 (moratoire), §7 (un domaine, un dépôt produit), §9 (exemption nommée de P40, D61) ; ADR-0038 / I-30 (première publication en deux frontières) ; I-17 (actions à touche humaine) ; I-21 (zéro donnée personnelle dans Git) ; `LICENSING.md` (licences par nature de contenu)
- **Autorise :** la déclaration de `libre-ai/square-control` à l'inventaire (`ecosystem/repositories.v1.yaml`, couche 1, `reserved-product-home`, visibilité publique, fiche `project.v1.yaml`) et l'index régénéré ; la décision D75
- **N'autorise pas :** la création du dépôt distant, qui reste un acte du propriétaire ; l'exposition publique avant l'attestation I-30 fusionnée dans Governance ; la signature Apple ou la distribution à un tiers ; la levée du moratoire pour un autre domaine ; la suppression de `square-control-signing`, dossier du trousseau local, qui n'est ni lu ni versionné ici

## Contexte

D53 (ADR-0042 §3) interdit tout nouveau dépôt avant B′, sauf levée domaine par domaine par ADR. Y28 plaçait le code de Square Control en local et en privé, avec naissance du dépôt « par ADR après B′ ». Le propriétaire a décidé le 2026-10-14 (D28) que Square Control devient un dépôt public `libre-ai/square-control` maintenant, sans attendre B′. Cet ADR est l'ADR que D53 et Y28 exigent, pour ce domaine seulement.

Le domaine « Poste de travail » du catalogue (ADR-0042 §1) n'a qu'un produit, P40 (agencement des fenêtres). Il remplit la règle d'ADR-0042 §7 : un domaine, un dépôt produit. P40 est un outil local mono-poste sans serveur, déjà exempté nommément de §5 et §8 par §9 (D61) ; sa frontière d'isolation est le compte macOS.

État du candidat à la date du 2026-10-14 : un dépôt git local de 12 commits (Rust, Swift, scripts, protocole et résultats bruts de sondes), sans remote. Ses auteurs et committers portaient l'adresse personnelle du propriétaire ; l'arbre et l'historique contenaient un chemin de la machine locale et le nom d'utilisateur local dans 2 fichiers. Le candidat a été préparé dans un clone neuf, la source étant restée intacte : historique réécrit, licence et fichiers de flotte ajoutés en commits signés après l'historique réécrit.

## Décision

1. **Le moratoire de D53 est levé pour le domaine Poste de travail.** `libre-ai/square-control` est le dépôt de ce domaine (ADR-0042 §7) et porte P40. Aucun autre domaine n'est concerné.
2. **Y28 est levée.** Le code de Square Control cesse d'être « local privé jusqu'à B′ ».
3. **Destination publique, séquence I-30 inchangée.** D28 fixe la visibilité finale du dépôt ; il ne dit pas que la séquence d'ADR-0038 est suspendue. La première publication reste donc en trois actes propriétaires : (a) création d'un distant de staging vide et **privé**, (b) push des OID attestés, puis attestation du clone privé fusionnée dans `docs/reviews/` de Governance, (c) passage en public. Cette lecture est la plus restrictive des deux possibles ; si le propriétaire entendait lever aussi I-30 pour ce dépôt, cela exige un amendement d'ADR-0038, pas cet ADR.
4. **Licences.** Le code est `EUPL-1.2` (applications et logiciel de première partie, `LICENSING.md`, tableau « First-party software », ligne 25 à la date de cet ADR) ; la documentation et les enregistrements de projet (README, protocole de sondes, résultats bruts) sont `CC-BY-4.0` (`LICENSING.md`, section « Documentation and executable examples »). Les workflows de flotte copiés du dépôt de référence portent `Apache-2.0` (outillage générique de qualité). Jamais MIT. Cela reprend la licence déjà déclarée par le workspace Cargo du candidat (`EUPL-1.2`).
5. **Conformité de flotte du candidat.** `AGENTS.md` aux sections de la couche 1, `CLAUDE.md` adaptateur octet-exact, `.github/dependabot.yml` octet-exact à la variante `cargo` du gabarit, `context-hygiene` et `licensing` consommés depuis la génération R `0db2e10e3ea785c31c101914483ed501ec4cbb7a` comme `libre-ai/pi-evidence`, REUSE conforme.
6. **Fiche honnête.** `project.v1.yaml` déclare `maturity: specified` et `exposure: idea` : la moitié gauche de l'écran et la porte binaire sont mesurées sur une machine ; les sondes de permission et le reste de la matrice REQUIS ne le sont pas. Le passage à `spec-published` est conditionné à l'état public reproduisant l'état privé attesté.

## Preuves

Mesures datées du 2026-10-14, à rejouer avant de s'en servir. Le clone préparé est celui qui sera poussé par le propriétaire ; sa tête est donnée dans la pull request.

| Mesure | Résultat | Reproduction |
| --- | --- | --- |
| Commits réécrits | 12 sur 12 conservés, dates conservées, auteur et committer = identité `noreply` du propriétaire, un `Signed-off-by` à cette identité chacun | `git log --format='%an %ae %cn %ce %ad'` et `git interpret-trailers --parse` |
| Arbres | chacun des 12 arbres diffère de l'ancien, et seulement par les lignes de nettoyage (4 fichiers au plus : le protocole, un rapport `cargo-deny`, un enregistrement de test, le script de porte binaire) | différence arbre à arbre, lignes ajoutées et retirées dédupliquées |
| Chemin machine-local et nom d'utilisateur local, historique complet | avant 10 et 2 occurrences, après 0 et 0 | `git log -p --all \| grep -c -F` |
| Objets git accessibles | 0 occurrence de ces motifs et de l'ancienne adresse personnelle | `git cat-file --batch-all-objects --batch \| grep -a -c -F` |
| Secrets, premier instrument | balayage par motifs de l'historique complet (clés privées, `.p12`, jetons usuels) : seule occurrence, une référence de variable `pass:$transport` dans un script, sans valeur | `git log -p --all \| grep` |
| Secrets, second instrument | `gitleaks git` sur l'historique complet : aucune fuite ; `gitleaks dir` sur l'arbre : aucune fuite | `gitleaks git --redact .` |
| REUSE | conforme à la version 3.3 de la spécification | `reuse lint` |
| Rust | 15 tests verts, `clippy -D warnings` propre, `cargo fmt --check` propre, `cargo deny check bans licenses sources` propre | `scripts/check.sh` |

## Conséquences et limites

- Le gate « Index freshness and GitHub reconciliation » est rouge sur la pull request tant que le propriétaire n'a pas créé le dépôt : l'inventaire déclare un dépôt public qui n'est pas observable. Les gates `check-inventory-drift`, `check-fleet-pins`, `check-fleet-presentation`, `check-context-conformance` et `check-dependabot-conformance` n'ont chacun qu'une assertion non tenue, celle de cette absence (sur 77, 2, 26, 26 et 26 assertions respectivement, mesuré le 2026-10-14).
- La CI du candidat couvre le workspace Rust et la politique de dépendances. Le shell Swift, la porte binaire et les sondes exigent macOS et un serveur de fenêtres : ils ne tournent pas en CI et le candidat ne le prétend pas. Les workflows n'ont jamais tourné sur un runner : leur premier verdict est celui du dépôt privé de staging.
- Les 12 identifiants de commit changent (aucun n'avait été publié). Le commit « Strip machine paths from recorded results » devient un commit sans changement d'arbre, son contenu étant désormais porté dès les commits qui introduisaient les chemins ; il est conservé pour respecter les 12 commits.
- Le script de signature (`scripts/signing-identity.sh`) référence un dossier de trousseau situé hors du dépôt ; aucun trousseau, certificat, mot de passe ou clé n'est dans l'historique. Le trousseau n'a pas été lu.
- La porte binaire (`scripts/check-binary.sh`) cherchait le préfixe de répertoire personnel macOS sous forme littérale ; le littéral est désormais assemblé en deux morceaux pour que le fichier ne porte pas le motif que `context-hygiene` interdit. `bash -n` est propre sur la nouvelle version ; la porte n'a pas été rejouée sur un bundle construit.
- Numérotation : ADR-0052 et D75 suivent ADR-0051 et D74, derniers numéros du registre servi à la date de rédaction (après la fusion de la pull request 102). Un conflit de numéro à la fusion se résout par renumérotation, jamais par réutilisation.
