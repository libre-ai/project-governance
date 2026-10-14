# Conception de modules — vocabulaire et stratégie de test

- **Portée :** le vocabulaire et les tests de décision employés pour concevoir
  ou restructurer du code de la flotte (outillage de ce dépôt, briques,
  produits) : où placer une interface, quand une abstraction se justifie,
  comment tester à travers elle. Méthode, pas doctrine : rien ici n'est un
  invariant, et un ADR qui tranche autrement prime.
- **Statut :** proposé le 2026-10-13, en même temps qu'ADR-0050 et ADR-0051 ;
  la fusion de la pull request qui l'introduit l'inscrit dans la carte
  d'autorité (`docs/README.md`).

## Vocabulaire

Ces termes s'emploient tels quels ; leur constance est l'objet même du
vocabulaire. La colonne « à éviter » donne les mots qui les remplacent à tort.

| Terme | Définition | À éviter |
| --- | --- | --- |
| **module** | Tout ce qui a une interface et une implémentation, quelle que soit l'échelle : fonction, fichier, paquet, crate, tranche qui traverse plusieurs couches | composant, service, unité |
| **interface** | Tout ce qu'un appelant doit savoir pour utiliser le module correctement : la signature, et aussi les invariants, l'ordre des appels, les modes d'erreur, la configuration requise, le coût | API, signature (ne nomment que la surface de types) |
| **implémentation** | Ce qu'il y a dans le module, son corps | — |
| **profondeur** | Le levier qu'offre l'interface : la quantité de comportement qu'un appelant ou un test exerce par unité d'interface à apprendre. Un module est **profond** quand beaucoup de comportement tient derrière une petite interface, **mince** quand l'interface est presque aussi complexe que l'implémentation | ratio de lignes (récompense le remplissage) |
| **couture** (*seam*, Feathers) | L'endroit où l'on change un comportement sans éditer cet endroit ; le lieu où vit l'interface d'un module. Placer la couture est une décision distincte de ce qu'on met derrière | frontière (pris par le *bounded context*) |
| **adaptateur** (*adapter*) | Ce qui satisfait une interface à une couture. Le mot nomme un rôle, pas un contenu | — |
| **levier** | Ce que la profondeur rapporte aux appelants : une implémentation sert N appelants et M tests | — |
| **localité** | Ce que la profondeur rapporte aux mainteneurs : changement, défaut, savoir et vérification au même endroit | — |

Le contexte borné (*bounded context*) — un dépôt, sa base, son déployable —
reste une notion d'architecture de flotte : il ne se dit jamais « couture ».

## Quatre tests de décision

1. **Le test de suppression.** Imaginer le module supprimé. Si la complexité
   disparaît, il ne faisait que transmettre ; si elle réapparaît chez ses N
   appelants, il gagnait sa place.
2. **L'interface est la surface de test.** Les appelants et les tests
   traversent la même couture. Un test qui doit passer *derrière* l'interface
   pour vérifier un comportement signale un module mal découpé. Exemple de ce
   dépôt : `tools/quality/check-review-evidence.ts` sépare un verdict pur
   (`evaluateReviewEvidence`, testé sans git ni API) d'une moitié à effets qui
   rassemble le diff et le corps de la pull request.
3. **Un adaptateur, couture hypothétique ; deux adaptateurs, couture réelle.**
   Une couture ne s'introduit que si quelque chose varie réellement à travers
   elle — typiquement l'adaptateur de production et l'adaptateur de test. Une
   couture à un seul adaptateur n'est qu'une indirection.
4. **La profondeur se juge à l'interface.** Un module profond peut être fait
   de petites pièces internes, remplaçables et testées par ses propres tests ;
   elles ne font pas partie de son interface. Des coutures internes n'ont pas à
   être exposées parce que des tests les emploient.

## Quatre catégories de dépendance, quatre stratégies de test

Avant d'approfondir un groupe de modules minces, classer ses dépendances : la
catégorie dicte comment le module approfondi se teste à travers sa couture.

| Catégorie | Exemple | Stratégie |
| --- | --- | --- |
| **en processus** — calcul pur, état en mémoire, aucune E/S | le TF-IDF et le radical de `tools/skills/check-skills-routing.ts` | fusionner et tester directement par la nouvelle interface ; aucun adaptateur |
| **substituable localement** — un remplaçant local existe | `git` dans un dépôt temporaire, un système de fichiers en répertoire jetable | le remplaçant tourne dans la suite de tests ; la couture reste interne, aucun port à l'interface |
| **distante mais possédée** — un service de la flotte derrière le réseau | un service produit appelé par un autre | un port à la couture, un adaptateur réseau en production, un adaptateur en mémoire en test ; la logique reste dans un seul module profond |
| **réellement externe** — un tiers qu'on ne contrôle pas | l'API GitHub, un registre de paquets | le module reçoit la dépendance comme port injecté ; les tests fournissent un adaptateur simulé |

**Remplacer, ne pas empiler.** Quand des tests existent à l'interface du module
approfondi, les anciens tests des modules minces deviennent du gaspillage et
partent. Les tests vérifient des issues observables à travers l'interface, pas
un état interne ; un test qui doit changer quand l'implémentation change teste
derrière l'interface. Le retrait se prouve : chaque test conservé à
l'interface doit rougir quand on remet, par substitution, le défaut que
couvrait le test retiré.

## Où regarder d'abord : les points chauds

Approfondir un module paie en rendant ses changements futurs plus faciles ; le
regard se porte donc d'abord sur ce qui change souvent. Sans direction donnée
(un module, un sous-système, une douleur nommée), lister les fichiers de code
les plus modifiés sur une fenêtre récente :

```sh
git log --since=60.days --format= --name-only -- '*.ts' '*.rs' \
  | grep . | sort | uniq -c | sort -rn | head -20
```

Si les changements sont épars, sans point chaud net, élargir la fenêtre ou le
périmètre. Une proposition qui contredit un ADR existant se signale comme
telle, avec la friction mesurée qui justifierait de le rouvrir ; elle ne
l'écrase jamais, et une friction théorique ne suffit pas à le rouvrir.

## Sources

Idées dégagées le 2026-10-13 du drill du dépôt amont `mattpocock/skills`
(licence MIT, HEAD `49dd158d`) : ses skills `codebase-design` (et son annexe
sur l'approfondissement) et `improve-codebase-architecture`. Le vocabulaire y
cite John Ousterhout (modules profonds) et Michael Feathers (*seam*). Aucun
texte n'est repris verbatim ; les exemples sont ceux de ce dépôt.
