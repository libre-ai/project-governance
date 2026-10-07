# ADR-0005 — Exception bornée de qualification du host Notebook Gate B

- **Statut :** accepted, superseded in part by ADR-0006 for the required hardware matrix
- **Date :** 2026-07-17
- **Portée :** qualification Notebook Core v2 uniquement
- **Décision propriétaire solo :** poursuivre toute preuve Gate B réalisable sans données utilisateur, sans considérer l’absence de matériel physique comme un PASS

> **Supersession partielle :** ADR-0006 remplace la décision 8 et la conséquence associée concernant les classes 8 Gio et 16–24 Gio. Elles sont désormais des contributions facultatives non supportées et leur absence ne bloque plus la Gate B actuelle. Le texte ci-dessous est conservé comme décision historique ; l’exception de host et toutes les autres interdictions restent actives.

## Contexte

`WP-G2-S01` possède la frontière Rust/WASM Notebook, tandis que `WP-G3-N01` reste l’unique propriétaire final de `apps/notebook/**` après la fondation G2 intégrée. Gate B exige néanmoins le host produit exact avant d’autoriser toute sauvegarde utilisateur. Les PR #95 et #97 ont donc introduit, avant le démarrage de G3, une tranche produit désactivée et ses harnesses de fautes avec uniquement la fixture publique.

Cette tranche ferme l’absence de host exact puis observe crash, kill, redémarrage et nettoyage sur trois navigateurs. Elle ne ferme pas l’OOM réel du processus, l’épuisement physique du quota, l’effacement physique de la RAM/OS, les classes macOS arm64 8 Gio et 16–24 Gio ni les revues spécialisées fraîches. Le propriétaire ne dispose pas actuellement de ces classes matérielles.

## Décision

1. `WP-G3-N01` reste l’unique propriétaire du chemin `apps/notebook/**` et la reconstruction Notebook G3 ne démarre pas avant ses dépendances.
2. Jusqu’au verdict final Gate B, une exception G2 permet seulement de modifier la tranche de qualification désactivée sous `apps/notebook/**`, ses harnesses dédiés sous `tools/qualification/notebook-core-v2/**` et ses preuves non normatives.
3. Chaque lot exceptionnel doit être explicitement lié à Notebook Gate B, utiliser uniquement des fixtures publiques, rester fermé par défaut et recevoir une passe candidate-integration sur commit immuable. Les revues Gate B spécialisées restent séparées.
4. Le host exceptionnel ne peut implémenter le notebook blocs/révisions réel, accepter une donnée utilisateur, activer la feature, produire une sauvegarde réelle, ajouter télémétrie/réseau/service externe ou revendiquer production/release.
5. Les manifestes et lockfiles racine restent sous l’intégration `WP-G2-T01`. Leur delta déjà fusionné par #95 est ratifié comme intégration toolchain après CI verte ; tout futur delta racine requiert à nouveau cet intégrateur.
6. Une VM, un conteneur, une limite processus simulée ou une extrapolation reste diagnostic-only et ne promeut aucune classe physique.
7. L’effacement logique/best-effort doit être distingué de l’effacement physique. Une limite non démontrable reste un finding ou exige une modification explicite de la garantie suivie des revues concernées ; aucun waiver implicite n’est admis.
8. L’absence locale de matériel 8 Gio et 16–24 Gio maintient Gate B en `REJECT`. La preuve peut venir d’une contribution physique indépendante conforme, d’un matériel acquis/emprunté/loué sans donnée utilisateur, ou d’une future réduction gouvernée de la matrice de support ; aucune option n’est sélectionnée silencieusement.

## Preuves déjà intégrées

- PR #95, commit `b2a873ee2fcd065c34053b5da9b77737b4302787` : host produit exact désactivé, fixture publique, worker jetable, staging IndexedDB chiffré et trois navigateurs ;
- PR #97, commit `bdee4d95be030610e25cbd273787161e4ca982ed` : `SIGKILL`, `SIGABRT`, redémarrage, nettoyage, refus du mauvais recovery et signaux process observés sur les trois navigateurs ;
- six verdicts Gate B historiques, tous `REJECT`, indexés sous `docs/reviews/notebook-core-v2/gate-b/` ;
- dernier verdict Gate B `5190972` : budgets de référence passés, promotion d’usage refusée.

## Sortie de l’exception

L’exception expire au premier des événements suivants :

- Gate B approuve le host exact et une matrice de support explicite ;
- le propriétaire abandonne ou remplace Notebook Core v2 par une nouvelle décision revue ;
- `WP-G3-N01` démarre après satisfaction de ses dépendances, sans hériter d’une autorisation de données ou release non accordée.

Son expiration ne vaut jamais activation produit. Les gates Notebook G3, sécurité locale, vie privée et release restent additives.

## Conséquences

- les PR #95/#97 ne sont plus une exception implicite aux write paths ;
- le dépôt peut fermer les preuves logicielles sans faux matériel ni faux effacement physique ;
- l’indisponibilité matérielle reste visible comme blocage et non comme dette masquée ;
- aucun moteur Radar, Policy ou Boussole n’est autorisé par cette décision.
