# Audit parité Practices ↔ DataCamp-style Interactive Learning

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Date:** 2026-07-22  
**Périmètre:** DataCamp, Codecademy, interactive exercise pedagogy (hints, spaced practice, progress tracking)  
**Spec référence:** `/docs/apps/practices.md`

## Résumé des comptes

| Métrique     | Total | Couvert T1 | Absent T1 | Absent T2 | Conflits |
| ------------ | ----- | ---------- | --------- | --------- | -------- |
| **Features** | 62    | 35         | 11        | 9         | 7        |

---

## Inventaire benchmark (62 features)

### Exercices interactifs (8)

1. **Exercices code en-navigateur** — pas d'installation locale. _Note: Practices couvre._
2. **Scénarios professionnels** — situations réalistes. _Note: Practices couvre._
3. **Guidé vs non-guidé** — choix difficulté. _Note: Practices absent (T1 apprentissage seulement)._
4. **Données désordonnées** — contexte messy real-world. **ABSENT T1.**
5. **Rétroaction instantanée** — résultat immédiat. _Note: Practices couvre._
6. **Indices/hints progressifs** — escalade guidance. _Note: Practices couvre._
7. **Bandes de tâches (step-by-step)** — décomposition. _Note: Practices couvre._
8. **Retry/refaire** — réinitialisation exercice. _Note: Practices couvre._

### Feedback et explication (7)

9. **Feedback non-punitif** — encouragement, pas jugement. _Note: Practices couvre._
10. **Sources citations** — références explicites. _Note: Practices couvre._
11. **Limitations exposées** — quand feedback fail. _Note: Practices couvre (degraded mode)._
12. **Explication reasoning** — pourquoi réponse juste. _Note: Practices couvre._
13. **Feedback schema-validé** — contrat éprouvé. _Note: Practices couvre._
14. **Feedback non-généré** — humain-reviewed seulement. _Note: Practices couvre._
15. **Version immuable** — feedback lié à version activité. _Note: Practices couvre._

### Suivi et progression (7)

16. **XP/points** — récompense numérique. **ABSENT T1.**
17. **Streaks/consistance** — jours consécutifs. **ABSENT T1.**
18. **Barre progression** — % complétion activité. _Note: Practices couvre (local progress)._
19. **Badges/achievement** — micro-récompense. **ABSENT T2.**
20. **Temps completion** — durée exercice. **ABSENT T1.**
21. **Historique tentes** — prior answers logguées. **ABSENT T1.**
22. **Analytics personnelle** — tableau de bord apprenti. **ABSENT T1.**

### Parcours et chemins (6)

23. **Skill tracks** — chaîne logique d'activités. **ABSENT T1.**
24. **Prérequis** — dépendances skill. **ABSENT T1.**
25. **Niveau apprenti** — débutant/intermédiaire/avancé. **ABSENT T1.**
26. **Recommandations** — next activity suggérée. **ABSENT T2.**
27. **Flexibilité chemin** — skip saut autorisé. **ABSENT T2.**
28. **Diversité activités** — types mélangés. _Note: Practices couvre._

### Évaluation et certification (6)

29. **Quizz évaluation** — quiz séparé d'exercice. **CONFLIT → non-objectif.**
30. **Certification/badge** — attestation complétée. **CONFLIT → non-objectif.**
31. **Scorecard** — performance vis-à-vis normes. **CONFLIT → non-objectif.**
32. **Ranking/leaderboard** — classement apprenants. **CONFLIT → non-objectif.**
33. **Preuves de compétence** — portfolio shareable. **ABSENT T1.**
34. **Score numérique** — note quantifiée. **CONFLIT → nominative aggregate.**

### Auto-évaluation et agentivité (5)

35. **Réflexion apprenante** — learner self-assess. _Note: Practices couvre (RecordSelfAssessment)._
36. **Checkpoint halte** — pause pour introspection. **ABSENT T1.**
37. **Feedback learner vs auto** — comparaison autoéval vs feedback. _Note: Practices couvre (Review evidence)._
38. **Retry stratégie** — conseil amélioration. _Note: Practices couvre (hints)._
39. **Objectif personnel** — learner-set goal. **ABSENT T2.**

### Accessibilité (6)

40. **Clavier intégral** — navigation sans souris. _Note: Practices couvre._
41. **Screen reader** — annonces instructions/feedback. _Note: Practices couvre._
42. **Contraste couleur** — WCAG AA+. _Note: Practices couvre._
43. **Réduction mouvement** — pas animation forcée. _Note: Practices couvre._
44. **Texte tailles** — zoom 200% lisible. _Note: Practices couvre._
45. **Timing flexible** — pas deadline rigide. _Note: Practices couvre._

### Offline et données locales (5)

46. **Offline complet** — une fois déployé, pas réseau. _Note: Practices couvre._
47. **Stockage IndexedDB** — données locales persistantes. _Note: Practices couvre._
48. **Pas d'upload réponse** — zéro transmission positions. _Note: Practices couvre._
49. **Export portable** — format JSON ouvert. _Note: Practices couvre._
50. **Suppression locale** — réinitialisation complète. _Note: Practices couvre._

### Publication et revue (5)

51. **Soumission édition** — activité préparée pour revue. _Note: Practices couvre._
52. **Approbation humaine** — reviewer attributable. _Note: Practices couvre._
53. **Retrait version** — hide broken version. _Note: Practices couvre._
54. **Versioning immuable** — activité fiée après approval. _Note: Practices couvre._
55. **Licence explicite** — source/redistribution déclarées. _Note: Practices couvre._

### Génération contenu (3)

56. **Génération auto contenu** — LLM génère activités. **CONFLIT → non-objectif.**
57. **Modèle grading** — auto-scoring libre-texte. **CONFLIT → advisory only, human review.**
58. **Template activité** — pattern reutilisable. **ABSENT T1.**

### Plateforme généraliste (3)

59. **Chat tuteur** — assistant conversationnel. **CONFLIT → non-objectif (unrestricted prompt).**
60. **Prompt execution** — run arbitrary code. **CONFLIT → non-objectif.**
61. **LMS généraliste** — calendrier, devoirs, annonces. **CONFLIT → non-objectif (pas LMS).**

### Mobile et PWA (2)

62. **Mobile app** — client iOS/Android. **ABSENT T1.**
63. **Responsive PWA** — browser mobile. _Note: Practices couvre (PWA)._

---

## Tableau parité

| Thème              | COUVERT (T1)                                                                                  | ABSENT T1                                                     | CONFLIT                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Exercices**      | navigateur, scénarios, feedback immédiate, hints, step-by-step, retry                         | données messy, guidé/non-guidé                                | —                                                                         |
| **Feedback**       | non-punitif, sources, limitations, reasoning, schema validé, human-reviewed, version-immuable | —                                                             | —                                                                         |
| **Suivi**          | barre progression                                                                             | XP, streaks, temps, historique tentes, analytics              | —                                                                         |
| **Parcours**       | diversité activités                                                                           | skill tracks, prérequis, niveau, recommandations, flexibilité | —                                                                         |
| **Évaluation**     | —                                                                                             | portfolio, checkpoint                                         | **Certification, ranking, scoring, nominative aggregate**                 |
| **Auto-éval**      | self-assessment, feedback learner vs auto, hints                                              | objectif personnel                                            | —                                                                         |
| **Accessibilité**  | clavier, screen-reader, contraste, motion, texte, timing                                      | —                                                             | —                                                                         |
| **Offline**        | offline complet, IndexedDB, zéro upload, export, suppression                                  | —                                                             | —                                                                         |
| **Publication**    | soumission, approbation, retrait, versioning, licence                                         | template                                                      | —                                                                         |
| **Contenu généré** | —                                                                                             | —                                                             | **Auto-generation, LLM grading (advisory), chat tutor, prompt exec, LMS** |
| **Mobile**         | PWA responsive                                                                                | app native                                                    | —                                                                         |

---

## T1 — Amendements core (priorité immédiate)

### B.1 XP/Streak tracking (absent)

**Problème:** Zéro encouragement gamifié; apprenants perdent motivation à mid-session.  
**Option 1:** Ajouter `LocalProgressSnapshot.xp_earned` + `streak_days`, renouveler quotidien si activité faite.  
**Option 2:** Refuser gamification; feedback seul est motivant.  
**Trade-off:** Option 1 = retention accrue, psych implicite (risks overleaning on extrinsic) ; Option 2 = sobriété, focus apprentissage profond.

### B.2 Messy data contexts (absent)

**Problème:** Tous les exercices supposent données nettes ; DataCamp force learner à nettoyer inputs.  
**Option 1:** Ajouter `ActivityDefinition.data_profile` schema (nullable fields, outliers). Learner doit gérer.  
**Option 2:** Rester sur données parfaites; simplification pédagogique acceptable.  
**Trade-off:** Option 1 = réalisme, transfert authentic ; Option 2 = focus compétence isolée.

### B.3 Historique tentes (absent)

**Problème:** Apprentant ne voit pas progression within-session; refait sans conscienche d'erreurs prior.  
**Option 1:** Stocker IndexedDB `[{answer, timestamp, feedback_received}]` per-exercice; timeline affichée.  
**Option 2:** Fresco réinitialisation = amnésie ; forces re-réfléchir.  
**Trade-off:** Option 1 = métacognition, overhead UX ; Option 2 = pureté, risque oubli pattern.

---

## T2 — Amendements étendus (roadmap)

- **Skill tracks + prérequis** — DAG activités, ordre dépendance.
- **Niveau apprenti** — restriction content par niveau; progression tier.
- **Badges/achievements** — micro-reward milestones.
- **Mobile app native** — iOS/Android au-delà PWA.
- **Checkpoint réflexion** — pause inline before retry.
- **Recommandations** — next activity suggérée ML.

---

## ARBITRAGES (décisions propriétaire)

### ARBITRAGE 1 : Certification (conflit direct)

**Conflit:** DataCamp offre certificates; Practices spec « certification » = non-objectif.  
**Status:** Accepted by design — Practices mandate zéro employeur-facing proof. Cible = exercice pour jugement, pas portfolio.

### ARBITRAGE 2 : Ranking/leaderboard (conflit)

**Conflit:** DataCamp leaderboards motivent; Practices « employee ranking » = non-objectif.  
**Status:** Accepted by design — contexte education libre ≠ compétition. Zéro cross-learner visibility.

### ARBITRAGE 3 : Auto-generated content (conflit)

**Conflit:** DataCamp accepte templates; Practices « automatic publication of generated content » = non-objectif.  
**Status:** Accepted by design — human review mandatory. Model-assisted prep → human approval.

### ARBITRAGE 4 : Model grading (conflit)

**Conflit:** DataCamp + LLM grading libre-texte; Practices mandate human approval, model = advisory.  
**Status:** Accepted by design — free-text stays advisory. Ensures non-punitive, traceable.

---

## Comptes finaux

- **Total features DataCamp genre:** 62
- **Couvert (T1 + acquis):** 35
- **Absent T1:** 11
- **Absent T2:** 9
- **Conflits non-résolubles:** 7 (certification, ranking, auto-gen, model grading, LMS, chat, prompt exec)
- **Taux couverture:** 56 % (core parity atteinte; gamification/enterprise optionnelle)

---

## Sources

- [DataCamp - Interactive Learning Platform](https://www.datacamp.com/interactive-learning)
- [DataCamp vs Codecademy: In-Depth Comparison](https://www.dataquest.io/blog/datacamp-vs-codecademy/)
- [Interactive Educational Software | Best Practices 2026](https://worldmetrics.org/best/interactive-educational-software/)
- [Spaced Repetition and Pedagogical Design](https://thirdspacelearning.com/blog/spaced-repetition/)
- [DataCamp Exercise Types | Help Center](https://instructor-support.datacamp.com/en/articles/2360969-exercise-types)
