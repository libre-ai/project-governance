# Design : Collaboration temps réel souveraine — CRDT + E2EE + relay auto-hébergé

**Date** : 2026-07-22  
**Auteur** : Claude Code  
**Signature** : En attente  
**Classif.** : ADR-0011 (dur-stop D4)

---

## 1. Primitive CRDT — Sélection et rationale

### Candidats

| Critère           | **Loro**                                | Yjs (y-crdt/yrs)                   | Automerge v2           |
| ----------------- | --------------------------------------- | ---------------------------------- | ---------------------- |
| **Licence**       | MIT ✓                                   | MIT ✓                              | MIT ✓                  |
| **Rust core**     | ✓ Natif, 1.0 live                       | ✓ yrs (Rust port)                  | ✓ Réécriture Rust 2.0  |
| **Perf mémoire**  | **60% métadata** [1]                    | **YATA ~17-33x OT** [2]            | JSON-optimisé [3]      |
| **WASM binding**  | ✓ JS/TS/Swift via WASM                  | ✓ ywasm wrapper natif              | ✓ Cross-runtime [3]    |
| **E2EE protocol** | **WIP/proto-e2ee.md** [4]               | Aucune, clients gèrent             | Aucune, clients gèrent |
| **Matériel**      | **~920K DL/sem (Oct 2024)** [2]         | **17K stars, 1.2M+ DL/sem** [2]    | Paire asymétrique [3]  |
| **Écosystème**    | Émergent (Halecraft, startup)           | Consolidé (CodeMirror, Figma-like) | Académique + orgs      |
| **Approche**      | JSON collaboratif + primitives avancées | Text-first CRDT framework          | Merged snapshots       |

### **Recommandation : LORO**

**Rationale** :

- **Souveraineté mémoire** : 60% d'overhead métadata vs 17-33x pour OT [1] = viable pour données structurées (Sessions) + text (Notebook fragments).
- **Rust core garantit** : crypto-compatible (WASM E2EE, Biscuit K1 identity), déterministe hors-chaîne, zero-alloc critical path.
- **Protocol E2EE in-tree** : loro-protocol/src/encoding/e2ee (WIP mais présent) vs Yjs/Automerge = "clients gèrent" = surface d'attaque éparse.
- **Scalabilité locale** : Loro 1.0 réalisé, Stack: frontier push inc/oct 2024 → stable jusqu'à relocation de runtime [4].
- **Permissivité license** : MIT sans copyleft, composable avec enveloppe Libre AI + classification K3.

**Trade-offs** :

- Écosystème émergent (pas de CRDTjs ou yjs.io équivalent) → implémentation du relay propriétaire inévitable.
- E2EE protocol WIP → dépendance sur loro-protocol/src/*e2ee.rs + revue crypto D4 (non-délégable).

---

## 2. E2EE + Transport — Modèle souverain

### Topologie

```
┌─────────────────────────────────────────────────────────────────┐
│ Trust Domain (groupe session)                                    │
├──────────────┬──────────────┬──────────────────────────────────┤
│ Participant A│ Participant B│ Participant C (facilitateur)     │
│ (local Loro) │ (local Loro) │ (local Loro)                     │
└──────┬───────┴──────┬───────┴───────────────────────────────────┘
       │ Sync(ΔLoro,  │
       │ nonce)       │
       ├─────────────┤ AES-256-GCM(Δ; k_group)
       │             │
       ▼             ▼
┌─────────────────────────────────────────────────────────────────┐
│ Relay (WebSocket, auto-hébergé)                                 │
│ • Reçoit ciphertext uniquement                                  │
│ • Forward (ciphertext, cursor, nonce) → autres membres         │
│ • Aucune déchiffrement, aucune mutation CRDT                   │
└──────────────┬──────────────────────────────────────────────────┘
       │ Broadcast([{id, ct, nonce}])
       │ No plaintext logged
       │
       ├─────────────┬──────────────┬───────────────────────────┐
       │             │              │                           │
       ▼             ▼              ▼                           ▼
     A.recv      B.recv         C.recv             (optionnel)
     (déchiffre) (déchiffre)    (déchiffre)        Archivage chiffré
```

### Échange de clé groupe (découverte → session active)

1. **Initialisation** (facilitateur Sessions) :
   - Biscuit K1 identity inclut `group_session_id` + `participant_ids` (ordonné déterministe).
   - Hash(id + participants) → `group_key_seed` (client).
   - Derive `k_group` via HKDF-SHA256 avec contexte `"collab-group-v1"`.

2. **Partage de clé** (WebSocket JOIN) :
   - Chaque participant envoie `JoinCollab(session_id, participant_id, kex_public_key)`.
   - Relay aggrège, broadcast Kex publics uniquement (zéro clés privées en texte clair).
   - Chaque client dérive `k_group` en parallèle (déterministe) → synchrone, aucun channel d'échange.

3. **Forward Secrecy** (session à session) :
   - Nouvelle clé groupe si participant ajouté/retiré → Biscuit révoqué [5].
   - Les Δ avant révocation restent chiffrés sous l'ancienne clé; après, nouveau `k_group`.

### Transport (WebSocket + P2P optionnel)

- **Défaut : Relay WebSocket** (auto-hébergé, ex. Node/Bun/Rust).
  - Ciphertext forward → aucune logique métier, scalable.
  - Persistence optionnelle : append-only log chiffré (Δ + metadata) pour reconnexion.

- **Optionnel : P2P WebRTC** (Conclave pattern) si trust domain = 2 participants + low-latency.
  - ICE négociation via relay (ciphertext signal).
  - Données directes P2P après connexion établie.

### Intégration Biscuit K1

- Chaque session collab obtient un Biscuit limité :
  ```datalog
  check if session($sid), operation(write), group_key($gk_id);
  attenuate(expires_at = now() + 3600s);
  ```
- Relay **ne reçoit jamais** ce token (client-side decrypt/verify uniquement).
- Revocation : émettre `RevokeGroupKey($sid)` → Biscuit K1 update invalide ancien `gk_id`.

---

## 3. Carte réouverture non-goals

### Sessions : "human approves every shared outcome"

**Spec actuelle** (line 10, 16) :

> « output remains draft until attributable human approval »

**Non-goal réouvert** : RT collab sur **DRAFT state uniquement** (avant synthèse).

- Participants co-éditent document/blocklist → Loro CRDT merge temps réel.
- Synthèse déclenchée → gelé (aucune mutation CRDT).
- Approbation humain → figé (outcome immutable).

**Coexistence** ✓ :

- CRDT reste dans `draft_outcome` (table Sessions) ; chaque checkpoint CRDT = revision numérotée.
- Event log append-only enregistre chaque `LoroCheckpoint(revision, hash)` → traçabilité.
- Humain approuve = figé l'arborescence Loro et le hash, jamais réouvert.
- Audience projection appliquée en exportation, pas en sync RT.

**Invariant préservé** : approbation = gate final, CRDT = espace de travail brouillon.

---

### Notebook : "local-only, collaborative editing forbidden"

**Spec actuelle** (line 23-24, 60-62) :

> « collaborative editing, public publishing or hidden telemetry ; local-only workspace »

**Non-goal réouvert** : RT collab sur **Session d'export partagée** (loin de Notebook lui-même).

- Notebook v1 = local IndexedDB uniquement.
- Nouvelle journey (optionnel v2+) : exporter bloc/collection → Session ouverte → co-éditer → re-importer.
- Import = nouveau bloc local, jamais sync continu vers Notebook source.

**Coexistence** ✓ :

- Notebook core unchanged : local-only, pas de server persistence.
- Collab = dédié Session/relay, hors processus Notebook.
- Relay E2EE garantit zéro ingestion à distance.
- Revocation locale possible (déconnexion Session) sans impacter Notebook.

**Invariant préservé** : local-first, export = rupture consciente, retour = import explicite.

---

### Specifications : "mutating accepted package in place forbidden"

**Spec actuelle** (line 24) :

> « mutating accepted package in place ; accepting a package with unresolved required decisions »

**Non-goal réouvert** : RT collab sur **DRAFT workspace uniquement** (avant gelé/accepted).

- Auteurs + reviewers co-éditent requirements/decisions en temps réel.
- Submit for review → draft figé → phase approbation.
- Accepted = content-addressed immutable (hash K3).

**Coexistence** ✓ :

- CRDT dans `spec_workspace_draft` (table distinct Specifications).
- Accepted package = statique (PostgreSQL, jamais CRDT).
- Transition Draft→Accepted = snapshot Loro hash + persiste.
- Supersede = ligne du lineage, jamais mutate.

**Invariant préservé** : accepted = jamais modifié, draft = collaboratif.

---

## 4. Landing plan — Sessions d'abord

### Brick layer-3 (packages/collab-core)

**Contrat surface** :

```rust
pub trait LoroSyncBrick {
  async fn join_session(session_id: &str, participant_id: &str)
    -> Result<LoroHandle>;
  async fn send_updates(updates: &[LoroUpdate]) -> Result<()>;
  async fn recv_updates() -> Result<Vec<LoroUpdate>>;
  async fn checkout_state() -> Result<Json>;
}
```

**Relay auto-hébergé** : `crates/relay-collab` (Node/Bun/Rust).

- WebSocket server : accept `JoinCollab`, forward ciphertext.
- Persistence layer : LevelDB/RocksDB append-only log (optionnel).
- Health : reconnect cursor tracking, nonce dedup.

### Sessions consumer (apps/sessions)

**Journey : co-édition brouillon**

1. Facilitator `CreateSession` → session draft avec empty Loro doc.
2. Participants `JoinSession` → chacun se connecte relay, reçoit initial state Loro.
3. RT co-edit : chaque mutation locale → sync Loro → relay forward → autres appliquent.
4. `RequestSynthesis` → figé (plus d'updates CRDT reçus), snapshot envoyé provider.
5. `ApproveOutcome` → immutable.

**Spec amendment** :

- Ajouter field `collab_relay_url` à `CreateSession` command.
- Event `LoroCheckpointRecorded(session_id, revision, state_hash)` → append-only log.
- Refusal `sessions.collab_offline` si relay unavailable + fallback HTTP polling.

### Notebook / Specifications (future v2)

- Consomment même `collab-core` brick.
- Notebook : export→Session→re-import (separate journey).
- Specifications : draft workspace + RT review collab (pending acceptance).

---

## 5. Surface d'amendement — Édits spec

### Sessions (docs/apps/sessions.md)

**Avant** (line 27) :

```
**Commands:** `CreateSpace`, `AddMember`, `CreateSession`, ...
```

**Après** :

```
**Commands:** `CreateSpace`, `AddMember`, `CreateSession(audience_policy, collab_relay_url, collab_enabled)`, ...
```

**Avant** (line 33-35) :

```
Authoritative session stream is append-only by tenant/session revision. WebSocket frames carry event cursor and command IDs. Presence is ephemeral and cannot authorize or prove participation.
```

**Après** :

```
Authoritative session stream is append-only by tenant/session revision. WebSocket frames carry event cursor and command IDs. Presence is ephemeral and cannot authorize or prove participation. Draft state CRDT updates are E2EE-synced via relay; every checkpoint is recorded as LoroCheckpointRecorded event (immutable once outcome approved).
```

### Notebook (docs/apps/notebook.md)

**Ajouter nouvelle section (post-line 25)** :

```
## Future v2 : Collaborative export workflows

Notebook v1 remains local-only. A future capability (post-release, ADR TBD) allows exporting selected blocks/context into a Session for real-time co-editing with other users, then re-importing the result as a new local revision. This preserves local-first semantics: the collaboration surface is external (Session/relay), not Notebook core.
```

### Specifications (docs/apps/specifications.md)

**Avant** (line 15) :

```
2. **Specify/review:** author adds requirements, contracts, risk controls and tests; reviewers comment and accept/reject attributable decisions.
```

**Après** :

```
2. **Specify/review:** author adds requirements, contracts, risk controls and tests; reviewers comment and accept/reject attributable decisions. Draft workspace supports optional real-time co-editing via LoroSyncBrick if collab_enabled; once spec submitted for review, CRDT is frozen and review phase uses append-only comment stream only.
```

---

## 6. Gates sécurité & arbitrages ouverts

### D4 : Crypto + Privacy (dual-signature required)

- **Crypto review** : loro-protocol E2EE implementation (HKDF, AES-256-GCM, nonce handling).
  - Acteur : Spécialiste crypto (K4).
  - Artefacts : TLP RFC, test vectors, formal proof sketch (Verifpal/ProVerif si budget).

- **Privacy review** : relay plaintext forgetting (logs policy, persistence, metadata).
  - Acteur : Spécialiste privacy (K4).
  - Artefacts : threat model (relay compromised, state CRDT recovery), audit relay logs null.

### Arbitrages ouverts (owner decision)

1. **Relay default** : Websocket (défaut) vs P2P WebRTC-first ?
   - WS = scalable, facilite persistence, auth.
   - P2P = latency minimal, opaque à infrastructure.

2. **Key rotation policy** : per-session or per-participant granularity ?
   - Per-session = simpler, one `k_group` per session lifetime.
   - Per-participant = finer revocation, complexe key exchange.

3. **Offline-first buffering** : local Loro mutations queue if relay down, apply on reconnect ?
   - ✓ UX fluide, but conflict risk on stale state.
   - ✗ Strict online = simpler, clearer error model.

---

## Références

[1] Loro 1.0 release, Oct 2024 : https://github.com/loro-dev/loro/releases  
[2] Velt CRDT guide (YATA perf) : https://velt.dev/blog/crdt-implementation-guide-conflict-free-apps  
[3] Automerge 2.0 (Rust core) : https://automerge.org/blog/automerge-2/  
[4] Loro E2EE protocol (WIP) : https://loro.dev/ + protocol-e2ee.md in-tree  
[5] Conclave (CRDT + WebRTC + privacy) : https://github.com/conclave-team/conclave  
[6] Biscuit authorization (delegation) : https://doc.biscuitsec.org/  
[7] Signal protocol (GroupCipher) : https://signal.org/docs/specifications/doubleratchet/

---

**Livrable** : Document de design pour signature owner. Aucun code. Prochaine étape : ADR-0011 (D4 gate hardstop).
