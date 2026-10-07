# ADR-0012 — Frontière des données personnelles et régime des personnes tierces

- **Statut :** accepted — la ratification est le merge propriétaire de cette pull request
- **Date :** 2026-07-25
- **Arbitrage :** propriétaire, session du 2026-07-25 (dogfooding veille-contribution : le besoin propre devient le premier client réel de Radar, Notebook et memory).
- **Portée :** doctrine — ce qui peut entrer dans un commit public, où vivent les données d'instance, et ce qu'une fiche portant sur une personne physique peut contenir.
- **Étend :** ADR-0009 §9 (tous les repositories sont publics, aucun élément privé personnel n'appartient au portefeuille) ; `DATA-PROVENANCE.md` ; `docs/architecture/DATA-OWNERSHIP.md`.

## Contexte

Le socle porte une politique de provenance des données (`DATA-PROVENANCE.md`) qui refuse la publication de tout jeu de données dont la provenance, la vie privée ou les droits de redistribution ne sont pas résolus. Il porte aussi une doctrine de propriété des données (tenant opaque obligatoire, pas de table cross-produit) et une brique RGPD éprouvée (`packages/rgpd-kit`).

Aucun de ces textes ne règle le cas qui se présente maintenant : **l'utilisateur d'un produit y consigne des informations concernant une personne qui n'est pas utilisatrice**. `rgpd-kit` traite les personnes concernées qui sont des utilisateurs identifiés d'un produit — `verifySubject` part d'un identifiant que la personne a elle-même fourni. Boussole évite entièrement la question par interdiction (« prohibited person targeting », plancher de groupe d'au moins cinq). Ni l'un ni l'autre ne couvre une fiche portant sur un tiers.

Le dogfooding veille-contribution rend la question concrète et non contournable : suivre les publications d'organisations d'intérêt général conduit à consigner des personnes — responsables syndicaux, parlementaires, chercheurs, journalistes — dont les prises de position publiques relèvent, par nature, des catégories particulières de l'Article 9 (opinions politiques, appartenance syndicale).

Deux constats commandent les décisions qui suivent.

**L'exemption domestique ne s'applique pas.** L'exception d'activité strictement personnelle ou domestique couvre un carnet d'adresses privé. Ici la finalité est explicitement professionnelle — contribuer, être sollicité, collaborer éventuellement. L'exemption tombe, y compris pour un stockage local et chiffré. Le chiffrement est une mesure de sécurité, jamais une base légale.

**Séparer les emplacements ne suffit pas.** Décider « les données personnelles ne vont pas sur GitHub » règle la publication, pas le traitement. Une fiche qui agrège des inférences sur les opinions d'une personne reste un traitement de données sensibles, qu'elle soit publique ou chiffrée sur un disque.

## Décisions

### D1 — Trois strates étanches, chacune avec son garde-fou

| Strate                 | Contenu                                                           | Emplacement                                | Garde-fou                                          |
| ---------------------- | ----------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| Code                   | moteurs, contrats, schémas, règles de curation, évidence de forge | repository public                          | `reuse lint` (I-11)                                |
| Données d'organisation | flux, items normalisés, décisions de curation, publications       | instance Radar privée, tenant opaque + RLS | `check-personal-data-boundary.ts`                  |
| Données personnelles   | fiches de personnes, notes de relation                            | device de l'utilisateur, dans Notebook     | `check-no-transmission.ts` + local-only (ADR-0002) |

Le repository publie du **code**, jamais des **données d'instance**. Aucun jeu de données réel, aucun export de veille, aucun répertoire de travail d'instance n'entre dans un commit. La seule exemption est celle que `DATA-PROVENANCE.md` prononce déjà : les fixtures synthétiques sous `contracts/fixtures/**` sont des vecteurs de test logiciels, pas des données réelles.

### D2 — Régime des personnes tierces : conditions cumulatives d'admission

Une personne physique n'entre dans aucun produit tant que les quatre conditions suivantes ne sont pas remplies pour le traitement concerné :

1. une base légale explicite et écrite, avec sa mise en balance des intérêts ;
2. le traitement de l'obligation d'information, y compris lorsque les données ne sont pas collectées auprès de la personne ;
3. une inscription au registre des activités de traitement (`generateArt30Register` existe déjà) ;
4. les droits d'accès, de rectification, d'effacement, de limitation et d'opposition **exerçables sans développement supplémentaire**.

La quatrième condition est la plus contraignante et c'est délibéré : un droit qui exigerait d'écrire du code pour être honoré n'est pas un droit. `packages/rgpd-kit` fournit le port et les modèles ; le pendant tiers reste à construire et conditionne l'ouverture de la strate.

### D3 — Contenu d'une fiche : faits sourcés uniquement

> Une fiche portant sur une personne physique ne contient que des **faits sourcés** : nom, organisation, fonction, et des déclarations publiées **par la personne elle-même**, chacune portant son URL, sa date et sa citation verbatim. Aucune inférence, aucune appréciation, aucun champ libre.
>
> Toute analyse, hypothèse ou appréciation vit dans un bloc rattaché **au sujet traité**, jamais à la personne.

Cette règle est le pendant, pour les fiches, de l'interdiction de ciblage que Boussole applique aux énoncés. Elle a trois effets, dans cet ordre d'importance :

- elle maintient le traitement dans le seul régime défendable pour des données de l'Article 9 — celui des données manifestement rendues publiques par la personne concernée, qui ne couvre ni les inférences, ni les recoupements, ni les appréciations ;
- elle rend une demande d'accès triviale à honorer : la fiche **est** la réponse, et chaque élément porte déjà son origine ;
- elle est mécaniquement vérifiable, donc opposable : un champ sans source résolvable est refusé.

La séparation personne / sujet n'est pas une commodité de rangement. C'est elle qui permet d'analyser un sujet en profondeur sans jamais constituer un profil.

### D4 — L'instrument, et ce qu'il ne prouve pas

`tools/quality/check-personal-data-boundary.ts` rend D1 mécanique : refus de tout fichier de jeu de données, de tout répertoire d'instance, et de tout identifiant direct dans les fichiers suivis. Il échoue fermé et sur-bloque par choix ; chaque exemption est nommée et justifiée dans sa source.

Sa limite est énoncée ici pour que son silence ne soit jamais pris pour une preuve : **il ne sait pas reconnaître un nom de personne, une opinion inférée ou une affiliation écrites en prose**. C'est précisément la matière que D3 gouverne. La prose est tenue par l'architecture — Notebook est local-only et sans primitive sortante — et par la règle des faits sourcés, pas par ce scanner. Il arrête le collage accidentel et le fichier évident, pas un rédacteur décidé.

**Correction (2026-08-18).** À la ratification (2026-07-25), « Notebook est local-only et sans primitive sortante » était une affirmation d'architecture, pas encore un fait vérifié par garde-fou : `check-no-transmission.ts` (cité dans le tableau D1 comme garde-fou de la strate « Données personnelles ») existait dans `governance`, scopé à `apps/boussole`/`apps/practices` uniquement — aucun repository Notebook ne l'invoquait. Le mécanisme devient vrai le 2026-08-18, `libre-ai/notebook#21` : `check:no-transmission` câblé, scopé `apps/notebook/src`, dans le script `check` agrégé. Cette correction ne change aucune décision de D1 à D5 ; elle aligne la date à laquelle le garde-fou cité est devenu réel sur celle à laquelle il l'est devenu, plutôt que sur celle de la ratification.

### D5 — Aucun nouvel objet ; le graphe public reste fermé aux personnes

Le besoin de veille-contribution est un **cas d'usage guide**, pas un produit. Il ne crée ni application, ni brique, ni marque. Il se loge dans les objets existants : acquisition et curation dans Radar, fiches et liens dans Notebook, rapprochement dans `memory` (vague 3), briefing en projection au sens I-05.

Le graphe `knowledge-object.v1` conserve son `kind` fermé sur ses onze valeurs, toutes méta. **Aucune organisation ni personne n'y est ajoutée** : sa projection est publique et le site déclare ne détenir aucune donnée personnelle. Un besoin de graphe portant sur des acteurs se satisfait dans Notebook, sur le device, ou ne se satisfait pas.

## Conséquences

- Le registre des invariants reçoit I-21 (frontière code/données) et I-22 (régime des personnes tierces).
- La gate est câblée au job `bun-quality` de l'intégration continue, à côté des gardes existantes.
- `packages/rgpd-kit` doit recevoir son pendant tiers avant toute mise en œuvre de fiches ; D2 le rend bloquant.
- Notebook porte les fiches : les amendements déjà proposés par l'audit de parité (graphe de relations, attributs, mentions non liées) en deviennent le support, et sa gate de conformité applique D3.
- Radar reste dans son cahier des charges verrouillé : sources à flux uniquement, aucune donnée personnelle en instance serveur.
- Cette décision est doctrinale et non de phase : elle vaut au-delà du cas d'usage qui l'a motivée, pour tout produit du portefeuille qui viendrait à consigner un tiers.
