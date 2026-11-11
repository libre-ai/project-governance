# PRV-01 — Journal scellé

## Contexte

ADR-0042 §5 donne à Work Supervision v0 un journal chaîné par empreintes, vérifiable hors de la base (D55). Le dépôt `ai-work-supervision` le porte : un écrivain en ajout seul et un vérificateur écrit à part, sans code commun. Cette v0 est mono-utilisateur, par la dérogation à I-09 que D55 consigne : elle n'a ni organisation ni identité d'auteur par entrée. Aucun invariant du registre ne lie la brique : I-20 vise le journal public des verdicts de gates, pas ce journal, et n'est pas cité.

## Ce que la brique ferme

- L'entrée modifiée, retirée, insérée ou réordonnée après coup : la chaîne d'empreintes la fait refuser, avec le numéro de la ligne.
- La preuve que seul son auteur sait relire : le vérificateur lit des octets, hors de la base et hors du processus écrivain.
- Le journal interrompu pris pour un journal corrompu : une fin de fichier tronquée est signalée à part.

## Ce qu'elle ne fait pas

- Elle ne signe rien. La spécification du format, dans le dépôt porteur, écrit que la chaîne ne détecte pas la réécriture cohérente du fichier entier sans un ancrage de la tête hors de la racine. La signature est PRV-03.
- Elle ne dit pas qui a écrit une entrée : la v0 n'a pas d'identité d'auteur, et l'identité des agents est IDN-04.
- Elle ne publie rien : c'est PUB-04.

## Mesure

- Preuves citées : le module écrivain et la bibliothèque du vérificateur indépendant, épinglés au même commit de `ai-work-supervision`. Ils montrent qu'un journal chaîné s'écrit et se vérifie hors de la base, pour une racine mono-utilisateur. Ils ne montrent pas le journal d'une organisation, que le rôle vise.
- Prochain fait observable : un journal tenu pour une organisation, dont chaque entrée nomme une identité d'agent attestée et dont la tête est ancrée hors de la racine.
