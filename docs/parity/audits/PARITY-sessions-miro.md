# Parity Audit: Sessions vs. Miro + Mural

> **Statut de calibrage (2026-08-18, ADR-0027) :** cet audit mesure la
> **spec** du produit, pas son code livré — requalifié **« spec-baseline,
> non opposable »** jusqu'à ré-exécution contre du code réellement livré.
> Les chiffres de couverture restent un inventaire de traits utile, mais ne
> peuvent fonder aucun `promotion_criteria`/`kill_predicate` de fiche
> produit avant cette ré-exécution ni avant que le jalon dogfooding du
> produit soit atteint. Voir
> `docs/adr/0027-parity-gates-fire-only-after-dogfooding.md`.

**Scope:** Collaborative whiteboard/canvas for group work — compare Sessions spec against benchmarks.
**Date:** 2026-07-22 | **Evidence:** Deep research via web + spec cross-reference.

## Benchmark Inventory: Miro + Mural Features (60+ mapped)

### Canvas & Content
1. Infinite canvas | 2. Sticky notes | 3. Frames/sections | 4. Text elements | 5. Shapes/drawing | 6. Freehand/pen
7. Images/screenshots | 8. Links/URLs | 9. Video/media embedding | 10. Tables | 11. Flowchart templates
12. Wireframe elements | 13. Org chart templates | 14. Mindmap generation (AI) | 15. Color-coding

### Collaboration & Presence
16. Real-time sync | 17. Presence cursors/indicators | 18. Activity feed | 19. Participant list | 20. Zoom/pan
21. Alignment/grid tools | 22. Rulers | 23. Drag-drop | 24. Undo/redo

### Roles & Permissions
25. Facilitator role | 26. Observer role | 27. Participant role | 28. Locking content | 29. Private mode (facilitator-only view)
30. Edit permissions | 31. View permissions | 32. Comment permissions | 33. Share links | 34. Email invitation

### Facilitation Tools
35. Voting/polling (emoji, dot-voting) | 36. Timers/time-boxing | 37. Attention management | 38. Breakout regions
39. Ranking exercises | 40. Priority matrix | 41. Sticky note clustering | 42. Brainstorm templates
43. Retrospective templates | 44. Design thinking templates | 45. Agile templates

### Comments & Feedback
46. Inline comments | 47. Annotations | 48. Emoji reactions | 49. Thread replies | 50. Mention (@user)

### Organization & Navigation
51. Folders/board collections | 52. Board templates library | 53. Outline/navigation pane | 54. Search/find | 55. Board themes

### Export & Integration
56. Export PNG/PDF/SVG | 57. ZIP bundle download | 58. Web embed code | 59. Slack integration | 60. Microsoft Teams integration
61. AI summarization | 62. Version history

## Parity Matrix

| Section | COUVERT (Spec ✓) | ABSENT-T1 (Core Sovereignty) | ABSENT-T2 (Extended) | CONFLIT (Non-Goal) |
|---------|----------|------|------|--------|
| **Real-time Collab** | Presence, WebSocket async reconnect, observer mode | → see DESIGN-sovereign-realtime-collab | — | — |
| **Contribution Model** | Participant submissions, facilitator synthesis, approval gate | Voting/polling, Timers (facilitation UX) | Templates library | General chat, LMS |
| **Facilitator Tools** | Export, audience rules, retention | Dot-voting, attention management | Sticky clustering, brainstorm | Facilitator-blind private mode |
| **Permissions** | Role-based (participant/facilitator/observer), RLS | Fine-grained (lock regions) | Org templates | Global discovery |
| **Content** | Event stream (bounded), approval proof | Rich blocks (video, tables), AI diagrams | Diagram AI | Marketplace, cloud AI |
| **Export & Retention** | Audience bundle, deletion, compliance | Structured formats (JSON+evidence) | Web embeds, Slack, versioned | Unrestricted private export |

## Coverage Counts

| Metric | Count |
|--------|-------|
| **Total benchmark features** | 62 |
| **COUVERT in Sessions spec** | 16 |
| **Absent-T1 (sovereignty-preserving)** | 6 |
| **Absent-T2 (extended/nice-to-have)** | 12 |
| **CONFLIT (spec non-goals)** | 4 |

## Tier 1 Amendments (Core Sovereignty-Compatible)

1. **Voting & Polling** — Tally in events, never auto-decide. Facilitator approves outcome from votes. Amendment: `AddPoll` command, `PollSubmitted` event.

2. **Timers** — Ephemeral Redis state, soft signal only (no mutation lock). Facilitator extends/ends. Amendment: Timer in presence, WebSocket beacon, no new event type.

3. **Undo/Redo** — Per-user local state during edit; submitted contribution is append-only. Amendment: Client-side only, spec forbids mutation post-submit.

4. **Structured Facilitation** — Sticky clustering, ranking as templates (pre-filled config). Amendment: `template: retrospective | brainstorm` in `CreateSession`.

5. **Outline/Zoom Navigation** — Frame navigation as query (not panning authority). Amendment: `ListFrames` query, client owns visual zoom.

6. **Accessibility** — Keyboard + screen reader (spec already requires). Amendment: ARIA labels, polite announcements, E2E keyboard-only.

## Tier 2 Amendments (Extended)

- **Template Library** — Org-curated (not marketplace). Pre-built sessions (retrospective, design workshop).
- **Sticky Clustering** — Post-processing UI: select → auto-group by similarity. Result is read-only summary frame.
- **AI Summarization** — Gated, calls provider with session digest only (no raw content). Drafts outcome for human review.
- **Slack/Teams Notifications** — Webhook for session state (created, approved, deleted). No write-back.
- **Version Snapshots** — Timestamp-labeled export in Cellar with hash. "Replay to point" inspection (read-only).

## Key Arbitrages

**Option A: Timers as Hard Deadline** → Reject. Timers stay soft; facilitator manually closes.
**Option B: Private Facilitator Mode** → Reject. Breaks audit trail, conflicts transparency. Use async instead.
**Option C: Nested Sub-Sessions** → Defer to layer-3 design. Sessions are flat.

## Recommended Next Steps

1. Owner confirms T1 amendments. Rejections?
2. Architect sovereign-realtime-collab layer (separate work).
3. Prioritize T1 only. T2 deferred post-GA.
4. Security review: RLS for polling, vote privacy, facilitator audit.
