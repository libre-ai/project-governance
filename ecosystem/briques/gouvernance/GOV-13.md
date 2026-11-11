# GOV-13 — Rétention et effacement exécutables

## Contexte

I-10 exige une rétention exécutable et une suppression prouvable. ADR-0002 §3 fixe les durées par type de donnée, et D17 en fait la source des schémas, des purges et des sauvegardes. La politique de rétention et le reçu de suppression sont des contrats du catalogue de `schemas-and-contracts`. Le dépôt `organization-data-lifecycle` porte le balayage et le constructeur de reçu. Sa fiche, au commit cité, déclare que cet arbre n'est pas requalifié.

## Ce que la brique ferme

Le code cité écrit les fermetures suivantes ; la fiche de son dépôt déclare, au commit cité, que le comportement de cet arbre reste à vérifier.

- Une durée de rétention écrite et jamais appliquée : le balayage résout la durée, demande au produit ce qui a expiré, puis lance la suppression unité par unité.
- Une durée devinée : sans règle enregistrée ni valeur au contrat, le balayage refuse de tourner.
- Une suppression sans trace : le reçu nomme les magasins et des empreintes, jamais le contenu supprimé, et le constructeur refuse une empreinte qui n'a pas la forme d'un SHA-256.
- Un reçu sans sujet : le constructeur refuse une suppression qui n'en nomme aucun.

## Ce qu'elle ne fait pas

- Elle ne fixe pas les durées. Sans GOV-07, le balayage n'a pas de durée par défaut à appliquer : à défaut d'une règle enregistrée pour le tenant, elle vient du contrat de rétention.
- Elle ne connaît aucun produit : chaque produit fournit sa sélection et sa suppression.
- Elle ne revérifie pas elle-même une unité avant de la supprimer : l'interface impose au produit de le faire dans la transaction qui supprime, et le module cité ne le contrôle pas.
- Elle ne rend pas un reçu par unité balayée : le balayage n'appelle pas le constructeur de reçu, et son rapport porte des comptes et les identifiants de reçus déjà émis.
- Elle ne tient pas de registre des blocages légaux : le contrôle prévu rend une liste vide dans cette version, et le module l'écrit.

## Mesure

Preuves citées, épinglées à un commit de `organization-data-lifecycle` : le balayage de rétention en deux phases et le constructeur de reçu de suppression. Elles montrent le mécanisme écrit, pas son exécution : la fiche du dépôt porteur écrit que ses tests et son intégration continue n'ont pas été rejoués pour cet arbre. Elles ne montrent pas une rétention exécutée sur des données en service.

Prochaine preuve : un balayage exécuté sur l'instance d'un produit en service, avec un reçu qu'un tiers vérifie.
