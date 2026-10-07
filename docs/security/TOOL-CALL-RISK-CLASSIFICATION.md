# Classification de risque des appels d'outils et attestation de sandbox

> **Provenance.** Extrait d'un dépôt privé d'expérimentation avant sa
> suppression, le 2026-07-26. Le dépôt implémentait ce modèle en JavaScript ;
> **aucune source n'est portée ici** — ce monorepo n'accueille pas de source
> JavaScript. Seuls le modèle, ses critères d'attribution et ses limites
> prouvées sont conservés, avec de courts extraits illustratifs. Les motifs
> désignant la forge d'un contexte étanche non public ont été retirés.

Un agent qui exécute des outils (shell, lecture, écriture, appels externes) a
besoin d'une garde qui décide, **avant exécution**, si l'appel passe, demande
confirmation, ou est refusé. Ce document décrit un modèle à quatre niveaux
éprouvé sur un corpus réel, et — plus important — **ce qu'il ne garantit pas**.

## Le modèle R0–R3

Quatre niveaux ordonnés. La classification retient toujours **le plus haut
niveau déclenché**, jamais une moyenne.

| Niveau | Sens                                      | Exemples d'attribution                                                                                                                                                                                                                                                                |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R0** | consultation reconnue, sans effet         | outils de lecture (`read`, `grep`, `find`, `ls`) ; commandes de consultation reconnues (`pwd`, `ls`, `cat`, `stat`, `git status/diff/log`)                                                                                                                                            |
| **R1** | mutation locale ciblée, effet borné       | écriture ou édition d'un fichier non sensible ; requête documentaire externe                                                                                                                                                                                                          |
| **R2** | effet local étendu ou cible sensible      | suppression locale, élévation de privilèges, changement de permissions, arrêt de processus, écriture brute sur périphérique, abandon de modifications locales ; **toute cible sensible** ; **tout ce qui n'est pas classifiable**                                                     |
| **R3** | effet externe ou destruction irréversible | publication distante, suppression récursive, réinitialisation destructive, destruction de données ou d'infrastructure, publication de paquet ou d'image, déploiement, mutation sur une forge distante, exécution ou copie distante, requête HTTP avec effet de bord, envoi de message |

### Les deux règles d'attribution qui font le travail

**L'inconnu est risqué, pas neutre.** Une commande shell qui ne correspond à
aucun motif connu tombe en **R2**, pas en R1. Un outil sans capacité déclarée
tombe en **R2**. C'était le correctif d'un finding bloquant : la version
initiale classait l'inconnu en R1, et le mode de confirmation laissait donc
passer sans confirmation un nouvel outil mutateur, une requête HTTP avec charge
utile, ou un script d'interpréteur. **L'arrivée de nouveaux outils augmentait
les chemins de contournement au moment précis où la garde devenait plus
nécessaire.**

**Le code inline n'est pas classifiable, donc il est au plus haut.** Un
interpréteur invoqué avec du code en argument (`-c`, `-e`, `--eval`) ne peut pas
être analysé statiquement : il est classé R3. Mais **sans refus dur**, pour ne
pas bloquer un usage bénin trivial — le mode demande confirmation.

### Cibles sensibles : canoniser avant de comparer

Un test d'inclusion de sous-chaîne sur un chemin est contournable par un chemin
relatif ou un lien symbolique. La primitive retenue — jugée comme le seul apport
de sécurité réel du composant — **canonise d'abord, compare ensuite** :

- résoudre le chemin en absolu depuis le répertoire courant ;
- remonter jusqu'au premier ancêtre existant, résoudre les liens symboliques
  réels sur celui-ci, puis ré-appliquer les segments manquants ;
- comparer les segments canoniques, pas la chaîne d'origine.

Classes de cibles sensibles reconnues : métadonnées de dépôt, répertoires de
credentials, fichiers d'environnement, fichiers de credentials, clés privées et
certificats.

Sur ces cibles, un **outil mutateur** déclenche un refus dur, là où un outil de
lecture ne déclenche qu'une confirmation : lire une clé est grave, l'écraser
est irréversible.

## Décision préalable : le mode gouverne, la classification informe

```
si mode invalide                          → block (fail-closed)
si mode ∈ {off, observe} ou niveau < R2   → allow
si mode = enforce et refus dur            → block
si aucune interface de confirmation       → block
sinon                                     → confirm
```

Le point critique est l'avant-dernier : **en l'absence d'interface capable de
poser la question, la garde bloque.** Un agent tournant sans interface ne doit
pas voir les confirmations se transformer en autorisations tacites.

## Attestation de sandbox : réduire la friction sans masquer le risque

Quand un shell s'exécute dans un bac à sable réel (machine virtuelle, isolation
OS), le rayon d'explosion est contenu et la friction devrait baisser. Le
mécanisme : un **registre de capacités** où le composant qui fournit
l'isolation enregistre une attestation, contrôlée à l'enregistrement :

```js
if (hostMounts !== 0)
  throw new Error("sandbox-capability-host-mounts-must-be-zero");
if (network !== "deny")
  throw new Error("sandbox-capability-network-must-be-deny");
if (typeof isActive !== "function")
  throw new Error("sandbox-capability-active-probe-required");
```

Aucun montage hôte, réseau refusé, et une sonde d'activité vérifiable :
l'attestation ne peut pas être enregistrée sans ces trois propriétés.

### La règle qui a dû être corrigée : ne jamais masquer un risque nommé

La première implémentation renvoyait **R1 en aveugle** dès qu'une attestation
était active, court-circuitant entièrement la classification. Une suppression
récursive à la racine passait donc silencieuse. Le modèle corrigé dégrade le
niveau **sans jamais effacer le finding** :

| Commande sous sandbox attesté                             | Niveau retenu                                         |
| --------------------------------------------------------- | ----------------------------------------------------- |
| consultation reconnue (R0)                                | R0                                                    |
| commande non classifiée (générique)                       | R1 — contenue, faible friction                        |
| **risque nommé** (suppression, publication, code inline…) | **plafonné à R2** — visible, confirmé, sans refus dur |

Le finding d'origine reste dans la liste et reste affiché à l'utilisateur. Le
sandbox **réduit la friction de l'inconnu**, il ne blanchit pas le connu.

Effet mesuré sur un corpus de 16 opérations : le taux de confirmation passe de
68,75 % à 0 % sous attestation active, **sans élargir un seul motif de
reconnaissance**. Dès que l'attestation devient inactive, les classifications
d'origine reviennent.

### Fraîcheur : TTL fail-closed

Une attestation est **auto-déclarée par le processus qu'elle atteste**. Sans
péremption, elle persiste indéfiniment — y compris après l'arrêt silencieux de
la machine virtuelle ou la mort de la sonde. Correctif : chaque capacité porte
un `ttlMs` (défaut : 5 minutes) et un horodatage d'attestation.

```js
// Attestation périmée → éviction + fail-closed.
if (!isCapabilityFresh(capability)) {
  registry().delete(normalizedTool);
  return undefined;
}
try {
  if (capability.isActive() !== true) return undefined;
} catch {
  return undefined; // une sonde qui lève est une sonde qui ne prouve rien
}
```

Trois propriétés fail-closed, chacune nécessaire :

1. **expiration par le temps** — même si la sonde répond encore `true` ;
2. **éviction du registre** — l'entrée périmée est retirée, pas seulement
   ignorée, pour qu'un ré-enregistrement soit exigé ;
3. **une sonde qui lève une exception vaut « inactif »** — jamais « actif ».

## Ce que ce modèle ne garantit pas

Ces limites sont établies par des probes de réfutation exécutées, pas
supposées. Elles sont la partie la plus importante du document.

**La classification textuelle n'est pas une frontière de sécurité.** Des
commandes à effet externe réel sont classées « génériques » ou « inconnues » par
n'importe quel jeu d'expressions régulières : une requête HTTP avec charge utile
sous une forme non prévue, un appel d'API de forge, un script d'interpréteur qui
effectue la mutation en Python. Verdict retenu : **conserver la classification
comme télémétrie et comme UX, jamais comme garantie.** En mode restrictif, un
outil inconnu doit être explicité ou traité comme sensible.

**Élargir les motifs ne corrige pas ce défaut** — c'est truquer la mesure. La
décision explicite a été de **rejeter tout élargissement** des expressions
régulières : un sandbox valide ne transforme pas une expression régulière en
frontière de sécurité, et l'inverse est également vrai.

**Une garde portée par une variable de session est perdue au remplacement de
session.** Finding bloquant : l'utilisateur active un mode restrictif, puis
ouvre une nouvelle session (ou reprend, ou bifurque) ; les extensions sont
rechargées et le mode revient à sa valeur par défaut, **silencieusement**.
Correctif : configuration durable en fichier atomique `0600`, le drapeau de
lancement ne pouvant que **renforcer** le mode, et une confirmation explicite
exigée avant tout affaiblissement.

**Un point d'entrée non couvert annule la garde.** Cas mesuré : le hook
intercepté par la garde était émis par un seul mode d'exécution. Un second mode
appelait directement la primitive d'exécution sans passer par le hook — le
shell hôte était donc utilisé alors qu'une extension d'isolation interceptait
correctement l'autre chemin. Deux leçons :

- **la garde doit être posée au lanceur, pas au hook** — le lanceur refuse les
  points d'entrée directs, ce qu'un hook ne peut pas faire ;
- **un exécuteur qui absorbe les exceptions des handlers rend le fail-closed
  impossible** : si une extension d'isolation échoue pendant l'interception et
  que l'exécuteur retourne « pas de résultat », l'appelant retombe sur les
  opérations locales. Un mode strict doit distinguer _aucun handler_, _handler
  ayant décliné_, _handler ayant fourni des opérations_ et _handler en erreur_.

**L'ordre d'enregistrement des outils compte.** Quand plusieurs extensions
peuvent enregistrer un outil du même nom et que l'hôte conserve le premier, la
composition doit garantir que l'extension d'isolation est bien celle qui gagne
— **avant** de faire confiance à son attestation.

**Le journal reste une surface de fuite.** Toute chaîne affichée en confirmation
ou journalisée passe par une expurgation : clés privées, en-têtes
d'autorisation, jetons porteurs, variables d'environnement à nom sensible,
options de ligne de commande portant un secret, credentials en URL, adresses de
courriel, et remplacement du répertoire personnel par `~`. Cette expurgation est
une **défense secondaire, best effort** — elle réduit les fuites évidentes, elle
ne prouve rien.

## Verdict d'ensemble

Le modèle a été jugé **non promouvable en garde de sécurité** et retenu
uniquement comme mécanisme d'explicabilité et de mesure, en laboratoire. La
seule primitive jugée solide est la **canonisation des cibles avant
comparaison**. Le reste dépend d'une isolation réelle : sans elle, le gate de
friction échoue toujours, et c'est le résultat correct.
