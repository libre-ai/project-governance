# ADR-NNNN — <titre : la décision, en une ligne>

<!--
Mode d'emploi. Ce fichier est un gabarit de méthode, pas une décision : il ne
porte aucun numéro et ne vit pas dans `docs/adr/`. Pour écrire un ADR, copier ce
fichier sous `docs/adr/NNNN-<slug>.md`, remplacer NNNN par le numéro suivant de
la série (le dériver de la liste des fichiers de `docs/adr/`, ne pas le citer
de mémoire), remplir chaque rubrique, puis retirer tous les commentaires.

Valeurs admises de la ligne Statut :
  1. proposé
  2. accepted
  3. accepted, amendé par ADR-NNNN
  4. remplacé par ADR-NNNN
Le mot « accepted » reste le littéral du statut accepté : le garde de
gouvernance de la doctrine le lit tel quel.

Amendement. Un ADR dont le cœur tient avec une nuance n'est pas remplacé : son
Statut devient « accepted, amendé par ADR-NNNN », ou il reçoit une ligne
« - **Amendé par :** ADR-NNNN (date) : ce qui change, ce qui reste en vigueur ».
L'ADR amendant porte la ligne « Amende : ».

Remplacement. Un ADR dont la prémisse est fausse n'est jamais supprimé :
  - son Statut devient « remplacé par ADR-NNNN » ;
  - la Note d'erreur ci-dessous ouvre le fichier, juste sous le titre ;
  - son texte d'origine reste intact, sans retouche, sous le titre
    « ## Contenu original (remplacé) » (bloc en fin de gabarit) ;
  - l'ADR remplaçant porte la ligne « Remplace : », qui nomme l'ADR remplacé et
    dit ce qui en est repris.
Le renvoi se lit donc dans les deux sens.

Correction. Une erreur dans un ADR publié se corrige par un nouveau commit,
jamais par une réécriture de l'historique publié.

Règle de revue. Un ADR fondé sur une capacité tierce (registre, API d'un
serveur, fonction d'administration) sans section « Vérification empirique »
remplie est rejeté. Une mesure sans date ni commande est rejetée. Une date de
consultation de documentation a moins de 30 jours au moment de la rédaction.
-->

<!--
Bloc facultatif, réservé à un ADR remplacé. Le décommenter dans l'ADR dont la
prémisse est fausse, et seulement là ; le retirer dans tout autre ADR.

> **Note d'erreur (AAAA-MM-JJ).** La prémisse « <prémisse> » de cet ADR est
> fausse : <ce qui a été mesuré, avec la commande et sa date>. Cet ADR est
> remplacé par ADR-NNNN. Le texte ci-dessous est conservé tel qu'il a été écrit,
> sous « Contenu original (remplacé) » ; il n'est plus en vigueur.
-->

- **Statut :** proposé
- **Arbitrage :** <qui a tranché, quand, sur quelle question, et le libellé retenu> Owner-arbitration: AAAA-MM-JJ — <canal et objet de l'arbitrage>
- **Date :** AAAA-MM-JJ
- **Connexes :** <ADR, invariants, décisions du registre et documents liés, chacun avec ce qui le relie à cette décision ; « aucun » si rien>
- **Amende :** <ADR-NNNN §x : ce qui change et ce qui reste en vigueur ; « rien » si cet ADR n'amende rien>
<!-- Si cet ADR remplace un ADR dont la prémisse est fausse, écrire à la place de la ligne Amende :
- **Remplace :** ADR-NNNN (<prémisse fausse, en une phrase>). Repris : <ce qui est repris>. Abandonné : <ce qui ne l'est pas>.
-->
- **Invariants :** <I-## appliqué ou inscrit, avec ce que cet ADR en fait> — ou, si cet ADR n'en porte aucun : No invariant.

## Vérification empirique

<!--
Placée avant la décision : une prémisse se vérifie avant de décider dessus.
Garder une seule des trois formes ci-dessous et retirer les deux autres.
Tout fait de cet ADR qui n'a pas été mesuré est marqué « inféré », là où il est
écrit. Une mesure porte sa date et la commande qui la reproduit ; elle se
rejoue avant de servir à une autre décision.
-->

Forme 1 — mesure, de un à trois blocs :

- **Prémisse :** <ce que la décision suppose vrai d'une capacité tierce>
- **Commande :** `<commande rejouable, sans chemin propre à un poste>`
- **Date de rejeu :** AAAA-MM-JJ
- **Sortie attendue :** <la sortie, ou la part de la sortie qui porte la prémisse>

Forme 2 — documentation officielle consultée :

- **Prémisse :** <ce que la décision suppose vrai d'une capacité tierce>
- **Documentation :** <lien vers la page officielle, section citée>
- **Date de consultation :** AAAA-MM-JJ

Forme 3 — architecture purement locale, sans capacité tierce :

- **Non applicable.**
- **Motif :** <pourquoi aucune prémisse de cet ADR ne dépend d'un tiers>

## Contexte

<Le problème, les faits qui le fondent et leur source. Un fait non mesuré est marqué « inféré ».>

## Décision

<Ce qui est décidé, en points numérotés qu'un autre document peut citer.>

## Conséquences

<Ce que la décision rend obligatoire, ce qu'elle interdit, ce qu'elle laisse ouvert.>

## Alternatives rejetées

<Chaque option écartée, avec le motif de son rejet.>

## Vérification

<Les commandes qui montrent que la décision est appliquée, chacune avec la sortie attendue. Une commande qui ne peut pas encore tourner le dit.>

<!--
Bloc facultatif, réservé à un ADR remplacé. Dans l'ADR dont la prémisse est
fausse, ne rien réécrire : garder la Note d'erreur sous le titre, la ligne
Statut « remplacé par ADR-NNNN », puis placer tout le texte d'origine, intact,
sous ce titre.

## Contenu original (remplacé)

<texte d'origine de l'ADR, sans retouche>
-->
