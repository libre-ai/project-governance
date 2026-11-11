# GOV-13 — Rétention et effacement exécutables

## Contexte

I-10 exige une rétention exécutable et une suppression prouvable. ADR-0002 fixe les durées par type de donnée, et D17 en fait la source des schémas, des purges et des sauvegardes. ADR-0049 a élargi I-10 aux exportations. La politique de rétention est un contrat de `schemas-and-contracts`. Le dépôt `organization-data-lifecycle` porte le balayage et le reçu de suppression. Sa fiche déclare que cet arbre n'est pas requalifié. Aucune classe de données ne relie encore une catégorie à sa durée.

## Ce que la brique ferme

- Une durée de rétention écrite et jamais appliquée : le balayage sélectionne ce qui a expiré, puis supprime.
- Une suppression décidée sur une lecture périmée : l'unité est revérifiée dans la transaction qui la supprime.
- Une suppression sans trace : le reçu nomme les magasins et des empreintes, jamais le contenu supprimé.
- Une donnée d'organisation lue hors de son tenant (I-21).

## Ce qu'elle ne fait pas

- Elle ne fixe pas les durées : elles viennent du contrat tenu par GOV-07.
- Elle ne traite pas l'oubli d'un contenu du dépôt, qui relève d'I-23.
- Elle ne connaît aucun produit : chaque produit fournit sa sélection.

## Mesure

Preuves citées, épinglées au commit de la branche servie de `organization-data-lifecycle` : le balayage de rétention en deux phases et le constructeur de reçu de suppression. Elles montrent le mécanisme écrit, pas une rétention exécutée sur des données en service.

Prochaine preuve : un balayage exécuté sur l'instance d'un produit en service, avec un reçu qu'un tiers vérifie.
