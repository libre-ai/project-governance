# Pièges d'outillage

Catalogue des défauts d'outil rencontrés dans la chaîne de ce dépôt, sous une
seule forme : ce qu'on observe, pourquoi, et ce qu'on fait à la place. Une
ligne n'entre ici que si sa parade a un témoin : un test suivi par git, qui
tourne sur le poste avec bash, grep, sed, git et bun, et que la cellule Parade
cite en code après le mot « Témoin ». Le témoin prouve la parade, pas que le
défaut s'est produit.

Le document est lu par `tools/quality/toolchain-pitfalls.ts`, qui refuse un
tableau dont l'en-tête ou le nombre de colonnes diffère, une parade sans chemin
de test ou dont le chemin n'est pas suivi, un nom de dépôt de l'index de la
flotte, un nom d'hôte et un chemin propre à un poste :

```sh
bun tools/quality/toolchain-pitfalls.ts
```

Un tableau par famille ; le titre de section est le nom de la famille. Le
document ne cite jamais un tableau en exemple : toute ligne qui commence par
une barre verticale est lue comme une ligne de tableau.

## shell

| Symptôme | Cause | Parade |
| --- | --- | --- |
| `grep` ne trouve pas une ligne qui contient pourtant la chaîne cherchée au caractère près, par exemple `${ITEMS[0]}`. | Sans option, la chaîne est lue comme une expression régulière : `[0]` devient une classe de caractères et ne correspond plus aux crochets du texte. | Chercher une chaîne littérale avec `grep -F`. Témoin : `tools/quality/toolchain-pitfalls.test.ts` |
| Une variable affectée par une fonction qui lit un tube garde sa valeur d'avant l'appel, par exemple un compteur resté à zéro. | Chaque membre d'un tube bash s'exécute dans un sous-shell : l'affectation y est faite et disparaît avec lui. | Alimenter la fonction par une redirection depuis un fichier (`fonction < fichier`) ou par une substitution de processus : elle s'exécute alors dans le shell courant. Témoin : `tools/quality/toolchain-pitfalls.test.ts` |
| Un script affiche un message de succès et sort en code 0 alors que son contrôle a échoué. | `controle; echo OK` enchaîne sans condition : l'`echo` s'exécute après l'échec et son code de sortie remplace celui du contrôle. | Conditionner le message au contrôle (`controle && echo OK`) ou ouvrir le script par `set -e`. Témoin : `tools/quality/toolchain-pitfalls.test.ts` |
| `git worktree add` avec un chemin relatif crée le worktree ailleurs que prévu, parfois à l'intérieur du dépôt principal. | Un chemin relatif se résout depuis le répertoire courant de la commande, pas depuis le lieu que l'auteur avait en tête. | Passer un chemin absolu dérivé d'un répertoire créé par `mktemp -d`, puis relire `git worktree list`. Témoin : `tools/quality/toolchain-pitfalls.test.ts` |
| Une édition en place par `sed -i` réussit sur un poste et échoue sur un autre. | Le `sed` de BSD lit l'argument qui suit `-i` comme le suffixe de sauvegarde, celui de GNU ne lit un suffixe que collé à l'option : aucune forme sans fichier de sauvegarde ne vaut pour les deux (`-i ''` échoue chez GNU, `-i` seul échoue chez BSD). | Écrire le résultat dans un fichier temporaire puis le déplacer sur l'original (`sed … fichier > "$tmp" && mv "$tmp" fichier`, `tmp` issu de `mktemp`), ou garder la forme à suffixe collé, `sed -i.bak`, valable pour les deux, et supprimer ensuite la sauvegarde. Témoin : `tools/quality/toolchain-pitfalls.test.ts` |

## osv-scanner

Contexte : `docs/toolchain/OSV-ADVISORY-DATABASE.md`, section « What it costs,
and how it fails ».

| Symptôme | Cause | Parade |
| --- | --- | --- |
| Le contrôle d'avis sort vert alors que le scanner n'a écrit aucune base d'avis hors ligne pendant l'étape. | Un fichier de base absent se lit comme « aucun avis », et un ancien fichier laissé en place masque que rien n'a été téléchargé. | Supprimer l'ancien fichier avant le téléchargement et refuser l'étape si le fichier est absent ensuite. Témoin : `.github/composition/test_download_advisory_database.py`, cas `test_scanner_that_writes_nothing_is_not_a_green_even_with_a_stale_file`. |
| Le contrôle d'avis sort vert sur une base vide, ou plus ancienne que l'étape qui devait la télécharger. | La présence du fichier est prise pour une preuve de téléchargement : ni sa taille ni sa date ne sont lues. | Refuser un fichier vide et un fichier dont la date précède le début de l'étape. Témoin : `.github/composition/test_download_advisory_database.py`, cas `test_empty_database_file_is_refused` et `test_file_not_written_by_this_run_is_refused`. |
| L'étape de téléchargement sort verte alors que le scanner a échoué. | Le code de sortie du scanner n'est pas lu, ou tout code non nul est toléré alors que seul le code 1 signifie « analysé, avis trouvés ». | N'accepter que les codes 0 et 1 et échouer fermé sur tout autre, sans nouvel essai ni repli. Témoin : `.github/composition/test_download_advisory_database.py`, cas `test_scanner_failure_fails_closed`. |

## bun

| Symptôme | Cause | Parade |
| --- | --- | --- |
| `bun install` refuse une version d'un paquet qui vient d'être publiée. | `minimumReleaseAge` (`bunfig.toml`, 259200 secondes) écarte toute version plus jeune que ce délai de maturité. | Attendre que la version ait l'âge requis, ou viser une version plus ancienne ; ne jamais remplir `minimumReleaseAgeExcludes` sans décision écrite. Témoin : `tools/quality/toolchain-pitfalls.test.ts` |
