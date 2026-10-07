# ADR-0023 — Re-ratification du domaine A (Vision & méthode)

- **Statut :** accepted — la ratification est le merge propriétaire de cette
  pull request.
- **Arbitrage :** propriétaire le 2026-08-18, par questions structurées
  (ADR-0022/I-24) — remise à plat de l'écosystème libre-ai, domaine A.
- **Date :** 2026-08-18
- **Portée :** écosystème — dégel de l'inventaire, séquencement en vagues,
  produit zéro, définition de K4, statut des ADR 0013-0017, renvois du
  registre de décisions.
- **Étend :** ADR-0008, ADR-0009, ADR-0020, ADR-0009/D4 (K4).
- **Supersède de manière bornée :** voir §2 — chaque supersession est
  nominative et bornée à la clause près.

## 1. Contexte

L'activation générale (ADR-0020 D1, 2026-07-28) a supersédé le séquencement
par vagues comme doctrine trois semaines avant que l'inventaire n'en tienne
compte : `ecosystem/repositories.v1.yaml` portait encore 9 entrées
`frozen-until-wave-3/4` et `frozen-reserved` (feed-radar, notebook,
ai-practices, sessions, boussole-politique, spec-studio, policy, missions,
carriere). Le même écart de doctrine se retrouvait dans la description de K4
(`docs/method/POLARIS.md`), qui citait un `.github/CODEOWNERS` inexistant et
des « required reviews » qu'aucun réglage réel ne porte
(`docs/transformation/G0-CANONICAL-BOOTSTRAP.md` le dit déjà). Le registre de
décisions (`docs/decisions/DECISION-REGISTER.md`, note « Known gaps »
2026-08-18) constatait lui-même l'absence de renvoi pour six ADR acceptés
sans trancher — exigeant explicitement « son propre ADR et une approbation
humaine explicite ». Le présent ADR est cette approbation, pour le
périmètre du domaine A.

## 2. Décisions

### 2.1 Dégel total — ADR-0008 re-ratifié

ADR-0008 est re-ratifié dans son ensemble. Un écart d'exécution est consigné :
le dépôt d'une marque figurative EUIPO (ADR-0008 point 6) reste une **action
propriétaire ouverte, sans preuve d'exécution** à ce jour — ni régression de
la décision, ni fait nouveau ; simple constat d'un acte non encore posé.

### 2.2 Suppression du séquencement résiduel — ADR-0009/ADR-0020 amendés

`ecosystem/repositories.v1.yaml` : les 9 entrées `frozen-until-wave-4`
(feed-radar, notebook, ai-practices, sessions, boussole-politique,
spec-studio, policy), `frozen-until-wave-3` (missions) et `frozen-reserved`
(carriere) passent `lifecycle: active` (exécuté par la pull request #36,
2026-08-18) — clôture mécanique du décalage entre la doctrine (ADR-0020 D1,
séquencement supersédé le 2026-07-28) et l'inventaire qui ne l'avait pas
suivi. Plus aucune valeur `lifecycle` ne référence un mécanisme de vague ;
l'enum fermé `active | archived` de `ecosystem/build-index.ts` le garantit
mécaniquement.

ADR-0009 §8 (ordre de migration en vagues) reste supersédé tel qu'énoncé par
ADR-0020 §2.2 — ce point n'était pas rouvert. Le présent ADR referme le
dernier vecteur résiduel : **aucun mécanisme d'ordre ne remplace les
vagues.** Tous les repositories du portefeuille sont responsables de leur
périmètre dès maintenant (ADR-0020 D1, inchangé) ; la **loi d'exposition**
(I-15 — vitrine publique dès, et seulement dès, quelque chose de vérifiable,
portée par la fiche `project.v1.yaml` de chaque projet) est le **seul
filtre** de visibilité publique. Elle ne conditionne l'existence d'aucun
repository (I-16, déjà abrogé comme précondition par ADR-0020) — seule sa
vitrine.

### 2.3 Produit zéro — principe d'une fiche falsifiable, valeurs différées

Le produit zéro (I-13 — la méthode elle-même) devra porter une fiche
falsifiable sur le même modèle que les fiches `project.v1.yaml` des produits
qu'elle gère : `hypothesis`, `evidence_required`, `kill_predicates` (et les
champs adjacents déjà en usage — `promotion_criteria`, `benchmark`). Le
présent ADR **acte le principe** ; il ne fixe **aucune valeur**. Seuils et
échéance sont en cours de fixation par le propriétaire et feront l'objet
d'une pull request dédiée ultérieure, qui seule engage le contenu de la
fiche. Aucun fichier de fiche n'est créé par la présente pull request.

### 2.4 K4 redéfini

K4 (« mutations de la couche 3 et des garde-fous : revue humaine + signature + retour arrière borné, pas d'auto-merge ») est redéfini dans sa **réalisation**, pas dans son **exigence** : « revue adversariale documentée + merge propriétaire = signature ». C'est la description honnête de ce qui se passe réellement sur un dépôt à mainteneur unique — aucune équipe GitHub `security`/`architecture` n'existe, `.github/CODEOWNERS` n'existe pas, et `AGENTS.md` l'affirme déjà : « a doctrine merge is a signature ». Cette redéfinition est appliquée **mécaniquement** par le gate `tools/quality/check-review-evidence.ts` (pull request #37, mergée avant la présente) : toute pull request qui touche `docs/adr/**`, `docs/decisions/INVARIANTS.md` ou `docs/decisions/DECISION-REGISTER.md` doit référencer soit un artefact de revue sous `docs/reviews/`, soit un marqueur d'arbitrage propriétaire daté (`Owner-arbitration: YYYY-MM-DD`) — dans la description de la pull request ou dans le diff des fichiers concernés. La présente pull request porte elle-même ce marqueur, qui est son propre arbitrage. `docs/method/POLARIS.md` (ligne K4 uniquement) est réécrit par la présente pull request pour refléter cette définition.

**K1, K2, K3 et K5 ne sont pas touchés.** Leur statut relève du domaine F
(sécurité), en cours d'arbitrage séparé.

### 2.5 ADR 0013-0017 requalifiés `deferred`

Les ADR 0013 à 0017 (invariants de sérialisation Boussole, auto-consistance
du résultat, traçabilité de la polarité éditoriale, protocole de revue
humaine gaté par hash, contradiction Practices) passent du statut `proposed`
au statut `deferred`, avec la note datée : « fond arbitré en phase produits
de la remise à plat 2026-08 ». Aucune des questions qu'ils posent n'est
tranchée par le présent ADR — leur contenu reste inchangé, seul leur statut
de traitement bouge : ils ne sont plus des questions ouvertes du domaine A,
ils deviennent l'entrée d'une phase produits ultérieure.

### 2.6 Renvois du registre de décisions

`docs/decisions/DECISION-REGISTER.md` est amendé par la présente pull
request : une entrée D32 consigne qu'ADR-0011 D1 (moteur pilote Notebook,
séquencement 4a/4b) est supersédée par ADR-0020 §2.2, tandis que D3 (arrêt
dur du Specification Lock orchestrateur), D4 (confiance graduée) et D6
(plafonds d'autonomie chiffrés) restent en vigueur — ADR-0020 le disait déjà
en prose (§2.2), le registre n'en portait pas trace structurée. Une note en
tête du registre explicite que les décisions durables d'ADR-0008, ADR-0009 et
ADR-0012 vivent dans `docs/decisions/INVARIANTS.md` par construction (I-01,
I-04, I-11 (via l'ADR-0004 de licensing), I-13 à I-20, I-21, I-22) — ce n'est donc pas un oubli du
registre D0x, qui trace les décisions d'exécution du Big Bang (ADR-0001 et les
phases qu'il a forcées), pas l'ensemble des ADR acceptés. La note « Known
gaps (2026-08-18) » est resserrée en conséquence : elle ne cite plus
ADR-0008, ADR-0009 ni ADR-0012 (résolus par la présente sous-section) ;
ADR-0010 et ADR-0018 restent notés comme gaps non résolus ici — hors
périmètre du domaine A. La clause de clôture du registre (« changes to this
register require an ADR and explicit human approval ») est satisfaite par le
présent ADR pour les entrées qu'il ajoute.

## 3. Conséquences

- `ecosystem/repositories.v1.yaml`, `ecosystem/build-index.ts` et leurs tests
  sont modifiés par la pull request #36 (mergée avant la présente) ;
- `tools/quality/check-review-evidence.ts`, `.github/workflows/ci.yml`
  (step du job `bun-quality`) et `distribution/evidence/coverage-2026-08-18.json`
  sont modifiés par la pull request #37 (mergée avant la présente) ;
- `docs/method/POLARIS.md` (ligne K4 uniquement), `docs/decisions/DECISION-REGISTER.md` (note en tête + entrée D32 + note « Known gaps » resserrée) et le statut des ADR 0013-0017 sont modifiés par la présente pull request ;
- `docs/specifications/LOOP-SECURITY-KERNEL.md` et `docs/security/THREAT-MODEL.md` ne sont **pas** touchés — ils portent le même écart K4 (CODEOWNERS cité sans exister) mais relèvent du domaine F/H, en cours d'arbitrage séparé ;
- la fiche falsifiable du produit zéro (§2.3) reste à écrire : une pull
  request dédiée ultérieure, sur décision propriétaire, en fixera les
  valeurs.
