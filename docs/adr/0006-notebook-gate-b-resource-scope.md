# ADR-0006 — Matrice matérielle requise pour Notebook Gate B

- **Statut :** accepted
- **Date :** 2026-07-18
- **Portée :** Notebook Core v2 Gate B et déclaration de support matériel
- **Décision propriétaire solo :** les classes physiques 8 Gio et 16–24 Gio deviennent des contributions facultatives ; seule la classe 32+ Gio reste requise dans la matrice Gate B actuelle

## Contexte

L'ADR-0005 maintenait Gate B en rejet en l'absence de mesures physiques 8 Gio et 16–24 Gio, tout en prévoyant explicitement une réduction gouvernée de la matrice. Le candidat `96934a8` a fermé les preuves locales du host exact, des fautes et de l'`ENOSPC`. Une nouvelle campagne physique sur la machine de référence 32+ Gio et les archives bootstrap exactes passe les budgets verrouillés dans Chromium, Firefox et WebKit.

Les deux classes modestes ne sont pas disponibles localement. Les garder comme conditions obligatoires confondrait une ambition de support large avec le minimum effectivement qualifié. Les déclarer passées sans matériel serait en revanche une extrapolation interdite.

## Décision

1. `desktop-arm64-high-memory-reference` devient le minimum matériel candidat de la matrice Gate B actuelle : macOS arm64, au moins 32 Gio de mémoire physique et 12 CPU logiques.
2. `desktop-arm64-constrained-8gib` et `desktop-arm64-mainstream-16gib` restent des classes d'observation communautaire. Leurs issues, budgets, bornes et protocoles restent ouverts, mais leur absence ne bloque plus Gate B.
3. Aucune preuve 32+ Gio n'est extrapolée vers 8 Gio ou 16–24 Gio. Ces classes ne peuvent être annoncées comme supportées avant mesure physique hashée et passe `review-only`.
4. Les budgets, profils Argon2id, limite plaintext 16 Mio, quota candidat 512 Mio et trois moteurs restent inchangés.
5. Cette réduction de portée n'approuve pas l'OOM processus, l'activation, les données utilisateur, la production, la release, l'offline/Service Worker ou l'effacement physique.
6. Une release future doit publier un minimum système explicite correspondant aux classes réellement qualifiées. L'application ne doit pas collecter ni transmettre la mémoire physique pour tenter de deviner une classe.
7. Étendre ensuite le support à 8 Gio ou 16–24 Gio exige seulement une nouvelle preuve physique et les revues concernées, sauf si la mesure révèle un défaut nécessitant un nouveau candidat source.
8. La décision propriétaire finale confirme que ces contributions restent facultatives : leur absence ne doit plus être réintroduite comme condition bloquante de la Gate B actuelle. Toute modification future de cette portée exigerait une nouvelle décision propriétaire explicite et un nouvel ADR.

## Conséquences

- la preuve physique 32+ Gio peut fermer l'axe matériel de Gate B sans waiver ni simulation ;
- les contributions #98 et #99 deviennent « nice to have » et ne portent aucun engagement de support ;
- le verdict Gate B reste déterminé par les autres findings, notamment l'OOM processus navigateur attribuable ;
- la documentation et le manifeste machine-readable doivent distinguer minimum qualifié et observations communautaires ;
- tout futur élargissement du support reste additif et auditable.

## Alternatives rejetées

- **Prétendre supporter les classes non mesurées :** rejeté, car non démontré.
- **Simuler 8/16 Gio sur la machine 32+ Gio :** diagnostic seulement, jamais promouvable.
- **Supprimer les classes et leurs issues :** rejeté ; leurs contributions restent utiles pour élargir ultérieurement le support.
