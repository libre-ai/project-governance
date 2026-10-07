# Parity Audit: Specifications vs. Notion + Linear

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Scope:** Spec/PRD/decision authoring surface — compare Specifications spec against benchmarks.
**Date:** 2026-07-22 | **Evidence:** Deep research via web + spec cross-reference.

## Benchmark Inventory: Notion + Linear Features (70+ mapped)

### Document Model (Notion)
1. Pages/docs | 2. Markdown blocks | 3. Heading blocks | 4. List/bullet blocks | 5. Toggle blocks
6. Callout blocks | 7. Quote blocks | 8. Code blocks | 9. Dividers | 10. Table blocks
11. Embed blocks | 12. Image blocks | 13. File blocks | 14. Synced blocks | 15. Linked page blocks

### Database & Structure
16. Databases (structured records) | 17. Properties (~15 types) | 18. Database views (table, kanban, timeline, gallery, calendar)
19. Database filters | 20. Database sorting | 21. Database grouping | 22. Relations (link databases)
23. Rollups (aggregate linked data) | 24. Formulas | 25. Templates (database + page) | 26. Sub-pages (nested docs)
27. Breadcrumbs | 28. Table of contents

### Collaboration & Review
29. Comments (inline, page-level) | 30. Mentions (@user) | 31. Reactions (emoji) | 32. Comment threads | 33. Page linking (backlinks)
34. Version history (page-level) | 35. Workspace history | 36. Activity log | 37. Trash/restore

### Permissions & Access
38. Role-based permissions (viewer, commenter, editor, owner) | 39. Page-level sharing | 40. Link sharing (public/private)
41. Email invitations | 42. Guest access | 43. Comment-only access | 44. Workspace permissions | 45. API tokens

### Issue Tracking (Linear)
46. Issues/tasks | 47. Priority (urgent, high, medium, low) | 48. Status (backlog, todo, in progress, done, cancelled)
49. Assignee tracking | 50. Due dates | 51. Cycles/sprints | 52. Epic/parent tracking | 53. Child issues
54. Issue numbering/hierarchy | 55. Burndown charts | 56. Kanban workflow | 57. Backlog management | 58. Release planning
59. Deployment tracking | 60. Roadmap view | 61. Issue search/filter | 62. Bulk edit

### Integration & Export
63. Full-page export (PDF, Markdown) | 64. CSV export (databases) | 65. API access (page, database, property)
66. Zapier integration | 67. Email forwarding (create page) | 68. Slack integration | 69. GitHub linking
70. Deployment status

### Cross-Platform
71. Web app | 72. Mobile app | 73. Offline capabilities | 74. Presence indicators | 75. Notification settings

## Parity Matrix

| Section | COUVERT (Spec ✓) | ABSENT-T1 (Core) | ABSENT-T2 (Extended) | CONFLIT (Non-Goal) |
|---------|----------|------|------|--------|
| **Problem Statement** | Workspace, framing, actors, constraints, hypotheses | Criteria templates, risk templates | Pattern library | N/A |
| **Requirements & Decisions** | AddRequirement, RecordDecision, comments/review | Nesting (parent/child), decision tree, backlinks | Rollups, formulas | Generic Markdown editor; issue generator |
| **Contracts & Evidence** | AttachContract, path/hash refs | Contract diff UI, versioned manifests, citation backlinks | Library, attachment versioning | Mutual auto-linking |
| **Review Workflow** | ReviewSpec, comment + accept/reject | Parallel review, SLA/deadline, visibility toggle | Review history, anonymous | Issue auto-generation |
| **Package Acceptance** | AcceptSpecPackage (immutable), SupersedeSpecPackage | Diff UI (before/after), timeline view, immutability badge | Lineage graph, version tags | Mutation of accepted |
| **Planning Handoff** | CreatePlanningHandoff, export + planning-only token | Checklist (deps, risks, open), template by type | Notifications, auto-route | Capability escalation |
| **Accessibility** | Forms expose validation, diffs have tables, keyboard review | Keyboard-only authoring (no drag-drop), ARIA labels, screen-reader diffs | Dark mode, high-contrast, dyslexia font | N/A |
| **Persistence & History** | Draft revisions, immutable accepted, ADR edges | Soft delete, audit log (who/when/why), retention enforcement | Rollback, conflict resolution | Arbitrary trash/restore |

## Coverage Counts

| Metric | Count |
|--------|-------|
| **Total benchmark features** | 75 |
| **COUVERT in Specifications spec** | 20 |
| **Absent-T1 (core, required)** | 8 |
| **Absent-T2 (extended)** | 12 |
| **CONFLIT (spec non-goals)** | 5 |

## Tier 1 Amendments (Core)

1. **Requirement Nesting** — Parent/child relationships (epic/story). RLS: child visibility = parent visibility. Amendment: `CreateRequirement(parentId?: ID)`.

2. **Decision Backlinks** — Auto "resolved by" and "requires decision" relations. Link requirement → decision. Amendment: Implicit relation via content-addressing.

3. **Acceptance Criteria Templates** — Org-curated (e.g., "WCAG 2.1 AA", "Security review proof"). Pre-fill DefineAcceptanceCriterion. Amendment: Template as JSON schema.

4. **Risk Control Templates** — Similar to acceptance criteria. Pre-built controls (e.g., "Cryptographic audit"). Org library. Amendment: Same mechanism.

5. **Diff UI (Version → Version)** — Structured diff: requirements added/removed/changed, decisions open→closed, contracts. Amendment: `DiffSpecVersions(v1, v2)` query.

6. **Version Timeline View** — draft → submitted → review-frozen → accepted → superseded. Shows who approved, when. Amendment: Client derives from events + attestation.

7. **Parallel Review** — N reviewers independently. Acceptance requires all accept OR owner force-accept (audit note). Amendment: RLS enforces author ≠ approver.

8. **Keyboard-Only Authoring** — No drag-drop required. All via form/tab/arrow keys. E2E validates. Amendment: ARIA labels, @testing-library/user-event.

## Tier 2 Amendments (Extended)

- **Requirement Rollups** — "Blocking decisions" = count, "Test coverage" = rollup from criteria.
- **Issue Generation Template** — Org opt-in to auto-create Linear issues from accepted packages. Link only (no mutation).
- **Soft Delete + Audit Trail** — Mark superseded as "archived". Audit log: who, when, why. Retention policy enforced.
- **Conflict Resolution UI** — Concurrent edits detected. Show both versions, manual merge into new draft.
- **Package Snapshot Rollback** — Restore prior accepted version (new edge). Audit notes reason. Goes through acceptance gate again.

## Key Arbitrages

**Option A: Database Views** → Reject in T1. Use tables only. Views in T2 if requested.
**Option B: Issue Auto-Generation** → Reject in T1. Owner exports + manually ingests. T2 if governance allows.
**Option C: Workflow Automation** → Reject. Spec is declarative, not imperative.
**Option D: Rich Comments** → Reject. Contracts as structured JSON/Markdown only.

## Recommended Next Steps

1. Owner confirms T1 amendments (nesting, backlinks, templates, diff UI, parallel, keyboard, timeline). Rejections?
2. Architect template system (curator workflow, org library, version sync).
3. Prioritize T1 only. T2 deferred post-GA.
4. Security review: RLS for drafts/accepted, capability attenuation, no execution flow-through.
