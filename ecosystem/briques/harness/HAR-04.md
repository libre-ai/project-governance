# HAR-04 — Garde-fous exécutables, juge en second

## Contexte

ADR-0045 ferme l'injection de prompt indirecte par construction (D66) : une politique déterministe juge chaque argument d'appel d'outil et refuse fermé (I-32). La détection n'y compte pour aucune des propriétés d'I-32 : elle reste une défense en profondeur. `docs/security/TOOL-CALL-RISK-CLASSIFICATION.md` classe les appels en quatre niveaux, de R0 à R3, et tient l'inconnu pour risqué. `pi-harness-challenger` en porte une réalisation.

## Ce que la brique ferme

- Un appel d'outil à effet exécuté sans qu'un garde déterministe l'ait jugé avant.
- Un juge par modèle compté comme isolation : ADR-0045 range la détection dans la défense en profondeur.
- Un garde modifié par l'agent qu'il contraint : I-17 range les mutations des garde-fous dans la surface à touche humaine.

## Ce qu'elle ne fait pas

- Elle ne tient pas la liste des outils admis. Sans HAR-03, le garde ne sait pas quel outil est déclaré.
- Elle ne renvoie pas un refus de politique vers une décision humaine : ce refus est terminal (ADR-0045).
- Elle ne remplace pas le confinement, qui relève de EXE-01.

## Mesure

Preuves citées : le module de politique de `pi-harness-challenger` et son test. Ils montrent un classement déterministe des appels, où un outil sans capacité déclarée demande confirmation. Le refus des opérations interdites ne vaut qu'en mode d'application ; le mode par défaut observe sans bloquer. Ils ne montrent ni la politique d'argument d'I-32, ni un juge par modèle.

La doctrine ne demande pas de taux de faux positifs pour un tel juge : cette exigence du rôle est une proposition de l'agent, non arbitrée.

Prochaine preuve : les vecteurs rouges d'ADR-0045 passés par un harnais de la flotte, et un taux de faux positifs publié pour tout juge placé en second.
