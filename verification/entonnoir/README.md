# Entonnoir d'évaluation

Évalue une sortie générée par un modèle en trois étages, chacun bloquant le suivant :

1. **contrat** : une fonction typée valide la sortie et la type (`contratCarte` dans `controles.ts`) ;
2. **assertions** déterministes sur la valeur typée ;
3. **signal d'un juge par modèle**, demandé seulement si 1 et 2 passent.

Le verdict d'un cas (`accepte` ou `rejete`) n'est décidé que par les étages 1 et 2. Le signal du
juge se présente à part et n'entre dans aucune note composite. C'est la règle 2 de D2 de
l'ADR-0071, et le juge tient les six bornes (a) à (f) de D1 du même ADR. Cet ADR est **proposé**
par la PR #273 et n'est pas fusionné : le module suit son texte à cette révision.

## Usage

```sh
bun verification/entonnoir/lancer.ts verification/entonnoir/corpus/cas.json "$TMPDIR/resultats.jsonl"
```

Avec un juge local (serveur compatible OpenAI, URL `127.0.0.1` ou `localhost` uniquement ; une
redirection n'est jamais suivie, le juge est alors injoignable). Le `fetch` de Bun passe par le
proxy de l'environnement même vers `127.0.0.1` : si une variable dont le nom contient « proxy »
(hors `no_proxy`) porte une valeur, le juge est refusé, sans exemption par `NO_PROXY`, dont Bun
ne lit pas toutes les formes. Lancer la commande sans ces variables.

```sh
bun verification/entonnoir/lancer.ts verification/entonnoir/corpus/cas.json "$TMPDIR/resultats.jsonl" \
  --juge-url http://127.0.0.1:8080 --juge-modele <nom> --juge-version <version> --juge-famille <famille> \
  --qualification verification/entonnoir/corpus/qualification.json
```

| Situation | Signal | Sortie |
| --- | --- | --- |
| aucun juge configuré | `unavailable` pour chaque cas, jamais réussi | 0 |
| étage 1 ou 2 en échec | `non_demande`, compté comme saut | 0 |
| juge en échec, refus, réponse hors schéma | `non_note`, ni 0 ni réussi | 0 |
| juge demandé mais injoignable (pas de réponse, erreur HTTP, corps interrompu), en qualification ou en mesure | `non_note` marqué injoignable | 1 |
| juge de la famille du candidat, ou de son nom (casse et espaces ignorés) | refusé avant tout appel | 2 |
| variable de proxy renseignée dans l'environnement | refusé avant tout appel | 2 |
| cas étiqueté rejeté par les étages 1 et 2 | qualification refusée avant tout appel | 2 |
| source illisible, vide ou invalide | aucune mesure | 2 |
| fichier de résultats impossible à écrire | aucun bilan imprimé | 2 |

Sans qualification, ou si le juge qui mesure n'est pas exactement celui qui s'est qualifié
(modèle, version et famille), le signal est affiché « non qualifié ». Un juge qui ne note aucun
cas étiqueté en échec n'est pas qualifié : son taux de faux succès n'a pas de dénominateur.
Le juge est qualifié quand ce taux est au plus `tauxFauxSuccesMax`, borne incluse. La comparaison
se fait en entiers, sur l'écriture décimale du seuil, et jamais en flottant : un flottant refuserait
57/100 au seuil 0.57 et admettrait 12/19 au seuil 0.631578947368421. Le seuil doit s'écrire avec
au plus 15 chiffres significatifs : au-delà, la lecture JSON le ramène à un double dont l'écriture
la plus courte peut être plus haute (`0.49999999999999999` se lit `0.5` et qualifie 1/2).

## Corpus de démonstration

**Les cas de `corpus/` sont fabriqués.** Aucune interface générée n'existe encore dans la flotte :
les sorties, le modèle candidat (`candidat-fictif`) et le jeu de contrôles `carte.v1` illustrent la
forme du module, ils ne mesurent rien de réel. Les étiquettes `attendu` de `qualification.json`
sont écrites par l'auteur du module, jamais par un modèle. Le seuil `tauxFauxSuccesMax` y vaut 0 :
un seul faux succès disqualifie le juge sur ce corpus.

## Ce que le module ne reproduit pas

Écrit après lecture de l'évaluation d'A2UI, il refuse quatre de ses défauts : un juge identique
au candidat par défaut (refusé ici) ; l'absence de juge comptée « correcte » (`unavailable` ici) ;
une évaluation sautée faute de secret comptée verte (un juge injoignable sort en 1) ; un jeu
calibré promis mais absent (la qualification est fournie, et son absence s'affiche).
