# Commits de fusion sans signature du 2026-11-17

Constat mesuré le 2026-11-18. Décision du propriétaire du 2026-11-18 : accepter ces commits et les
consigner ici, sans réécrire aucune branche servie.

## Ce qui s'est passé

Le 2026-11-17, les pull requests du plan de réécriture ont été fusionnées par `gh pr merge --merge`,
sans trailer dans le message. Le commit de fusion généré par la forge n'a donc pas de
`Signed-off-by`. L'étape « Verify DCO sign-offs on pushed commits » de `.github/workflows/ci.yml`
exige ce trailer sur un commit d'intégration de la forge : le run `ci` de la poussée est rouge, au
job « Licensing and contribution governance ».

Cette étape ne vérifie que les commits introduits par chaque poussée. Ces commits ne font donc pas
rougir les poussées suivantes.

## Commits concernés

`libre-ai/project-governance`, branche `migrate/recover-code` :

| Commit | Pull request |
| --- | --- |
| `a282897fdbb4191029c958316f73221253de3bf5` | #249 |
| `7f18909ee029e4e24643340babfe12f1e8206c1d` | #251 |
| `f1809f09db6fc6a1d38155dafacf8da1101779ff` | #252 |
| `40a9d7f4cc74db76cc5203dd3efcad1aaf82721d` | #253 |
| `4b470891b9af6cf62978116c9af9b86289ffeb15` | #254 |
| `399630b80f918b6b625bd0d01377731c55e34ebc` | #255 |
| `0ecc3b49640b0a1d48983150b0acb715ce325178` | #256 |
| `a00daec8d10419f266a9611f589c606858ca86b3` | #257 |
| `5d725de7a96dcb28e9f6b6130b61343d78e65fd4` | #258 |
| `34333b4c8c5210ae5013135d7232d7450744f353` | #259 |
| `86b1ac37939dcf5bb7d2c483d288e3c802ca2334` | #260 |

`libre-ai/product-research`, branche `main` :

| Commit | Pull request |
| --- | --- |
| `e1fb5cf5b415b914f099191b8eae19efcb78aa84` | #12 |

Les commits des lots fusionnés portent leur signature : seuls ces commits de fusion en manquent.

## Pourquoi ils ne sont pas réécrits

Réécrire une branche servie changerait l'empreinte de tous les commits suivants. `a00daec8` est de
plus une génération déclarée dans `ecosystem/fleet-pins.v1.yaml`, sur laquelle des dépôts de la
flotte sont épinglés.

## Conséquence

Ces douze runs restent rouges dans l'historique des actions. Une fusion par commit de fusion porte
désormais son trailer : `gh pr merge --merge --body "Signed-off-by: <nom> <adresse>"`.

## Rejouer

```sh
git show --no-patch --format=%B <commit> | grep -c '^Signed-off-by:'   # 0 pour chaque commit listé
gh run list --repo libre-ai/project-governance --branch migrate/recover-code --event push --workflow ci
```
