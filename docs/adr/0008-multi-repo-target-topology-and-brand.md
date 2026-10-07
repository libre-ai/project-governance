# ADR-0008 — Topologie cible multi-repository et posture de marque Libre AI

- **Statut :** accepted
- **Date :** 2026-07-19
- **Arbitrage :** propriétaire (session de consolidation source-de-vérité du 2026-07-19)
- **Portée :** écosystème — topologie GitHub, doctrine de distribution, marque
- **Remplace :** la doctrine « repositories spécialisés = projections générées à sens unique » (anciens vision.md §7.6/§7.7, TARGET.md, README.md), constatée sans trace d'arbitrage propriétaire
- **Amendé :** 2026-07-23 (décision propriétaire) — la préservation systématique des URLs historiques (point 2) est levée au profit de noms de repositories **conformes à l'architecture** ; premier cas appliqué : `agent-board` → `missions` (l'application couche-2 est l'autorité de mission ; Agent Board n'en est que la projection en lecture seule).

## Contexte

L'audit source-de-vérité du 2026-07-19 a établi que la doctrine de projections de repositories, présente dans des documents au statut accepted, ne correspondait pas à l'intention du propriétaire, qui l'a explicitement répudiée. Le même audit a mesuré la dérive de la présence publique : READMEs pré-freeze présentés comme vivants, écarts entre `ecosystem/LEGACY-MANIFEST.yaml` et l'état GitHub réel (`agent-factory` non archivé avec pushes post-freeze ; `website`, `benchmarks`, `dioxus-app-template` retirés sans trace). Après plusieurs itérations successives de vision, la base documentaire repart d'un état propre : corrections chirurgicales des sections incohérentes et registre d'invariants tracés.

## Décision

1. **Topologie cible = multi-repository.** L'organisation `libre-ai` héberge en cible :
   - le **socle** `libre-ai/libre-ai` : contrats, spécifications, fondations partagées, moteurs communs, gouvernance — l'autorité unique des invariants transverses (« socle épais ») ;
   - des **repositories produits réels** — développés, avec issues, pull requests et releases — un par produit, consommant le socle comme dépendance versionnée ;
   - des repositories de **famille plateforme/preuve** et de **distribution**, créés à leur activation sous des noms thématiques neufs (noms candidats en annexe, non normatifs) ;
   - `.github` (README d'organisation).
2. **Les repositories produits rouvrent sous un nom conforme à leur architecture** (amendement propriétaire 2026-07-23) : `feed-radar`, `notebook`, `ai-practices`, `sessions`, `boussole-politique`, `spec-studio`, `policy`, `missions`. La préservation systématique des URLs historiques est levée : un nom hérité trompeur est corrigé plutôt que perpétué — ainsi `agent-board` → `missions`, l'application couche-2 étant l'autorité de mission (propose → relit → autorise → valide), Agent Board n'en étant que la projection en lecture seule. Les repositories restent réservés, avec avertissement de statut, jusqu'à leur activation par décision propriétaire.
3. **Les repositories d'outillage hérités** — `gear`, `context-kit`, `client-kit`, `proof-kit`, `artifact-supply`, `design-system`, `agent-factory` — sont retirés de GitHub après capture vérifiée (miroirs complets + bundles du 2026-07-19). Leurs responsabilités vivent dans le socle ; leurs noms ne sont jamais réutilisés. `website`, `benchmarks` et `dioxus-app-template`, déjà retirés, ne sont pas recréés.
4. **« Projection » désigne exclusivement des artefacts générés** — documentation, SDK, context packs, catalogues, site — jamais des repositories. Le format `libre-ai.projection.v1` reste valable pour ces artefacts.
5. **Répartition socle/produits :** ce qui est partagé par plusieurs produits vit au socle (contrats, identité/authz, cycle de vie des données, UI partagée, preuve) ; ce qui n'appartient qu'à un produit vit dans son repository. Les modalités d'activation de chaque repository produit font l'objet d'une décision propriétaire dédiée.
6. **Marque : « Libre AI », option C.** Marque cible Libre AI, organisation GitHub `libre-ai`, domaine canonique `libre-ai.fr` (domaines défensifs conservés). Coexistence acceptée et gérée avec l'entité homonyme de Dublin (libreai.com, aucune marque EUIPO déposée — vérifié 2026-07-10) : dépôt d'une marque **figurative** EUIPO en classes conseil/formation/services logiciels (action propriétaire), ancrage francophone `.fr`, interdiction de revendiquer les comptes sociaux homonymes (@libre_ai, /company/libre-ai).
7. **Registre des invariants.** `docs/decisions/INVARIANTS.md` devient la liste exhaustive des invariants de doctrine ; chaque entrée porte sa source d'arbitrage propriétaire et sa date. Ce qui n'y figure pas n'est pas doctrine ; toute doctrine rédigée sans trace d'arbitrage est nulle.

## Conséquences

- `vision.md` (§4.1, glossaire, §7.3, §7.6, §7.7, arbre cible, §17.3, §20, vague 5), `docs/architecture/TARGET.md`, `README.md`, `GOALS.md` (G5), `STATUS.md` et `docs/transformation/BIG-BANG.md` (vague 5) sont corrigés par la PR qui porte cet ADR ;
- `ecosystem/LEGACY-MANIFEST.yaml` sera amendé à l'exécution du retrait des repositories d'outillage (capture déjà vérifiée) ;
- les phases G0–G4 et la discipline work-packages sont inchangées ; G5 publie packages, documentation, packs et active les repositories produits sur décision propriétaire ;
- le site vit en `apps/website` et se déploie sur la cible runtime ; il n'a pas de repository dédié.

Backfill (2026-08-18, Domain I — Process & CI) : le présent ADR est déjà,
dans `docs/decisions/INVARIANTS.md`, la source de I-01 (marque, point 6
ci-dessus) et de I-04 (noms de repository, point 2, amendé 2026-07-23) —
cette note rend cette citation lisible depuis l'ADR lui-même, elle n'ajoute
aucun invariant nouveau.

## Annexe non normative — noms candidats

- Plateforme/preuve : `ui`, `proof`, `artifacts`.
- Distribution : `starter`, `sdk-ts`, `sdk-rs`, `mcp-server`, `corpus`, `docs`.

Fixés à l'activation, par décision propriétaire.
