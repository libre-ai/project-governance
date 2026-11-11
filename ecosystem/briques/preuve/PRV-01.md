# PRV-01 — Journal scellé

## Contexte

ADR-0042 §5 donne à Work Supervision v0 un journal chaîné par empreintes, vérifiable hors de la base (D55). Le dépôt `ai-work-supervision` le porte : un écrivain en ajout seul et un vérificateur écrit à part, sans code commun. Cette v0 est mono-utilisateur, par dérogation à I-09 : elle n'a ni organisation ni identité d'auteur par entrée.

## Ce que la brique ferme

- L'entrée modifiée, retirée, insérée ou réordonnée après coup : la chaîne d'empreintes la fait refuser, avec le numéro de la ligne.
- La preuve que seul son auteur sait relire : le vérificateur lit des octets, hors de la base et hors du processus écrivain.
- Le journal illisible pris pour un journal vide : un fichier illisible est une erreur, et une fin tronquée est signalée à part.
- Le verdict sans trace : I-20 demande un journal des verdicts publié.

## Ce qu'elle ne fait pas

- Elle ne signe rien. La réécriture cohérente du fichier entier ne se voit que par un ancrage de la tête hors de la racine. La signature est PRV-03.
- Elle ne dit pas qui a écrit une entrée tant que IDN-04 n'attribue pas d'identité aux agents.
- Elle ne publie rien : c'est PUB-04.

## Mesure

- Preuves citées : le module écrivain et la bibliothèque du vérificateur indépendant, épinglés au même commit de `ai-work-supervision`. Ils montrent qu'un journal chaîné s'écrit et se vérifie hors de la base, pour une racine mono-utilisateur.
- Prochain fait observable : un journal tenu pour une organisation (IDN-03), dont chaque entrée nomme une identité d'agent attestée et dont la tête est ancrée hors de la racine.
