# PRV-11 — Coffre et injection par mandat

## Contexte

P37 est le coffre de secrets du catalogue d'ADR-0042 §1, ouvert en avance de son domaine par D53. Cette brique est la méthode que la fabrique s'applique, pas ce produit. Le verrou d'I-09 interdit qu'un jeton contienne un secret ou un identifiant de fournisseur. I-18 donne à chaque agent une identité, des capacités et une révocation. Aucun coffre n'existe dans la flotte, et rien n'y remet un secret sous mandat.

## Ce que la brique ferme

- Le secret long posé dans un runner ou dans l'environnement d'un agent : il est remis au point d'usage, pour la durée du mandat.
- Le secret lu par un modèle : il ne passe ni par un prompt ni par un contexte.
- Le secret qui survit à la mission : la révocation par agent d'I-18 éteint ce qui a été remis.
- La remise sans trace : chaque injection est consignée au journal PRV-01, sans la valeur.

## Ce qu'elle ne fait pas

- Elle n'est pas le produit P37, qui reste hors de la carte tant qu'il n'a pas de charte.
- Elle ne gère pas les clés de signature : c'est PRV-04.
- Elle n'émet pas le mandat : le jeton atténué est IDN-02.
- Un agent n'y écrit pas seul : tout secret est un acte du propriétaire.

## Mesure

- Preuve citée : aucune. Le gate qui refuse un identifiant commité garde une frontière ; il ne réalise ni coffre ni injection.
- Prochain fait observable : une mission qui reçoit un secret par un jeton atténué, l'utilise, puis échoue à le relire après révocation, avec la remise lisible au journal.
