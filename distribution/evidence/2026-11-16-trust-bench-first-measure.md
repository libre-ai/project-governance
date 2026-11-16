# Banc de confiance : première mesure, défauts semés sur `pi-evidence` — mesuré le 2026-11-16

Question posée : quand un défaut entre dans une brique, quelle couche de vérification l'attrape, et laquelle n'attrape rien que les couches moins chères n'aient déjà attrapé ? Le banc sème des défauts connus dans une copie de travail, soumet la copie à chaque couche séparément, et consigne qui rougit. Des cas sains, soumis de la même façon, mesurent les faux positifs.

Ce rapport publie une mesure faite, il ne la refait pas. Le banc ne tourne pas en CI : il lui faut une copie de travail du dépôt mesuré et des modèles locaux. Ce que ce dépôt versionne est l'enregistrement de la mesure — corpus, mesures brutes, synthèse — sous `verification/trust-bench/`, et sa projection lisible par un site : `distribution/index/trust-bench.v1.json` (contrat : `ecosystem/schemas/trust-bench.v1.schema.json`).

Les blocs entre marqueurs `trust-bench:begin` et `trust-bench:end` sont générés depuis cet enregistrement par `verification/trust-bench/build-evidence.ts` et ne s'éditent pas à la main. `bun run check:trust-bench` les compare à une génération fraîche, compare le fichier de données, recoupe chaque ligne des mesures normalisées avec la ligne brute dont elle vient (une ligne brute lue deux fois ne tient pas lieu d'une ligne absente), rejoue `synthese.jq` sur les mesures, et imprime ce qu'il a comparé. Le texte hors des blocs n'est vérifié par aucun contrôle, à une phrase près : un test refuse que ce rapport énonce un apport de la relecture croisée.

## Ce qui a été mesuré

Pour chaque cas du corpus, le lanceur (`verification/trust-bench/lanceur.ts`) remet la copie de travail à sa révision, applique une substitution exacte et unique dans son fichier, puis lance la commande de chaque couche. Une couche « attrape » un cas quand sa commande sort d'elle-même en non nul. Les couches lancées sont le lint, les types, les tests, les contrôles propres au dépôt mesuré (marqueurs, licences) et un pilote d'exécution réelle (`verification/trust-bench/pilote-pi-evidence.sh`, six scénarios qui lancent la CLI sur des dépôts jetables). Le pilote versionné a été corrigé après la mesure ; les résultats publiés viennent du pilote d'origine (voir les limites).

La relecture (`verification/trust-bench/relecture.ts`) soumet le diff de chaque cas à un modèle local, à l'aveugle : ni identifiant de cas, ni attendu. Le modèle rend un verdict structuré, défaut ou non. Une réponse qui n'est pas ce verdict est comptée illisible, ni verte ni rouge. Les deux couches croisées ne sont pas des passages de plus : ce sont des couches dérivées, sans verdict propre. Elles combinent les verdicts des deux modèles sur le même diff, l'une quand les deux signalent, l'autre quand au moins un signale.

<!-- trust-bench:begin mesure -->

- Dépôt mesuré : `libre-ai/pi-evidence`, révision `fd2dfacf2c307c28b863b63a9f8c595b43c3e9a1`.
- Date de la mesure : 2026-11-16.
- Corpus : `verification/trust-bench/corpus/pi-evidence.json` — défauts semés : 10 ; cas sains : 9, révision d'origine comprise.
- Mesure de référence : `verification/trust-bench/resultats/pi-evidence.deterministe.json` (machine au calme).
- Relecture : température 0, graine 1, 4000 tokens de sortie au plus, 1 passage par modèle, consigne en anglais (`verification/trust-bench/relecture.ts`) ; serveur : llama-server, sur la machine de mesure ; version non consignée.

| Modèle | Quantification | Source amont | Révision amont | SHA-256 du fichier | Octets | Licence |
| --- | --- | --- | --- | --- | --- | --- |
| Mistral Small 3.2 24B Instruct 2506 | Q4_K_M | `bartowski/mistralai_Mistral-Small-3.2-24B-Instruct-2506-GGUF` | non consigné | `80f5bda68f156f12650ca03a0a2dbfae06a215ac41caa773b8631a479f82415e` | `14333915264` | `Apache-2.0` |
| Qwen3-8B | Q4_K_M | non consigné | `7c41481f` | non consigné | non consigné | non consigné |

<!-- trust-bench:end mesure -->

## Synthèse par couche

« Apport au-delà du moins cher » : défauts attrapés par la couche et par aucune couche de coût strictement inférieur. Il ne se calcule que pour une couche qui a ses propres verdicts. Une couche dérivée d'autres couches ne signale rien que l'une de ses sources ne signale déjà : contre elles, son apport vaudrait zéro quelle que soit l'entrée, ce qui n'est pas une mesure. Il est donc déclaré « non applicable (couche dérivée) ». Le coût est un ordre posé à la main, pas une mesure. Les durées sont la somme des durées de tous les cas soumis à la couche.

<!-- trust-bench:begin synthese -->

| Couche | Coût (ordre posé) | Défauts attrapés | Apport au-delà du moins cher | Faux positifs | Illisibles | Durée totale (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| `L1a-lint` | 1 | 0 / 10 | 0 (—) | 0 / 9 (—) | 0 | 3935 |
| `L1b-types` | 1 | 1 / 10 | 1 (D07) | 0 / 9 (—) | 0 | 10833 |
| `L2-tests` | 2 | 7 / 10 | 6 (D01, D02, D05, D06, D09, D10) | 0 / 9 (—) | 0 | 222138 |
| `L3-controles-depot` | 2 | 0 / 10 | 0 (—) | 0 / 9 (—) | 0 | 16138 |
| `L4-execution-reelle` | 3 | 4 / 10 | 2 (D03, D08) | 0 / 9 (—) | 0 | 26765 |
| `L5-relecture-mistral-small-3.2-24b-q4km` | 4 | 10 / 10 | 1 (D04) | 1 / 8 (T03) | 0 | 143374 |
| `L5-relecture-qwen3-8b-q4km` | 4 | 10 / 10 | 1 (D04) | 1 / 8 (T08) | 1 | 484860 |
| `L6-croisee-accord-des-deux` | 5 | 10 / 10 | non applicable (couche dérivée) | 0 / 8 (—) | 1 | 628234 |
| `L6-croisee-au-moins-un-signale` | 5 | 10 / 10 | non applicable (couche dérivée) | 2 / 8 (T03, T08) | 1 | 628234 |

Défauts attrapés par aucune couche : —.

Couches dérivées, sans verdict propre :

- `L6-croisee-accord-des-deux`, dérivée de `L5-relecture-mistral-small-3.2-24b-q4km` et `L5-relecture-qwen3-8b-q4km`.
- `L6-croisee-au-moins-un-signale`, dérivée de `L5-relecture-mistral-small-3.2-24b-q4km` et `L5-relecture-qwen3-8b-q4km`.

<!-- trust-bench:end synthese -->

## Quelle couche a attrapé quoi

`SAIN` est la révision d'origine, sans substitution : elle n'a pas de diff, donc pas de relecture.

<!-- trust-bench:begin cas -->

| Cas | Défaut attendu | Nature | `L1a-lint` | `L1b-types` | `L2-tests` | `L3-controles-depot` | `L4-execution-reelle` | `L5-relecture-mistral-small-3.2-24b-q4km` | `L5-relecture-qwen3-8b-q4km` | `L6-croisee-accord-des-deux` | `L6-croisee-au-moins-un-signale` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SAIN | non | révision d'origine | vert | vert | vert | vert | vert | non soumis | non soumis | non soumis | non soumis |
| D01 | oui | logique de verdict | vert | vert | rouge | vert | rouge | rouge | rouge | rouge | rouge |
| D02 | oui | comparaison de rejeu affaiblie | vert | vert | rouge | vert | vert | rouge | rouge | rouge | rouge |
| D03 | oui | porte qui laisse passer un verdict non conforme | vert | vert | vert | vert | rouge | rouge | rouge | rouge | rouge |
| D04 | oui | contrôle de dépôt neutralisé | vert | vert | vert | vert | vert | rouge | rouge | rouge | rouge |
| D05 | oui | validation d'entrée retirée (sécurité) | vert | vert | rouge | vert | vert | rouge | rouge | rouge | rouge |
| D06 | oui | masquage d'un secret retiré (sécurité) | vert | vert | rouge | vert | rouge | rouge | rouge | rouge | rouge |
| D07 | oui | valeur hors du type déclaré | vert | rouge | rouge | vert | vert | rouge | rouge | rouge | rouge |
| D08 | oui | environnement du processus journalisé (donnée sensible) | vert | vert | vert | vert | rouge | rouge | rouge | rouge | rouge |
| D09 | oui | condition inversée | vert | vert | rouge | vert | vert | rouge | rouge | rouge | rouge |
| D10 | oui | délai par défaut divisé par cent | vert | vert | rouge | vert | vert | rouge | rouge | rouge | rouge |
| T01 | non | témoin sain : opérandes d'un ET permutés | vert | vert | vert | vert | vert | vert | vert | vert | vert |
| T02 | non | témoin sain : commentaire ajouté | vert | vert | vert | vert | vert | vert | illisible | illisible | illisible |
| T03 | non | témoin sain : ternaire inversé, même résultat | vert | vert | vert | vert | vert | rouge | vert | vert | rouge |
| T04 | non | témoin sain : comparaison équivalente | vert | vert | vert | vert | vert | vert | vert | vert | vert |
| T05 | non | témoin sain : condition réécrite par De Morgan | vert | vert | vert | vert | vert | vert | vert | vert | vert |
| T06 | non | témoin sain : commentaire ajouté sur une constante | vert | vert | vert | vert | vert | vert | vert | vert | vert |
| T07 | non | témoin sain : changement voulu, une famille de secret de plus est masquée | vert | vert | vert | vert | vert | vert | vert | vert | vert |
| T08 | non | témoin sain : changement voulu, identifiant de contrôle plus long admis | vert | vert | vert | vert | vert | vert | rouge | vert | rouge |

<!-- trust-bench:end cas -->

## Lecture

Niveau inféré : ce qui suit se déduit des deux tableaux, sur ce corpus.

- Les défauts que seule l'exécution réelle attrape, parmi les couches lancées, sont la porte qui laisse passer un verdict non conforme (D03) et l'environnement du processus journalisé (D08) : les tests de la brique restent verts sur l'un et l'autre.
- Le défaut que seule la relecture attrape est le contrôle de dépôt neutralisé (D04) : ni les tests ni le contrôle lui-même ne rougissent.
- Chaque modèle signale un cas sain, et pas le même. La réponse illisible est celle d'un modèle sur un cas sain (T02).

## Abandon que cette mesure justifie

Sur ce corpus, et dans les limites écrites plus bas :

- **Les contrôles propres au dépôt mesuré comme filet contre ces défauts.** Ils n'attrapent aucun des défauts semés, y compris celui qui neutralise l'un d'eux (D04).

## Ce que cette mesure ne permet pas de dire

- **Ce que vaut la relecture croisée comme couche de détection.** Chaque modèle seul a signalé les 10 défauts semés : la croisée n'avait aucune marge pour en signaler un de plus, et ce corpus ne permet pas de dire ce qu'elle vaut. Aucun abandon ne s'en déduit. Ce qui est mesuré est ailleurs : sur les 8 cas sains relus, la règle « accord des deux » donne 0 fausse alerte, contre 1 sur 8 pour chaque modèle seul ; l'un de ces 8 cas (T02) est illisible pour un modèle, donc pour les deux couches croisées.
- **Ce que l'exécution réelle voit du cas D05.** Le scénario du pilote de la mesure qui devait le voir ne le pouvait pas (voir les limites) : son vert sur ce cas n'est pas un résultat.

## Second passage, publié à part

Le corpus a été soumis une seconde fois aux couches lancées, le même jour, sous forte charge de la machine. Ce passage n'entre ni dans la synthèse ni dans le tableau par cas ci-dessus. Les verdicts qui diffèrent de la référence sont tous dans la couche des tests, et tous des verts devenus rouges, dont deux sur des cas sains : sous charge, une suite sensible aux délais rougit sans défaut. Le lanceur rejoue depuis tout rouge une fois, et ne compte que le rouge confirmé ; aucun des deux passages publiés n'a bénéficié de ce rejeu.

<!-- trust-bench:begin second-passage -->

Fichier : `verification/trust-bench/resultats/pi-evidence.deterministe.passage2.json` (forte charge machine) — publié à part, jamais fusionné à la référence.

Lignes comparées à la référence : 95 ; états différents : 4.

| Cas | Couche | Référence | Second passage |
| --- | --- | --- | --- |
| D03 | `L2-tests` | vert | rouge |
| D04 | `L2-tests` | vert | rouge |
| T06 | `L2-tests` | vert | rouge |
| T07 | `L2-tests` | vert | rouge |

| Cas | `L1a-lint` | `L1b-types` | `L2-tests` | `L3-controles-depot` | `L4-execution-reelle` |
| --- | --- | --- | --- | --- | --- |
| SAIN | vert | vert | vert | vert | vert |
| D01 | vert | vert | rouge | vert | rouge |
| D02 | vert | vert | rouge | vert | vert |
| D03 | vert | vert | rouge | vert | rouge |
| D04 | vert | vert | rouge | vert | vert |
| D05 | vert | vert | rouge | vert | vert |
| D06 | vert | vert | rouge | vert | rouge |
| D07 | vert | rouge | rouge | vert | vert |
| D08 | vert | vert | vert | vert | rouge |
| D09 | vert | vert | rouge | vert | vert |
| D10 | vert | vert | rouge | vert | vert |
| T01 | vert | vert | vert | vert | vert |
| T02 | vert | vert | vert | vert | vert |
| T03 | vert | vert | vert | vert | vert |
| T04 | vert | vert | vert | vert | vert |
| T05 | vert | vert | vert | vert | vert |
| T06 | vert | vert | rouge | vert | vert |
| T07 | vert | vert | rouge | vert | vert |
| T08 | vert | vert | vert | vert | vert |

<!-- trust-bench:end second-passage -->

## Limites

<!-- trust-bench:begin limites -->

- Un diff d'une ligne portant un seul changement est le cas le plus favorable à un relecteur : ces résultats ne se transposent pas à une vraie pull request, où le défaut est noyé dans des changements voulus.
- 18 cas, une seule brique, un seul passage par modèle à température 0 : aucune répétition, aucun intervalle.
- Les fichiers versionnés ne sont pas, à l'octet, ceux de la mesure : les lignes brutes du lanceur et de la relecture, écrites en JSONL, sont versionnées en tableaux JSON (mêmes objets, même ordre), parce que le contrôle de frontière des données personnelles de ce dépôt refuse tout fichier .jsonl hors de ses exemptions nommées ; les fichiers JSON ont été remis en forme par le formateur du dépôt. Les empreintes des fichiers d'origine sont consignées, les fichiers d'origine ne sont pas publiés.
- L'ordre de coût des couches est posé à la main ; seules les durées sont mesurées.
- Les deux couches croisées sont dérivées des deux relectures : elles n'ont pas de verdict propre, et tout ce qu'elles signalent, l'une des deux relectures le signale déjà. Leur apport au-delà du moins cher n'est pas une mesure : il est déclaré non applicable, jamais nul. Chaque modèle seul a signalé tous les défauts semés, la croisée n'avait donc aucune marge pour en signaler un de plus : ce corpus ne permet pas de dire ce qu'elle vaut comme couche de détection.
- La synthèse versionnée n'est pas celle que le banc a écrite le jour de la mesure, dont l'empreinte figure parmi les fichiers d'origine : elle est le rejeu, sur les mêmes mesures, du filtre synthese.jq corrigé après elle. Deux différences : pour les deux couches croisées, le fichier d'origine portait un apport chiffré, déclaré ici non applicable ; et le champ derivee_de est ajouté à chaque couche.
- Le pilote d'exécution réelle a été écrit par la même session que deux des défauts qu'il attrape (D03, D08) : son apport est en partie construit.
- Le résultat de la couche d'exécution réelle sur le cas D05 (validation de la commande retirée) a été obtenu avec un scénario qui ne pouvait pas le voir : le scénario S4 du pilote de la mesure lisait tout code de sortie non nul comme un refus, et le script nommé par sa recette n'existait pas dans le dépôt jetable, si bien que la porte se fermait aussi quand la commande avec chemin était acceptée. Ce vert ne dit pas que l'exécution réelle manque ce défaut.
- Les modèles ont relu en anglais, avec la consigne présente dans verification/trust-bench/relecture.ts.
- Le lanceur versionné rejoue un rouge une fois ; les deux passages publiés ont été produits avant cet ajout, sans rejeu. Il distingue aussi un délai dépassé d'une mort par signal ; les deux passages publiés ont été produits avant cette distinction : leurs lignes ne portent pas le champ signal, et une mort par signal y aurait été consignée comme un délai.
- La commande qui a normalisé les mesures brutes en pi-evidence.mesures.json n'a pas été conservée ; le contrôle recoupe ce fichier ligne à ligne avec les mesures brutes.
- Les diffs soumis aux modèles ne sont pas versionnés : le lanceur les reproduit depuis le corpus et la révision (option --diffs).
- Le pilote versionné n'est pas celui de la mesure. Ses scénarios S1 à S4 et S6 ont été corrigés après elle : ils comparent le code de sortie et le verdict imprimé par la CLI, S4 exige le refus de la recette et son script existe, S6 exige que la vérification ait tourné. Il diffère aussi sur la gestion de son répertoire temporaire et l'adresse factice de ses dépôts jetables. Le pilote corrigé n'a pas été rejoué sur le corpus : toutes les mesures publiées de la couche d'exécution réelle viennent du pilote d'origine.
- Pour Qwen3-8B, ni l'empreinte du fichier ni le propriétaire du dépôt amont ne sont consignés, seulement la révision amont ; pour Mistral Small 3.2, l'empreinte du fichier est consignée, pas la révision amont.

<!-- trust-bench:end limites -->

## Reproduire

- Vérifier la concordance du rapport, du fichier de données et de l'enregistrement : `bun run check:trust-bench`. Régénérer : `bun run build:trust-bench`.
- Rejouer le banc : `bun verification/trust-bench/lanceur.ts verification/trust-bench/corpus/pi-evidence.json <copie de travail de pi-evidence à la révision mesurée, dépendances installées> <sortie.jsonl> --diffs <répertoire>`, puis, avec un serveur de modèle lancé sur la machine, `bun verification/trust-bench/relecture.ts <répertoire des diffs> http://127.0.0.1:<port> <étiquette du modèle> <sortie.jsonl>`. Le lanceur s'arrête avant toute mesure si une substitution du corpus est absente ou ambiguë, et sans écrire de résultat si une couche n'est pas verte sur la révision d'origine. Il rejoue un rouge une fois, et consigne à part une couche qui dépasse son délai et une couche tuée par un signal : ni l'une ni l'autre n'est un vert ni un rouge (`verification/trust-bench/lanceur.test.ts`). Les scénarios du pilote sont tenus par `verification/trust-bench/pilote-pi-evidence.test.ts`, contre des doublures de la CLI.
- Synthèse : `jq --slurpfile provenance verification/trust-bench/resultats/pi-evidence.provenance.json -f verification/trust-bench/synthese.jq verification/trust-bench/resultats/pi-evidence.mesures.json`. La provenance déclare les couches dérivées.

Fichiers lus par la génération, avec leur empreinte :

<!-- trust-bench:begin sources -->

| Fichier versionné | SHA-256 |
| --- | --- |
| `verification/trust-bench/corpus/pi-evidence.json` | `074ee7f143d992adb3cc68dbae01ef533b4bee0ab6fef991b0bb3facf42072e4` |
| `verification/trust-bench/resultats/pi-evidence.deterministe.json` | `cacd6e8c1b5572ffbeaeb5870e8109a295292a7b4018e04b66541f641f842ba3` |
| `verification/trust-bench/resultats/pi-evidence.deterministe.passage2.json` | `8acd59a503d9d3209133b6906a089f29d319c48f0dc2663381937609fcc9fa50` |
| `verification/trust-bench/resultats/pi-evidence.mesures.json` | `c37ffa634f0a56d9d126d90994c2103da9988c44e9cde6881b3a401e30b2af56` |
| `verification/trust-bench/resultats/pi-evidence.provenance.json` | `79e5a800d701b955f4cfd95f4d06737c749e145df5ff579cf6ef471ad5b3d957` |
| `verification/trust-bench/resultats/pi-evidence.relecture.mistral-small-3.2.json` | `f9b99118c22657afea3bab5614afa3a376fc50780b49a7cbefe00f4fadb3bab7` |
| `verification/trust-bench/resultats/pi-evidence.relecture.qwen3-8b.json` | `a356f4bd4ec26ee7ceefbb2e8e49c0751273448b41cf327da69794909884d897` |
| `verification/trust-bench/resultats/pi-evidence.synthese.json` | `ed7075010e6dafa49dcd10e0ab4d535e50b16b726662b64ec7847b49fd691725` |
| `verification/trust-bench/synthese.jq` | `084658953b0185c549dd64af9d4140a8f334a09f7992c6c901fecfcef9aa80e5` |

Fichiers tels que le banc les a écrits, non publiés :

| Fichier d'origine | SHA-256 |
| --- | --- |
| `corpus/pi-evidence.json` | `216beaa8fdd272dbb096303eec2f121f2e3360b564b18b1d2fa6a2b0269339db` |
| `resultats/pi-evidence.mesures.json` | `c37ffa634f0a56d9d126d90994c2103da9988c44e9cde6881b3a401e30b2af56` |
| `resultats/pi-evidence.synthese.json` | `84545593449b10e1988f2fb38552641af283c198a86ddd596cb1c9ec5949577b` |
| `resultats/pi-evidence.deterministe.jsonl` | `6be4da76513a13c69bada5c17c46627aa272dc04f0f35af6bcff0a6dd087546c` |
| `resultats/pi-evidence.deterministe.passage2.jsonl` | `4571a7f2b7765978254b06f787c41f0dba5056b6f7d5e17b0deb2497dd3e209f` |
| `resultats/pi-evidence.relecture.mistral-small-3.2.jsonl` | `34fbd89d3ce7caa7d81c0fe8dcd8ad0848b9b3055a5920c8a446cb5f746ae7fb` |
| `resultats/pi-evidence.relecture.qwen3-8b.jsonl` | `476f60086b3ed0f76bbbb810839c72c341f207541922665a79220f0f697fa152` |

<!-- trust-bench:end sources -->
