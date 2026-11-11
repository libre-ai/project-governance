# GOV-13 — Rétention et effacement exécutables

## Contexte

I-10 exige une rétention exécutable et une suppression prouvable. ADR-0002 §3 fixe les durées par type de donnée, et D17 en fait la source des schémas, des purges et des sauvegardes. La politique de rétention et le reçu de suppression sont des contrats du catalogue de `schemas-and-contracts`. Le dépôt `organization-data-lifecycle` porte le balayage et le constructeur de reçu. Sa fiche, au commit cité, déclare que cet arbre n'est pas requalifié.

## Ce que la brique ferme

- Une durée de rétention écrite et jamais appliquée : le balayage sélectionne ce qui a expiré, puis supprime.
- Une suppression décidée sur une lecture périmée : l'unité est revérifiée dans la transaction qui la supprime.
- Une suppression sans trace : le reçu nomme les magasins et des empreintes, jamais le contenu supprimé.
- Un reçu sans sujet : le constructeur refuse une suppression qui n'en nomme aucun.

## Ce qu'elle ne fait pas

- Elle ne fixe pas les durées. Sans GOV-07, le balayage n'a pas de durée à appliquer : elles viennent du contrat de rétention.
- Elle ne connaît aucun produit : chaque produit fournit sa sélection.
- Elle ne tient pas de registre des blocages légaux : le contrôle prévu rend une liste vide dans cette version, et le module l'écrit.

## Mesure

Preuves citées, épinglées à un commit de `organization-data-lifecycle` : le balayage de rétention en deux phases et le constructeur de reçu de suppression. Elles montrent le mécanisme écrit. Elles ne montrent pas une rétention exécutée sur des données en service.

Prochaine preuve : un balayage exécuté sur l'instance d'un produit en service, avec un reçu qu'un tiers vérifie.
