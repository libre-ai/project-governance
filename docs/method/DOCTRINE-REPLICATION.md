# Réplication de doctrine — source canonique, adaptateurs générés, contrôle de dérive

> **Provenance.** Extrait d'un dépôt privé de configuration machine avant sa
> suppression, le 2026-07-26. Le dépôt d'origine n'existe plus : ce document
> est autoportant et ne renvoie à aucune de ses ressources. Les éléments
> propres à une machine (chemins, agents de lancement, configuration réelle)
> ont été écartés ; seul le patron réutilisable est conservé.

Plusieurs harness agentiques (assistants de code pilotés par un fichier de
doctrine) coexistent sur un même poste ou dans une même organisation. Chacun
lit son propre fichier d'instructions, à son propre emplacement, dans son
propre format. La tentation est de maintenir la doctrine **à la main dans
chaque cible**. C'est la panne décrite ici, et le patron qui la corrige.

## Le problème : la duplication manuelle dérive en silence

Constat mesuré sur un poste réel : le même bloc de doctrine (axes de décision,
conventions de communication, invariants d'ingénierie) était maintenu en trois
copies manuelles, une par harness. Aucune n'était versionnée. Trois propriétés
manquaient simultanément :

- **Non-reconstructible** — aucune des surfaces n'existait dans un dépôt ; une
  perte de poste était une perte sèche.
- **Dérive invisible** — rien ne signalait qu'une copie avait divergé des
  autres ; la divergence ne se découvrait qu'à l'usage, par un comportement
  d'agent incohérent d'un outil à l'autre.
- **Édition au mauvais endroit** — corriger la doctrine dans la copie qu'on a
  sous les yeux laisse les deux autres en arrière.

La duplication n'est pas fautive en soi (« duplication > mauvaise
abstraction »). Ce qui est fautif, c'est la duplication **sans mécanisme de
convergence**.

## Le patron : une source paramétrée, N rendus, une sentinelle, un contrôle

```
canonical/            source unique, paramétrée par des marqueurs {{HARNESS}}, {{AGENT}}
   │
   ├── render ──────►  rendered/<cible>   golden files, versionnés
   │                        │
   │                        └── deploy ──►  emplacement réel de chaque harness
   │
   └── check ────────►  compare canonique ↔ golden ↔ déployé
```

Quatre pièces, chacune répondant à une panne précise.

### 1. La source canonique est paramétrée, jamais dupliquée

Un seul fichier porte la doctrine. Les rares différences entre cibles (le nom
du harness, le nom sous lequel l'agent se désigne) sont des **marqueurs
substitués au rendu**, pas des variantes de contenu :

```bash
render() { # $1=HARNESS $2=AGENT $3=fichier de sortie
  {
    printf '%s\n\n' "$SENTINEL"
    sed -e "s/{{HARNESS}}/$1/g" -e "s/{{AGENT}}/$2/g" canonical/identity-core.md
  } >"$3"
}
```

Quand une cible a de vraies spécificités, elles vivent dans une **surcouche**
concaténée après le tronc commun (`canonical/overlays/<cible>.md`), jamais dans
une seconde copie du tronc. Un profil délibérément divergent est une décision
explicite et tracée, pas un effet de bord.

### 2. La sentinelle empêche d'écraser un fichier écrit à la main

Chaque rendu commence par une ligne qui déclare son origine :

```
<!-- GENERATED from canonical/. Edit the canonical source, then re-run the generator. -->
```

Le déploiement **refuse** d'écraser une cible existante qui ne porte pas cette
sentinelle, et sort en erreur distincte :

```bash
if [ -f "$dst" ] && ! head -1 "$dst" | grep -qF 'GENERATED from canonical/'; then
  if [ "${FORCE:-0}" != "1" ]; then
    echo "REFUS: $dst existe sans sentinelle (manuscrit ?). Relancer avec FORCE=1." >&2
    exit 3
  fi
fi
```

C'est la garde qui rend l'adoption sûre : un fichier de doctrine préexistant,
écrit à la main et jamais sauvegardé, n'est pas détruit par le premier
déploiement. L'échappatoire (`FORCE=1`) existe mais doit être demandée.

### 3. Le contrôle de dérive compare les trois états, pas deux

Un golden file seul ne suffit pas. Trois états peuvent diverger, et les deux
divergences ont des causes différentes :

| Comparaison         | Ce qu'une divergence révèle                                 |
| ------------------- | ----------------------------------------------------------- |
| canonique ↔ golden  | le générateur n'a pas été rejoué après édition du canonique |
| canonique ↔ déployé | une cible a été éditée à la main, ou n'a pas été redéployée |

Le mode `check` est **strictement read-only** : il diagnostique, il ne répare
pas. La réparation est une commande distincte, délibérée.

### 4. Le smoke prouve la présence, pas seulement l'égalité

Le contrôle de dérive suppose que les cibles existent. Un smoke séparé vérifie
que chaque harness est installé, que sa doctrine porte bien la sentinelle, et
qu'un réglage sensible n'est pas revenu. Sortie **stable ligne à ligne**,
comparable à une baseline versionnée : un diff non vide = régression à
examiner.

Le smoke normalise ce qui bouge légitimement (numéros de version → `<v>`) pour
que seule la régression réelle produise du bruit.

## La leçon la plus chère : un garde-fou doit prouver qu'il a tourné

Le contrôle de dérive était planifié périodiquement sur le poste. **Il est mort
en silence pendant quinze jours.** Le planificateur du système d'exploitation ne
pouvait pas exécuter un script situé dans un répertoire protégé par le contrôle
d'accès aux fichiers de l'OS — le processus sortait en code 126, « operation
not permitted », avant toute ligne du script.

La panne était **auto-masquante** : le journal et la notification d'alerte
vivaient _dans le script qui ne démarrait pas_. Rien ne remontait. Le silence
se lisait exactement comme « tout va bien ».

Deux corrections, dont une seule est structurelle :

1. **Sortir la moitié hôte-indépendante du contrôle vers la CI.** Comparer le
   canonique aux golden files ne demande aucun accès au poste : ce sous-ensemble
   tourne sur un runner, où aucune protection locale ne peut le neutraliser.
   La comparaison aux cibles réellement déployées reste locale, faute de mieux.

   ```bash
   check-goldens)   # sous-ensemble vérifiable SANS la machine de l'opérateur
     rc=0
     while IFS=: read -r rel _dst; do
       diff -u "rendered/$rel" "$tmp/$rel" >/dev/null 2>&1 || {
         echo "DRIFT(golden): rendered/$rel ne correspond plus au canonique"; rc=1; }
     done < <(targets)
     exit "$rc"
   ```

2. **Exiger une preuve d'exécution positive.** Un garde-fou qui n'écrit rien
   quand tout va bien est indiscernable d'un garde-fou mort. Écrire une ligne
   `ok` horodatée à chaque passage rend la panne détectable : c'est
   _l'absence de lignes récentes_ qui alerte, pas la présence d'une erreur.

**Règle générale à retenir : ne jamais placer le seul canal d'alerte d'un
contrôle à l'intérieur du processus que ce contrôle surveille.**

## Codes de retour : « rien trouvé » n'est pas « n'a pas pu chercher »

Un contrôle d'hygiène qui échoue à s'exécuter doit être distinguable d'un
contrôle qui s'exécute et ne trouve rien. Trois codes, jamais deux :

| Code | Signification                                          |
| ---- | ------------------------------------------------------ |
| `0`  | recherche effectuée, rien trouvé                       |
| `1`  | recherche effectuée, violation trouvée                 |
| `2`  | la recherche **n'a pas pu être menée** (panne d'infra) |

Le code 2 est traité comme un échec par l'appelant. Sans lui, un mauvais
répertoire courant, un checkout vide ou un motif invalide se lisent comme un
succès. Le contrôle publie aussi son **inventaire** — combien de fichiers il a
réellement examinés — et échoue si ce nombre est zéro : c'est la seule façon de
prouver qu'il avait de quoi chercher.

## Le pattern se réplique, il ne se partage pas

Quand plusieurs contextes étanches (par exemple deux organisations, ou un
périmètre personnel et un périmètre professionnel) ont chacun besoin de ce
mécanisme, la tentation est de factoriser l'outillage en dépendance commune.
**Décision retenue : répliquer le patron, jamais partager une dépendance
vivante.**

Motif : une dépendance vivante recoud deux contextes que l'on a délibérément
séparés — elle crée un chemin par lequel un fait, un chemin ou un identifiant
d'un contexte peut atteindre l'autre. Le coût de la réplication (quelques
dizaines de lignes de shell par contexte) est très inférieur au coût d'une
fuite inter-contextes, qui est irréversible dès lors qu'un des contextes est
public.

## Deux régimes : ce qui doit converger, ce qui doit diverger

Tout ce qui précède suppose une chose sans la dire : que **toute divergence est
un défaut**. C'est vrai des objets que ce patron a été écrit pour protéger —
invariant, garde-fou, code de refus, contrat — où deux copies qui diffèrent
signifient qu'au moins une est fausse, et où le contrôle de dérive est le seul
moyen de savoir laquelle.

Ce n'est pas vrai de tout ce qu'on réplique. Un prompt, un seuil, une définition
locale de « fait », un choix de modèle par rôle : ces objets sont du **jugement
local**. Deux copies qui divergent peuvent être justes toutes les deux, parce
qu'elles répondent à deux contextes différents. Les tenir sous contrôle de
dérive produit un objet qui ne colle à aucun contexte, que chacun finit par
contourner plutôt qu'éditer — et un contournement ne laisse pas de trace, là où
une édition en laisse une.

**Le test qui range un objet dans son régime :** si deux copies divergent, l'une
des deux est-elle nécessairement fausse ? Oui → régime convergent. Non →
régime divergent.

|                   | Régime convergent                           | Régime divergent                                          |
| ----------------- | ------------------------------------------- | --------------------------------------------------------- |
| Objets            | invariants, gates, codes de refus, contrats | prompts, seuils, rosters, définitions locales             |
| Ce qu'on réplique | le contenu, à l'identique                   | le point de départ, une fois                              |
| Ce qu'on contrôle | l'**écart** — canonique ↔ golden ↔ déployé  | la **provenance** — de quelle version cette copie descend |
| Divergence        | échec du contrôle                           | comportement attendu                                      |
| Échec du régime   | la copie dérive en silence                  | la copie ne sait plus d'où elle vient                     |

En régime divergent, le mécanisme n'est donc pas un rendu golden mais un
**en-tête de provenance** dans la copie : la source et la révision dont elle
descend. Le contrôle vérifie que cet en-tête est présent et résoluble, jamais
que le contenu est identique. Une copie sans provenance est le vrai défaut de ce
régime — pas une copie qui a changé.

**Le piège est le mauvais rangement, dans les deux sens.** Un garde-fou traité
comme du jugement local devient une doctrine locale que personne ne gouverne. Un
prompt traité comme une norme devient une norme que tout le monde contourne.

> **Provenance de la distinction.** Confrontation, le 2026-08-04, avec une
> fabrique d'agents tierce qui applique le régime inverse et l'assume : elle
> tamponne son outillage dans un dépôt cible une fois, puis pose que les prompts
> appartiennent au dépôt qui les reçoit et que rien n'est censé survivre intact
> au contact d'une base de code. Ce n'est pas l'opposé de ce patron ; c'est le
> même patron appliqué à l'autre classe d'objets.

## Responsabilités par niveau (poupées russes)

La doctrine se hiérarchise. Chaque niveau porte l'intégralité de ce qui est
nécessaire à son périmètre, hérite explicitement des invariants du parent, et
**référence** ses enfants sans dupliquer ce qu'un lien suffit à donner :

1. **Poste** — comment on décide, comment on communique, invariants
   d'ingénierie indépendants de tout projet.
2. **Racine de contexte** — frontière du contexte, objectifs, conventions de
   forge (remotes, flux de merge, garde-fous CI).
3. **Dépôt** — finalité, périmètre, interfaces, commandes, tests, critères de
   succès, modes d'échec, liens vers les parents et les enfants.
4. **Sous-périmètre** — spécialisation locale uniquement, et seulement si elle
   est justifiée.

Une même règle énoncée à quatre niveaux est une dette : elle dérive. La règle
vit **au niveau le plus haut où elle est vraie**, et les niveaux inférieurs y
renvoient.

L'instanciation concrète du niveau « Dépôt » pour un `AGENTS.md` de la flotte
libre-ai — sections obligatoires et plafond de lignes par couche du registre —
est fixée par `docs/method/CONTEXT-TEMPLATE.md` et vérifiée mécaniquement par
`ecosystem/check-context-conformance.ts`.

## Mécanismes de chargement — vérifier avant de construire

Le patron dépend de la façon dont chaque outil découvre son fichier de
doctrine. Ce comportement est **spécifique au fournisseur et change entre
versions** : il se vérifie empiriquement avant d'écrire un adaptateur, jamais
de mémoire.

Points vérifiés sur au moins un harness, à re-vérifier pour tout autre :

- Les fichiers de doctrine des répertoires **ancêtres** du répertoire courant
  peuvent être chargés nativement, du plus général au plus spécifique. Quand
  c'est le cas, les « racines de contexte » fonctionnent sans mécanisme
  maison — un fichier posé à la racine d'un arbre de projets s'applique à tous.
- Un outil qui ne lit pas nativement le nom de fichier d'un autre écosystème se
  raccorde par un **adaptateur minimal** : un fichier au nom attendu contenant
  une directive d'import vers le fichier canonique, ou un lien symbolique.
- Les imports sont typiquement expansés **au lancement**, avec une profondeur
  maximale. Ils ne réduisent donc pas le contexte consommé : le chargement
  réellement paresseux passe par d'autres mécanismes (compétences invoquées à
  la demande, règles conditionnées à un chemin).

Corollaire : tout ce qui n'est pas décisionnel **à chaque session** doit
descendre du noyau permanent vers un mécanisme chargé à la demande. Le noyau se
paie en tokens à chaque session, indéfiniment.

## Ce que ce patron ne fait pas

- Il ne rend pas la doctrine **correcte** — il la rend cohérente et
  reconstructible. Une doctrine fausse sera fidèlement répliquée partout.
- Il ne protège pas les **secrets** : aucune source canonique ni aucun rendu ne
  doit contenir de secret. Les fichiers d'authentification des harness restent
  hors de tout dépôt.
- Il ne remplace pas un garde-fou de contenu. Un contrôle séparé doit vérifier
  qu'aucun fait d'un contexte étanche n'entre dans une source destinée à être
  publiée — et ce contrôle doit être **bloquant au merge**, pas indicatif.
