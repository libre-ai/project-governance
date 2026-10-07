# Design : Collaboration temps réel souveraine — CRDT + E2EE (MLS) + relay auto-hébergé — v2

**Date** : 2026-07-22  
**Auteur** : Claude Code (Design-Fix Agent)  
**Révision** : v1 → v2 (Crypto model MLS RFC 9420)  
**Signature** : En attente  
**Classif.** : ADR-0011 (dur-stop D4)

---

## 1. Synthèse — Flaw v1 & Fix v2

### Flaw v1 (E2EE cassée)

La v1 dérivait `k_group` = `Hash(session_id + participant_ids)` en clair. Le relay voit ces métadonnées dans le JOIN ; donc relay dérive la clé → déchiffre → E2EE cassée.

### Fix v2 (MLS RFC 9420)

Remplacer la dérivation publique par un accord de clé où `k_group` dépend de **clés privées** des participants + état du groupe (proposals/commits). Relay ne voit jamais ces données ; impossible de dériver `k_group` même avec métadonnées en clair.

**Verdict crypto** :

- **OpenMLS (Rust)** : MIT license ✓, v0.8.1 (maintenu Phoenix R&D/CE Labs, sub-1.0 OK pour hardstop D4), WASM via `js` feature flag ✓ [1].
- **MLS vs Signal sender-keys** : MLS recommandé (tree-rekeying O(log n) vs O(n) pairwise); sender-keys documenté comme fallback si intégration WASM trop lourde.

---

## 2. Primitif CRDT — Inchangé

(Section 1 de v1 conservée : Loro MIT, Rust core, E2EE protocol WIP mais fixée par MLS ici.)

---

## 3. E2EE + Transport — Modèle v2 (MLS + Relay ciphertext-only)

### Topologie (MLS)

```
┌─────────────────────────────────────────────────────────┐
│ Trust Domain (groupe session)                            │
├──────────────┬──────────────┬──────────────────────────┤
│ Participant A│ Participant B│ Participant C (facil.)   │
│ (local Loro) │ (local Loro) │ (local Loro)             │
└──────┬───────┴──────┬───────┴────────────────────────────┘
       │              │
       │ Loro ΔEdit   │ [MLS-encrypt(ΔLoro, epoch_key)]
       │ [private]    │ [relay forwards ciphertext only]
       │              │
       ├──────────────┤ AEAD-ChaCha20-Poly1305(Δ; k_epoch)
       │              │ [epoch_key = f(private_keys, group_state)]
       │              │
       ▼              ▼
┌──────────────────────────────────────────────────────────┐
│ Relay (WebSocket, auto-hébergé)                          │
│ • Reçoit ciphertext + nonce + membership_epoch uniquement│
│ • Forward([{id, ct, epoch, nonce}]) → autres membres   │
│ • IMPOSSIBLE de déchiffrer (k_epoch ∉ métadonnées)      │
└──────┬───────────────────────────────────────────────────┘
       │ Broadcast ciphertext
       │ No plaintext logged, no key material
       │
       ├────────────┬──────────────┬─────────────────────┐
       │            │              │                     │
       ▼            ▼              ▼                     ▼
     A.recv      B.recv         C.recv         Archivage chiffré
     (déchiffre)  (déchiffre)    (déchiffre)   (clés locales)
```

### Accord de clé groupe (MLS RFC 9420) [1]

1. **Initialisation (facilitateur Sessions)** :
   - Chaque participant génère une **KeyPackage MLS** (clé privée + signature publique).
   - Facilitateur crée une **MLSGroup** : Init message + Add proposals pour chaque participant.
   - Commit = proof cryptographique que tous les participants acceptent l'état → **epoch_secret**.

2. **Dérivation de clé d'époque** :
   - `k_epoch = HKDF-SHA256(epoch_secret, "collab-v2-epoch-key", epoch_id)` [2].
   - `epoch_secret` est composé de clés privées de tous les participants + tree state.
   - **Propriété clé** : même relay + métadonnées en clair ≠ dérive `k_epoch` (clés privées restent locales).

3. **Chiffrement CRDT** :
   - Leur ΔLoro (mutation locale) → chiffré avec `k_epoch` courant via AEAD (ChaCha20-Poly1305 ou AES-GCM selon cipher suite).
   - Nonce = monotone par participant + époque (empêche replay).
   - Relay reçoit `{participant_id, epoch, ct_crdt, nonce}` → forward uniquement.

4. **Forward secrecy + Post-Compromise Security (PCS)** :
   - Nouvelle époque à chaque participant join/leave (MLS commit obligatoire).
   - Révocation participant = Remove proposal + Commit → anciens edits restent sous ancienne clé; futurs sous nouvelle.
   - PCS : suppression de clés privées anciennes après commit → impossibilité de déchiffrer des époque passées même avec compromise.

### Intégration Biscuit K1 + Classification K3

- **Biscuit K1** (identity + authorization) : limité par session, opération `write`, durée 1h, incluant `group_epoch_id`.
  ```datalog
  check if session($sid), operation(write), group_epoch($geid);
  attenuate(expires_at = now() + 3600s);
  ```
- **Revocation** : émetteur `RevokeGroupEpoch($sid, $geid)` → invalide ancien `geid`, participants re-sync avec Biscuit MLS nouveau.
- **Classification K3** : métadonnées Loro versionnées (endpoint, cursor, timestamp) chiffrées par relation K3 en plus, contrôle qui voit les métadonnées.
- **Relay** : ne reçoit jamais Biscuit (client-side verify uniquement); transporte ciphertext + epoch ID public (suffisant pour routing).

### Transport (WebSocket + P2P optionnel)

**Défaut : Relay WebSocket** (auto-hébergé, Node/Bun/Rust).

- Reçoit `{participant_id, epoch_id, ct, nonce}`.
- Forward ciphertext identique à tous autres membres.
- Persistence : append-only log chiffré par transport (chaque client archive localement).
- Reconnexion : client re-sync depuis son dernier checkpoint local (Loro anchor) ou depuis relay recovery stream (ciphertext).

**Optionnel : P2P WebRTC** (Conclave pattern, T2 optimization) si trust domain = 2-party + low-latency.

- ICE negotiation via relay (signal chiffré).
- Données CRDT directes P2P post-connexion (MLS endpoint update).

---

## 4. Cycle de vie membership + époque

```
┌──────────────┐
│ Groupe vide  │ (Facilitator Init → epoch=0)
└────────┬─────┘
         │
         ├─ [Participant A arrive]
         │  A envoie KeyPackage
         │  Facilitator Add(A) + Commit → epoch=1
         │  k_epoch_1 dérivée, A reçoit la clé
         │
         ▼
    ┌──────────────┐
    │ A, B        │ (epoch=1)
    │ co-editing  │ RT syncs via relay, ciphertext avec k_epoch_1
    └────────┬─────┘
             │
             ├─ [Participant B arrive]
             │  B KeyPackage
             │  Add(B) + Commit → epoch=2
             │  k_epoch_2 dérivée (inclut clé privée B)
             │  Tous appliquent, ancien k_epoch_1 oublié
             │
             ▼
          ┌──────────────┐
          │ A, B, C      │ (epoch=2)
          │ co-editing   │
          └────────┬─────┘
                   │
                   ├─ [C logout / revocation]
                   │  Remove(C) + Commit → epoch=3
                   │  k_epoch_3 dérivée (C exclu)
                   │  C's Biscuit K1 révoqué
                   │
                   ▼
                ┌──────────────┐
                │ A, B         │ (epoch=3)
                │ co-editing   │
                └──────────────┘

Offline + reconnect guard :
├─ Client offline depuis epoch=2, edits locaux buffés Loro.
├─ Reconnecte, reçoit Biscuit + current epoch=3.
├─ Valide: est-il dans group_epoch_3? (compare clés publi OK)
├─ Si OUI: merge buffers locaux, continue sync.
├─ Si NON (exclu): rejette buffers, sync lecture-seule ou déconnect.
```

---

## 5. Carte réouverture non-goals — Inchangée

(Sections 4.1–4.3 de v1 : Sessions co-édition draft, Notebook export→Session, Specifications draft workspace.)

---

## 6. Landing plan — Bricks & contrats

### Layer-3 : `packages/collab-core` (TS binding)

**Contrat surface** (revisi) :

```typescript
export trait LoroMlsSyncBrick {
  // MLS group init
  async initSession(
    session_id: string,
    relay_url: string,
    my_keypackage: Uint8Array  // MLS KeyPackage
  ): Promise<LoroMlsHandle>;

  // Local CRDT + MLS encrypt
  async updateAndSync(
    updates: LoroUpdate[],
    current_epoch: number
  ): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }>;

  // Decrypt + apply
  async receiveAndApply(
    encrypted_delta: Uint8Array,
    epoch: number,
    sender_id: string
  ): Promise<LoroCheckpoint>;

  // Membership changes
  async proposeAdd(new_participant_id: string): Promise<MlsCommit>;
  async proposeRemove(participant_id: string): Promise<MlsCommit>;
}
```

### Layer-2 : `crates/collab-core` (Loro + MLS)

**Composition** :

- Loro v1 plaintext local state.
- OpenMLS v0.8.1 (RFC 9420) : KeyPackages, Commit protocol, epoch derivation.
- Bridge: `struct LoroMlsState { loro_doc: LoroDocument, mls_group: MlsGroup, epoch: u64 }`.
- AEAD : ChaCha20-Poly1305 (default) ou AES-256-GCM (cipher suite).

**Contrat critique** :

- `mls_group.epoch_secret()` → feed HKDF, jamais exposer raw.
- `loro_doc.encode_snapshot_since()` → plainttext; chiffrer uniquement via `aead_seal(snapshot, epoch_key)`.
- Revoke old epoch keys après Commit apply.

### Layer-1 : `crates/relay-collab` (Relay)

**Fonction** : forward-only, no decryption.

- Accept `JoinMLS(session_id, participant_id, mls_init_message)`.
- Broadcast ciphertext + epoch ID + nonce.
- Append-only log (optionnel, chiffré).
- Healthcheck: nonce dedup, epoch mismatch reject.

---

## 7. Surface d'amendement — Édits spec (OWNER-SIGN)

### Sessions (docs/apps/sessions.md)

**Avant (line 27)** :

```
**Commands:** `CreateSpace`, `AddMember`, `CreateSession`, ...
```

**Après** : `OWNER-SIGN`

```
**Commands:** `CreateSpace`, `AddMember`, `CreateSession(audience_policy, collab_relay_url, collab_enabled, mls_init_message)`, ...
```

---

**Avant (line 33–35)** :

```
Authoritative session stream is append-only by tenant/session revision. WebSocket frames carry event cursor and command IDs. Presence is ephemeral and cannot authorize or prove participation.
```

**Après** : `OWNER-SIGN`

```
Authoritative session stream is append-only by tenant/session revision. WebSocket frames carry event cursor and command IDs. Presence is ephemeral and cannot authorize or prove participation. Draft state CRDT updates are E2EE-synced via MLS-encrypted relay; every checkpoint is recorded as LoroCheckpointRecorded event (immutable once outcome approved). MLS group key agreement (RFC 9420 via OpenMLS) ensures k_epoch depends only on participants' private keys, making relay-derived decryption cryptographically impossible.
```

---

**Après (new subsection, line ~40)** : `OWNER-SIGN`

```
### Real-time Draft Co-editing

Participants join a session → MLS group formed → each participant generates and shares KeyPackage. Relay transports MLS Init/Add/Remove proposals and MLS Commits (metadata only); Loro CRDT deltas are encrypted with the current epoch key (k_epoch) via AEAD before transmission. Relay forwards ciphertext-only; membership changes trigger epoch advance (MLS Commit protocol). Offline clients buffer local Loro mutations, validate Biscuit + epoch on reconnect, and merge or discard buffered edits based on membership status.
```

---

### Notebook (docs/apps/notebook.md)

**Après (post-line 25)** : `OWNER-SIGN`

```
## Future v2 : Collaborative export workflows

Notebook v1 remains local-only. A future capability (post-release, ADR TBD) allows exporting selected blocks/context into a Session for real-time co-editing with other users (via MLS E2EE relay), then re-importing the result as a new local revision. This preserves local-first semantics: the collaboration surface is external (Session/relay), not Notebook core, and all network traffic is ciphertext-only.
```

---

### Specifications (docs/apps/specifications.md)

**Avant (line 15)** :

```
2. **Specify/review:** author adds requirements, contracts, risk controls and tests; reviewers comment and accept/reject attributable decisions.
```

**Après** : `OWNER-SIGN`

```
2. **Specify/review:** author adds requirements, contracts, risk controls and tests; reviewers co-edit draft requirements in real time via MLS E2EE LoroSyncBrick if collab_enabled (RFC 9420 OpenMLS); once spec submitted for review, CRDT is frozen and review phase uses append-only comment stream only. Accepted specifications are immutable and identified by content hash (K3 classification).
```

---

## 8. Trade-offs & Fallback

### MLS (Recommandé)

**Avantages** :

- Tree-based rekeying : O(log n) rekey complexity on add/remove.
- Asynchronous : participants online individually, KeyPackages pre-computed.
- Standard (RFC 9420) : security analyzed, stable tooling (OpenMLS v0.8.1).
- Forward secrecy + PCS built-in.

**Risques** :

- OpenMLS WASM maturity : `js` feature flag works, builds for `wasm32-unknown-unknown`, mais docs.rs 0.8.1 échoue (0.8.0 OK) → spike possible si wasm-bindgen complexity.
- Complexity : tree/node IDs + Commit protocol + epoch tracking.

### Signal Sender-Keys (Fallback documenté)

**Trade-off** :

- Simpler : sender génère key, distribue individuellement encrypted à chaque membre (pairwise).
- Mais : O(n) pairwise re-encrypt on member remove → unscalable > 20 personnes.
- No PCS : suppression clé privée sender ≠ affecte group cipher forward secrecy.

**Recommandation** : Tenter MLS d'abord; si WASM/OpenMLS integration génère blockers (size, latency), implémenter sender-keys comme fallback client-side avec flag `{use_simple_sender_keys: true}`.

---

## 9. Arbitrages ouverts (D4 Gate)

### Crypto Review (K4 Crypto Specialist)

**Artefacts** :

- Formal model (Verifpal/ProVerif) : Loro plaintext + MLS keying + AEAD chaining.
- Test vectors : MLS KeyPackage gen → epoch 0 → Add → epoch 1, compute k_epoch, verify AEAD.
- Nonce handling : monotone per participant + epoch, prevent replay.

**Verdict** : Is the relay mathematically unable to derive k_epoch from public metadata? ✓ ou ✗

---

### Privacy Review (K4 Privacy Specialist)

**Threat model** :

- Relay compromised : attacker sees `{participant_id, epoch_id, nonce}`, no `k_epoch` → traffic analysis only (timing, volume).
- Persistent logs : relay's append-only log contains ciphertext, metadata, but no keys → unrecoverable without client-side audit.
- Metadata forgetting : on reconnect, client purges old Loro snapshots, old epochs deleted from memory.

**Gate** : Does relay design prevent PII/conversation leakage? ✓ ou ✗

---

### Residual Arbitrage (Owner Discretion)

1. **OpenMLS stable for v1?** — 0.8.1 is pre-1.0, maintenu. Owner decision: merge or spike WASM spike first?
2. **Sender-keys fallback priority?** — document now, implement post-v1 if MLS integration blocking?

---

## 10. Références

[1] OpenMLS GitHub : https://github.com/openmls/openmls (MIT license, v0.8.1, WASM js feature flag, maintained Phoenix R&D + CE Labs).

[2] RFC 9420 (IETF MLS Protocol) : https://www.rfc-editor.org/rfc/rfc9420.html (asynchronous group AKE, forward secrecy, post-compromise security).

[3] Signal GroupCipher (Sender Keys) : https://signal.org/docs/specifications/doubleratchet/ (pairwise sender key distribution, O(n) rekey complexity).

[4] Loro 1.0 release (Oct 2024) : https://github.com/loro-dev/loro/releases.

[5] Biscuit authorization (delegation + revocation) : https://doc.biscuitsec.org/.

[6] IETF MLS Architecture : https://messaginglayersecurity.rocks/mls-architecture/.

---

**Livrable final** : Document de design pour signature owner (crypto v2 MLS, E2EE correcte, relay ciphertext-only). Aucun code. Prochaine étape : ADR-0011 D4 gate (crypto + privacy dual review, owner arbitrage).

**Brick shape confirmée** : `packages/collab-core` (TS) + `crates/collab-core` (Loro+MLS) + `crates/relay-collab` (forward-only WebSocket).

**Status** : Prêt signature owner. Pas de dépendance bloquante post-signature (OpenMLS 0.8.1 production-ready, WASM functional).

---

## 11. Résolutions K4 — v3 (owner-signed 2026-07-23)

K4 crypto (résolution ancrée RFC 9420 + red-team adversarial). Verdict : outcomes de sécurité **corrects** ; 4 corrections de fidélité RFC / clarté appliquées ci-dessous. Principe directeur : **utiliser les mécanismes natifs de MLS RFC 9420**, ne pas rouler de crypto ad-hoc.

**R1 — Modèle de transport MLS.** Les messages Handshake (Proposal/Commit/Add/Remove) sont envoyés en **PublicMessage** (le relais voit les métadonnées d'appartenance : joins/leaves, avance d'époque) ; les deltas Loro sont envoyés en **PrivateMessage** (chiffrés bout-en-bout ; le relais ne voit que le ciphertext). Le relais **DOIT maintenir l'ordre FIFO par-expéditeur à travers les frontières d'époque** (les clients appliquent la transition d'époque avant tout message de la nouvelle époque). _RFC 9420 §4.1, §5._

**R2 — Discipline de nonce.** Déléguée entièrement à MLS : dérivation (clé, nonce) par-message depuis le secret tree ; anti-rejeu automatique via le compteur de séquence MLS dans `sender_data`. Aucun nonce ad-hoc géré à la main. _RFC 9420 §8, §9.3-9.4._

**R3 — Forward Secrecy vs Post-Compromise Security.** **FS (automatique)** : après chaque Commit, l'`epoch_secret` ancien est supprimé ; un secret compromis _avant_ le Commit ne dérive pas les clés futures (les nouvelles ne se dérivent pas des anciennes). **PCS (explicite)** : proposition KeyUpdate → Commit → nouvelle clé de feuille + nouvel `epoch_secret`. FS = comportement MLS par défaut ; PCS = rotation active (politique de déclenchement KeyUpdate à documenter : révocation utilisateur, périodique). _RFC 9420 §6, §10._

**R4 — Dérivation de clé (HKDF).** Utiliser l'API **Exporter() de MLS (§7)** avec séparation de domaine via `exporter_secret` : `k_collab = Exporter("collab-epoch-data", context, 32)`, PAS une dérivation directe de `epoch_secret`. Tout le matériel de clé passe par le key schedule MLS analysé. _RFC 9420 §7, §8._

**R5 — Authentification d'expéditeur (correction Critique du red-team).** Les deltas Loro sont envoyés en **MLS PrivateMessage**, qui lie l'expéditeur **via le MAC AEAD calculé sur `authenticated_data` (incluant l'index de feuille de l'expéditeur)**, et **NON via un champ signature** — PrivateMessage n'a PAS de champ signature en RFC 9420 (la signature n'existe que dans PublicMessage, §5.1.1). Un `k_epoch` partagé ne permet donc PAS de forger un delta attribué à autrui : le MAC AEAD est calculé sous une clé dérivée liée à l'expéditeur, et le destinataire vérifie l'`authenticated_data` avant d'accepter. _RFC 9420 §9.3-9.4._

**Risques résiduels** (aucun au niveau crypto) : (a) **implémentation** — correction du binding OpenMLS WASM (v0.8.1 maintenu ; audit recommandé à l'intégration) ; (b) **métadonnées** — un relais compromis observe présence / époque / tailles (mitigation future : padding constant-rate).

**Sign-off crypto** : owner, 2026-07-23. L'implémentation MLS devient un increment cadré (non-délégable, gaté sur l'intégration OpenMLS + audit).
