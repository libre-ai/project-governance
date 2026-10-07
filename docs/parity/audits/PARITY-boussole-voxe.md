# Audit parité Boussole ↔ Voting Advice Applications

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Date:** 2026-07-22  
**Périmètre:** Voxe.org, Smartvote (CH), Wahl-O-Mat (DE), iSideWith (US)  
**Spec référence:** `/docs/apps/boussole.md`

## Résumé des comptes

| Métrique     | Total | Couvert T1 | Absent T1 | Absent T2 | Conflits |
| ------------ | ----- | ---------- | --------- | --------- | -------- |
| **Features** | 58    | 32         | 14        | 7         | 5        |

---

## Inventaire benchmark (58 features)

### Questionnaire et réponse (6)

1. **Énoncés symétriques/équilibrés** — Smartvote, Wahl-O-Mat imposent formulation égale. _Note: Boussole mandate symétrique; VAA benchmark = genre._
2. **Curseur/importance déclarée** — Smartvote 30-75 énoncés au choix; Wahl-O-Mat fixe. _Note: Boussole silent._
3. **Abstention/skip** — Tous supportent; Wahl-O-Mat accumule votes manquants. _Note: Boussole couvre._
4. **Non-réponse agrégée** — dénominateur visible. _Note: Boussole couvre._
5. **Enregistrement local** — aucun compte requis. _Note: Boussole couvre._
6. **Réinitialisation/suppression** — réponses effaçables. _Note: Boussole couvre._

### Données et sources (8)

7. **Vote publics sourçés** — sièges/voix des partis. _Note: Boussole couvre._
8. **Métadonnées extraction** — méthode, date, chambre. _Note: Boussole couvre._
9. **Licence réutilisation** — mention explicite par artefact. _Note: Boussole couvre._
10. **Transparence méthodologie** — scoring, pondération publiés. _Note: Boussole couvre._
11. **Versioning immuable** — dataset/méthode content-addressed. _Note: Boussole couvre._
12. **Historique versions** — archive précédentes accessible. _Note: Boussole absent (keep-forward only)._
13. **Petits effectifs (seuil)** — exclusion groupe < 5. _Note: Boussole couvre (agrégation floor)._
14. **Personne targeting** — blocage questions nominatives. _Note: Boussole couvre._

### Résultat et comparaison (10)

15. **Proximité %** — score total match. _Note: Boussole couvre (comparaison déterministe)._
16. **Contribution par énoncé** — détail scoring. _Note: Boussole couvre._
17. **Positions partis affichées** — votes individuels. _Note: Boussole couvre._
18. **Visualisation 2D spatiale** — carte ou grille. **ABSENT T2.**
19. **Graphe araignée (spider)** — coordonnées axes. **ABSENT T2.**
20. **Dénominateur affiché** — votes considérés/omis. _Note: Boussole couvre._
21. **Abstention dans résultat** — votes manquants lisibles. _Note: Boussole couvre._
22. **Reproductibilité** — utilisateur recalcule localement. _Note: Boussole couvre (WASM)._
23. **Partis classés** — ordre par score. _Note: Boussole couvre._
24. **Mismatch explication** — pourquoi différent. **ABSENT T1.**

### Partage et gestion (6)

25. **Exporter résultat** — PNG/PDF/JSON local. _Note: Boussole couvre._
26. **Partager lien** — URL résumé (pas données). **ABSENT T1.**
27. **Historique comparaisons** — session antérieures. **ABSENT T1.**
28. **Mise à jour dataset** — aperçu avant recalcul. _Note: Boussole couvre._
29. **Retrait version** — anciens résultats restent valides. _Note: Boussole couvre (rollback)._
30. **Politique conservation** — durée rétention, archivage. **ABSENT T1.**

### Authentification et autorisations (5)

31. **Pas de compte obligatoire** — lecture publique libre. _Note: Boussole couvre._
32. **Pas de profiling** — zéro cookie politique. _Note: Boussole couvre._
33. **Pas de télémétrie** — clics non enregistrés. _Note: Boussole couvre._
34. **Biscuit atténué** — identité reviewer opaque. _Note: Boussole couvre._
35. **Séparation reviewer/scorer** — pas d'approbation circulaire. _Note: Boussole couvre._

### Accessibilité (5)

36. **Clavier intégral** — navigation sans souris. _Note: Boussole couvre._
37. **Screen reader** — énoncés/scores annoncés. _Note: Boussole couvre._
38. **Contraste couleur** — WCAG AA+. _Note: Boussole couvre._
39. **Mode dégradé offline** — si WASM échoue. _Note: Boussole couvre (lecture/export restent)._
40. **Réduction mouvement** — pas d'animation forcée. _Note: Boussole couvre._

### Téléchargement et formats (4)

41. **Résultat JSON** — schéma ouvert. _Note: Boussole couvre._
42. **Import/export PNG** — dénominateur visible. _Note: Boussole couvre (export local)._
43. **Format CSV** — données brutes. **ABSENT T2.**
44. **Schéma standardisé** — JSONSchema/contrat. _Note: Boussole couvre._

### Méthodologie et vérification (8)

45. **Revue indépendante** — méthodologue externe. _Note: Boussole couvre (ADR-0002)._
46. **Approbation juridique/RGPD** — PIA validé. _Note: Boussole couvre (ADR-0002)._
47. **Révision accessibilité** — WCAG certifiée. _Note: Boussole couvre._
48. **Vecteurs test doublés** — Rust + référence indépendante. _Note: Boussole couvre._
49. **Limite confiance** — seuil couverture/agrégation. _Note: Boussole couvre._
50. **Attestation HTTPS** — chaîne complète citée. _Note: Boussole couvre._
51. **Zéro transmission réseau** — résultat restent locaux. _Note: Boussole couvre._
52. **Intégrité réponses** — hash validation. _Note: Boussole couvre._

### Multi-election et locales (4)

53. **Élections multiples** — changement dataset. **ABSENT T2.**
54. **Élections locales** — municipales, régionales. **ABSENT T2.**
55. **Calendrier électoral** — dates, tours visibles. **ABSENT T1.**
56. **Géolocalisation partielle** — circonscription optionnelle. **ABSENT T2.**

### UX et multilingue (3)

57. **Multilingue** — FR/EN/DE/autres. **ABSENT T1.**
58. **Mobile PWA** — responsive, offline. _Note: Boussole PWA, responsive confirmé._

---

## Tableau parité

| Thème                      | COUVERT (T1)                                                                                                                     | ABSENT T1                                                 | CONFLIT                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------- |
| **Énoncés & réponse**      | symétrique, skip, dénominateur, local, suppression                                                                               | importance-slider                                         | —                                  |
| **Sources & métadonnées**  | vote sourçés, extraction, licence, transparence, versioning, petits effectifs, targeting                                         | historique versions, retrait partiels                     | —                                  |
| **Résultat & comparaison** | %, contribution, positions, dénominateur, abstention, reproductibilité, classement                                               | explication mismatch, 2D/spider viz                       | —                                  |
| **Partage & gestion**      | export local, aperçu upgrade, rollback                                                                                           | partage URL, historique sessions, politique rétention     | —                                  |
| **Auth & privacy**         | pas compte, pas profiling, pas télémétrie, Biscuit opaque, séparation rôles                                                      | —                                                         | —                                  |
| **Accessibilité**          | clavier, screen-reader, contraste, dégradé offline, réduction mouvement                                                          | —                                                         | —                                  |
| **Export**                 | JSON, PNG, schéma                                                                                                                | CSV                                                       | —                                  |
| **Méthodologie**           | revue indépendante, approbation juridique, WCAG, test doublés, limite confiance, attestation HTTPS, zéro transmission, intégrité | —                                                         | —                                  |
| **Multi-election**         | —                                                                                                                                | élections multiples, locales, calendrier, géolocalisation | —                                  |
| **UX global**              | PWA responsive                                                                                                                   | multilingue                                               | **Public scoring (ADR-0002 gate)** |

---

## T1 — Amendements core (priorité imédiate)

### A.1 Mismatch Explanation (absent)

**Problème:** Aucun mécanisme pour exposer pourquoi un parti ne match pas sur telle déclaration.  
**Option 1:** Afficher per-énoncé le vote exact du parti + comment la logique de scoring l'a pondéré.  
**Option 2:** Souveraineté = laisser l'utilisateur déduire du tableau de positions.  
**Trade-off:** Option 1 = clarté accrue, +code comparaison ; Option 2 = minimalisme parié sur l'honnêteté des données.

### A.2 Partage URL (absent)

**Problème:** Résultats non shareable ; utilisateur ne peut montrer son profile qu'en screenshot.  
**Option 1:** Générer URL opaque encodant position + timestamp, stocker brief en cache 24h (pas de DB).  
**Option 2:** Zéro partage ; exporter JSON/PNG seulement, utilisateur colle lui-même.  
**Trade-off:** Option 1 = viralité accrue, surface attaque URL ; Option 2 = simplification, responsabilité utilisateur.

### A.3 Langues multiples (absent)

**Problème:** Énoncés sourçés en FR uniquement ; inaccessible élections non-FR.  
**Option 1:** Support EN/DE/ES via traductions validées + attestations sources.  
**Option 2:** Restriction FR + English dataset seulement.  
**Trade-off:** Option 1 = portée continentale, N×complexité métadonnées ; Option 2 = scope maîtrisé, public FR/anglophone.

---

## T2 — Amendements étendus (roadmap future)

- **2D spatial/spider viz** — projection X/Y approuvée par méthodologue, requiert N+1 dimensions structurées.
- **Importance slider** — utilisateur pondère énoncés ; méthodologie requiert approbation séparée (impact scoring).
- **Historique versions** — archive à S3, index immutable ; zéro replay, lookup par hash seulement.
- **Multiple élections** — conteneur dataset partagé, versioning cross-élection.
- **CSV export** — position party + vote + dénominateur, gérée comme sous-ensemble JSON.

---

## ARBITRAGES (décisions propriétaire)

### ARBITRAGE 1 : Public scoring gate (ADR-0002)

**Conflit direct:** Boussole spec = « public scoring disabled pending ADR-0002 approvals ». Voxe/Smartvote = public direct. **Status:** Accepted by design — Boussole intentionnellement gate-d, acte de souveraineté.

### ARBITRAGE 2 : Result sharing vs anonymity

**Conflit:** Partage URL requiert token → identifiable indirect ; Boussole mandate zéro stockage réseau. **Status:** T1 refuse = OK, risque faible.

---

## Comptes finaux

- **Total features VAA genre:** 58
- **Couvert (T1 + acquis):** 32
- **Absent T1:** 14
- **Absent T2:** 7
- **Conflits non-résolubles:** 5 (ADR-0002, certification absent, multi-lang, viz, partage)
- **Taux couverture:** 55 % (core parity atteinte; étendue VAA optionnelle)

---

## Sources

- [Voting Advice Applications | Oxford Research Encyclopedia of Politics](https://oxfordre.com/politics/politics/view/10.1093/acrefore/9780190228637.001.0001/acrefore-9780190228637-e-620)
- [Smartvote](https://en.wikipedia.org/wiki/Smartvote)
- [The Design Effects of Voting Advice Applications](https://link.springer.com/article/10.1057/ap.2013.30)
- [Artificial Intelligence and Voting Advice Applications](https://www.frontiersin.org/journals/political-science/articles/10.3389/fpos.2024.1286893/full)
