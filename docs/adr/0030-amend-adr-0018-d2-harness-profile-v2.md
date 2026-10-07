# ADR-0030 — Amendement d'ADR-0018 D2 : le contrat de profil décrit ce que la couche tient (`harness-profile.v2`)

- **Statut :** accepted — arbitrage propriétaire du 2026-08-19 par question structurée (ADR-0022/I-24). Owner-arbitration: 2026-08-19
- **Date :** 2026-08-19
- **Portée :** amendement de réalisation d'ADR-0018 D2 (contrat de profil du harness) ; enregistrement des choix structurels de la re-livraison WP-G3-H01 dans `libre-ai/harness` (BOOTSTRAP-DOSSIER, § « Exigences de la re-livraison », exigence 2).
- **Étend :** ADR-0018 (ouverture vague 3), ADR-0026 §2.2/§2.4 (création de `libre-ai/harness`), le dossier `docs/reviews/wp-g3-h01/BOOTSTRAP-DOSSIER.md` (arbitrage de migration du 2026-08-19).
- **Amende un contrat verrouillé — par successeur majeur, jamais en place** : `harness-profile-v1` reste non-targeted, `harness-profile.v2` est le candidat qui le remplace (COMPATIBILITY.md, « Pre-implementation candidates »).

## Contexte

`harness-profile.v1` verrouille `workerTransport.verifyOsPeer` à `const: true` :
tout profil conforme DOIT prescrire la vérification des crédentiels OS du pair.
La réalisation (orchestrator#13, branche conservée `feat/wp-g3-h01-confined-execution`)
a démontré par exécution que ce contrôle est **inapplicable sur le transport
que la couche ouvre** : `SO_PEERCRED` sur une `socketpair()` anonyme renvoie
les crédentiels du processus créateur — le harness, aux deux bouts. Il n'existe
pas de `connect()` dont capturer l'identité ; la CI Linux l'a démontré là où
macOS laissait passer (dossier, § « L'arbitrage verifyOsPeer, exécuté et
invalidé par son exécution »). Le contrôle a été retiré du moteur, du profil
requis et du périmètre attesté (`1004b04`) plutôt que d'attester ce qu'il ne
prouve pas.

Il en résulte une contradiction vivante : le contrat force chaque profil à
prescrire un contrôle qu'aucun moteur de cette couche ne peut tenir. L'exigence
d'entrée 2 de la re-livraison n'admet que deux issues, toutes deux
propriétaires : construire le transport qui rend le contrôle vrai (socket
nommé, `connect`/`accept`), ou amender la doctrine et le contrat pour qu'ils
décrivent ce que la couche tient.

## Décisions

### D1 — `harness-profile.v2` : `verifyOsPeer` devient une prescription optionnelle, refusée quand elle est intenable

Arbitrage propriétaire (2026-08-19, question structurée) : **amender, pas
construire**. Le successeur majeur `harness-profile.v2` retire `verifyOsPeer`
de la liste `required` du bloc `workerTransport` et le type en `boolean` libre.
La sémantique runtime est le patron de refus existant : un profil qui prescrit
`verifyOsPeer: true` à un moteur qui ne peut pas le tenir est refusé à la
résolution (`harness.control_not_enforceable`), jamais approximé ni attesté.
Le profil canonique de la couche (`local-process`) cesse de prescrire le
contrôle.

La voie du nouveau major est imposée par `contracts/COMPATIBILITY.md` :
l'assouplissement d'un champ requis d'un contrat `locked` `major-versioned` ne
se fait jamais en place. Aucun producteur v1 n'ayant été released
(orchestrator#13 fermée sans merge), les consommateurs passent directement au
v2 sans adaptateur et v1 reste non-targeted.

Conséquences mécaniques, livrées dans le même chantier : nouveau schéma +
entrée catalogue + fixtures positives/négatives dans `contracts` ; vecteurs
verrouillés `digest-vectors`/`signature-vectors` régénérés (le digest du profil
canonique change, donc le document d'attestation vectorisé aussi) ;
`libre-ai-contract-types` (sdk-rs) embarque le v2 ; le crate harness le
consomme. I-17 tient : chaque étape passe par revue role-séparée et le merge
du contrat est un acte propriétaire.

### D2 — Le transport nommé reste une capacité future, pas un follow-up

Appliquer `verifyOsPeer` exige un transport à socket nommé
(`connect`/`accept`), une garde durcie et un protocole worker sans héritage de
stdio — une surface d'hôte nouvelle. Elle reste **fermée** au sens d'ADR-0018
D2 (« chaque élargissement = son package + sa revue »). L'exigence 2 du
dossier est close par le présent amendement, pas différée : le contrat cesse
de mentir, et la capacité `worker_transport_isolation` ne rentrera au manifeste
du moteur qu'avec le package qui la rend vraie.

### D3 — Choix structurels de la re-livraison, tracés comme déviations de la base

La re-livraison dans `libre-ai/harness` dévie de la base `orchestrator#13` sur
trois points de forme, enregistrés ici (le fond — flot, refus, attestation —
est repris de la branche et re-challengé par les passes K4 du round 4) :

1. **Crate racine `libre-ai-harness`** — pas de `crates/agent-harness/` : le
   repo satellite porte la crate à sa racine (ADR-0026 §2.2 ; LEXICON §10.1 ;
   `docs/apps/harness.md`, ligne Path).
2. **La matrice fermée remplace les codes d'amorçage** : l'enum
   `HarnessRefusal` à 13 variantes (codes `harness.*` de la spécification)
   remplace les trois codes bootstrap `harness.refuse.*`, qui n'ont aucun
   consommateur. La famille `harness.refuse.*` disparaît.
3. **Le moteur prend le nom de son foyer** : `libre-ai-harness-host-engine`,
   URN `urn:libre-ai:manifest:harness-host-engine-1` ; la cascade de digests
   (manifeste → pin du profil → adresse du profil) est recalculée sous le gate
   `tests/engine_pin.rs`, écrit rouge — le garde-fou de la récidive nommée en
   tête par l'arbitrage de migration.

### D4 — `work-packages.v1.json` se lit à travers la migration, il n'est pas réécrit

Le plan `docs/transformation/work-packages.v1.json` est un artefact du
programme de transformation en topologie hub (pré-ADR-0020) : chaque entrée G3
pointe des chemins `apps/**` ou `crates/**` du hub archivé, et aucun gate n'en
valide plus la structure. La mention `crates/agent-harness/**` de WP-G3-H01 se
lit désormais « la racine du repository `libre-ai/harness` » (ADR-0026 §2.2 +
arbitrage de migration 2026-08-19). Réécrire une seule entrée créerait une
forme hybride dans un artefact autrement homogène ; la vérité vivante est
portée par la spécification du repo, sa fiche `project.v1.yaml` et le dossier
de revue.

## Invariants

Aucun invariant nouveau. I-17 (surface à touche humaine fermée) et I-18 (noyau
de sécurité des boucles) s'appliquent inchangés : l'amendement de contrat et le
premier merge sécurité-critique de la couche 2 restent des actes propriétaires
— le hard-stop ADR-0011 D4, porté par `libre-ai/harness` depuis l'arbitrage de
migration, n'est ni levé ni affaibli par cet ADR.

## Conséquences

- `contracts` publie le candidat `harness-profile.v2` (schéma, catalogue,
  fixtures, vecteurs) ; v1 reste non-targeted, aucun adaptateur.
- `sdk-rs` (`libre-ai-contract-types`) embarque le v2 ; le crate harness
  consomme la nouvelle révision épinglée.
- La re-livraison WP-G3-H01 dans `libre-ai/harness` intègre D1-D3 ; son
  prononcé reste l'arrêt dur d'amorçage d'ADR-0018 D2, dossier K4 indépendant
  à l'appui (round 4 : `docs/reviews/wp-g3-h01/0b5204f/`).
- Le jour où le transport nommé est construit, `worker_transport_isolation`
  revient au manifeste par son propre package et sa propre revue — jamais par
  réattestation « par construction ».
