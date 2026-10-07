# Ce que Libre AI n'est pas

Un positionnement se lit d'abord par ses refus. Les non-objectifs techniques sont tenus par [`vision.md`](../../vision.md) §28 ; ce document couvre le positionnement d'ensemble : ce que Libre AI n'est pas comme organisation, puis ce qui le distingue factuellement des acteurs voisins.

## Non-objectifs d'organisation

- **Pas un think tank.** Libre AI ne produit pas de recommandations ni de rapports d'influence : ses positions sont des artefacts exécutables, testés et publiés dans ce dépôt.
- **Pas une association ni une fondation.** Pas de gouvernance d'hébergement neutre, pas d'adhésion : un propriétaire arbitre, et des invariants publics ([`docs/decisions/INVARIANTS.md`](../decisions/INVARIANTS.md)) bornent ce qu'il peut décider sans trace.
- **Pas un éditeur SaaS.** Aucun produit n'est publié aujourd'hui, aucune offre hébergée n'existe ; la cible est du logiciel que chacun peut héberger, répliquer et quitter ([`vision.md`](../../vision.md), mission : « fédérer sans enfermer »).
- **Pas une plateforme d'agents autonomes généraliste.** Les agents opèrent ici sous contrats verrouillés, gates vérifiables et plafonds d'autonomie chiffrés ([ADR-0011 D6](../adr/0011-wave-execution-decisions.md)), sur ce portefeuille précis ; la méthode est le produit, pas un runtime universel à tout faire.
- **Pas une communauté d'abord.** Les contributions passent par des contrats vérifiables — reproduction de la chaîne de référence, qualification de device, écarts de parité documentés ([`CONTRIBUTING.md`](../../CONTRIBUTING.md)) — pas par l'appartenance.

## Positionnement comparatif

Ces organisations font un travail réel dans des registres voisins ; aucune ligne ci-dessous n'est un dénigrement, chacune situe une différence de nature.

| Acteur                     | Ce qu'il est                                                   | Ce qui nous en distingue                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EleutherAI**             | recherche ouverte sur les modèles, institut à but non lucratif | Libre AI ne fait pas de recherche sur les modèles : il industrialise le logiciel produit par des agents gouvernés, preuves publiées à chaque gate.             |
| **MLCommons**              | consortium de benchmarks et de mesures communes                | nos mesures ne normalisent pas une industrie : elles prouvent un portefeuille précis (chaîne de référence, parité, couverture) et se rejouent depuis ce dépôt. |
| **Eclipse · LF AI & Data** | fondations hébergeant des projets à gouvernance neutre         | Libre AI n'héberge pas de projets tiers : un seul portefeuille, une doctrine explicite dans un registre unique, un propriétaire qui arbitre à découvert.       |
| **Data For Good France**   | association mobilisant des bénévoles sur des projets bornés    | pas de mobilisation bénévole : des agents sous contrats et gates, et des contributions externes qui prennent la forme de preuves reproductibles.               |
| **Open Future**            | think tank des communs numériques                              | nous ne produisons pas de policy papers : les positions de Libre AI sont du code, des contrats et des résultats de tests opposables.                           |
| **Hub France IA**          | association d'écosystème et de représentation                  | aucune représentation d'écosystème : Libre AI n'engage que son propre portefeuille et ne publie que ses propres preuves.                                       |

## La niche assumée

**L'ingénierie exécutable et prouvée du logiciel produit par des agents gouvernés.** Chaque propriété revendiquée — souveraineté comprise — est soit un résultat de test publié, soit un `pending` affiché ; jamais un engagement de principe. Le mode d'emploi de cette règle : [`docs/positioning/evidence.md`](evidence.md).
