# PUB-02 — Catalogue à statut dérivé

## Contexte

Le catalogue d'applications est la table d'ADR-0042 §1 (D52), et ADR-0064 en fait une projection vérifiée de la carte. I-15 n'admet de vitrine publique d'un produit que dès qu'une chose est vérifiable. Dans `project-governance`, un module calcule l'état affiché de chaque dépôt depuis sa fiche `project.v1.yaml`, et le profil d'organisation publie la table qui en sort. Il n'existe pas de catalogue par produit dont l'état vient des preuves de sa brique.

## Ce que la brique ferme

- Un produit présenté comme disponible alors qu'il n'est qu'une intention : l'état affiché est calculé, jamais déclaré (I-15).
- Un nombre de produits ou de dépôts écrit dans une page (I-14).
- Une table publiée qui s'écarte de sa source en silence : I-05 la tient pour une projection, comparée à un rendu neuf.

## Ce qu'elle ne fait pas

- Elle ne décide ni le gel ni le dégel d'un produit : c'est GOV-03.
- Elle ne publie pas les rapports et les verdicts, laissés à PUB-04 : elle y renvoie.
- Elle ne rédige aucune promesse, qui appartient à PUB-07.

## Mesure

Preuves citées : le module qui calcule l'état de chaque dépôt depuis sa fiche, et le contrôle qui compare le README d'organisation publié à un rendu neuf. Elles montrent que l'état est dérivé et qu'un écart est détecté. Elles ne montrent pas que la table publiée est à jour : au relevé du 2026-11-11, les quatre dernières exécutions planifiées de ce contrôle sont en échec.

Prochaine preuve : ce contrôle vert sur la branche servie, puis un catalogue par produit généré depuis la carte.
