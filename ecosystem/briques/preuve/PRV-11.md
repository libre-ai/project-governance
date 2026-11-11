# PRV-11 — Coffre et injection par mandat

## Contexte

P37 est le coffre de secrets du catalogue d'ADR-0042 §1, que D53 ouvre en avance de son domaine. Cette brique est la méthode que la fabrique s'appliquerait, pas ce produit. Aucun invariant du registre ne la lie : I-09 et I-18 portent sur les jetons et l'identité des agents, et ne sont pas cités. La spécification d'identité de ce dépôt (`docs/specifications/IDENTITY-AUTHORIZATION.md`) interdit qu'un jeton contienne un secret ou un identifiant de fournisseur. La remise d'un secret sous mandat est une proposition de l'agent, non arbitrée. La brique dépend d'IDN-02 : sans jeton atténué, aucun mandat ne borne la portée et la durée d'une remise. Elle dépend d'IDN-04 : sans identité de mission, elle ne sait pas à qui elle remet.

## Ce que la brique ferme

Cette fiche ne cite aucune preuve et la carte ne donne à la brique aucun dépôt porteur : aucune des fermetures ci-dessous n'est montrée réalisée.

- Le secret long posé dans un runner ou dans l'environnement d'un agent : il serait remis au point d'usage, pour la durée du mandat.
- Le secret lu par un modèle : il ne passerait ni par un prompt ni par un contexte.

## Ce qu'elle ne fait pas

- Elle n'est pas le produit P37, qui n'est pas une brique de la carte.
- Elle ne gère pas les clés de signature : c'est PRV-04.
- Elle n'émet pas le mandat : le jeton atténué est IDN-02.

## Mesure

- Preuve citée : aucune. Le gate de ce dépôt qui cherche un secret commité (`tools/quality/check-secret-scan.ts`) garde une frontière ; il ne réalise ni coffre ni injection.
- Prochain fait observable : une mission qui reçoit un secret par un jeton atténué, l'utilise, puis échoue à le relire après révocation.
