# ADR-0054 — Amendment of ADR-0042 for P02 v1: surfaces, server stack, dedicated repository, hosted offer

- **Status:** proposed — merging this pull request is the owner's signature (ADR-0043).
- **Arbitration:** Owner-arbitration: 2026-10-22 — P02 v1 decisions P02-D1 to P02-D13, arbitrated in chat on 2026-10-22 and restated in the decision table of the register (`docs/decisions/DECISION-REGISTER.md`, D81 to D93). The owner's wording is restated, not reinterpreted.
- **Date of drafting:** 2026-10-22
- **Scope:** product P02 (information watch, domain Connaissance) only. It does not change the catalogue, the other products, or the topology rules of other domains.
- **Amends:**
  - ADR-0042 §5 (server stack), for P02 only;
  - ADR-0042 §7 (domain Connaissance: a second product repository dedicated to P02), for that domain only;
  - ADR-0042 §8 (first platform palier), for P02 only: responsive web and PWA, macOS application through a Tauri 2 adapter, browser extension.
  - Explicitly: the hosted offer amends `docs/positioning/non-goals.md` line stating no hosted offer exists. That line is replaced in this pull request; self-hosting and export without lock-in are kept.
- **Invariants:** I-06 amended (Rust admitted as a complete server runtime when a product's ADR decides it). The historical text stays in `docs/decisions/INVARIANTS.md` between quotes, as I-10 and I-25 do.
- **Source:** owner decisions in chat on 2026-10-22. Measured facts are reproducible with the commands listed in the pull request body.

## Context

State measured on 2026-10-22:

- `libre-ai/feed-radar` does not exist (`gh repo view libre-ai/feed-radar` answers that it cannot resolve the repository).
- Its successor `libre-ai/information-feed-filter` is archived (`isArchived: true`). Its scope was moved to `libre-ai/personal-knowledge-workspace`.
- The P02 code lives in `libre-ai/personal-knowledge-workspace`, on the served branch: P02 crates and a Bun API with three routes. It is not a product repository of its own.
- Pull request `libre-ai/personal-knowledge-workspace#23` is a draft, not merged: `+6117 / −33`, 61 files. It adds an isolated parser under `RLIMIT`, items, schedules, quotas, fuzzing and an end-to-end suite. Its body lists open points: an unpublished ADR-0054 in that repository (a different document; this ADR's number belongs to `project-governance` only), a worker that reads schedules of every tenant, no deduplication across jobs, no retention, and a pinned `bun@1.4.0-canary.1` without release.
- The repository has no interface: no Swift file, no web application, no browser extension.

## Decision

### 1. Server stack for P02 (amends ADR-0042 §5, P02-D5)

For P02 the server is Rust in full: axum for the HTTP API, sqlx for data access, PostgreSQL for storage. The API and the worker live in one Cargo workspace. The parser runs as an isolated child process, on every operating system.

ADR-0042 §5 (Bun and PostgreSQL for server products) does not apply to P02. The other server products keep §5 unchanged.

### 2. Dedicated repository in domain Connaissance (amends ADR-0042 §7, P02-D9)

ADR-0042 §7 states that a domain has at most one product repository. For the domain Connaissance only, this amendment admits a second one: `libre-ai/information-watch`, dedicated to P02.

- P02 is carried by the new repository. The domain repository `libre-ai/personal-knowledge-workspace` keeps the other products of the domain (P01 and P03 to P07, as §7 states), and its P02 code becomes a reference.
- The name is proposed in `docs/decisions/LEXICON.md` §15. Its public name is derived by the standard rule (« Libre AI » and the repository name in title case), with no brand exception.
- Creating the repository, its private staging remote and its public exposure are owner acts under I-30 (name and enrolment; private staging remote; public exposure after attestation). None of them is executed by this pull request, and this pull request does not create the repository.

### 3. First palier for P02 (amends ADR-0042 §8, P02-D2, P02-D6, P02-D8, P02-D10, P02-D12, P02-D13)

The first platform palier of P02 is made of three surfaces on the same core and the same API:

- **Responsive web application.** A PWA built with React 19, TypeScript in strict mode and Vite. A typed client is generated from the OpenAPI description. A service worker and IndexedDB give offline reading and search of kept items. The design system is written under EUPL; `@libre-ai/ui` (Apache-2.0, blocked for this use) is not reused.
- **macOS application.** A Tauri 2 adapter: the Rust core and the web front-end run in a WKWebView. The native messaging host, written in Rust, ships with the application. The application never parses feeds: it delegates to the API.
- **Browser extension** for Chrome and Firefox, Manifest V3, no network access. It talks to the native messaging host over stdio.

Proof, per surface:

- **Web:** Playwright on chromium, firefox and webkit, at 360, 768 and 1280 px.
- **macOS:** the application is built and launched on a macOS runner. The check is that `lsof -i -P` shows no listening port, that `codesign --verify --strict` and `spctl --assess` pass, and that a notarised ticket exists for every release candidate. Resident memory must stay within 512 MiB in steady state, a figure fixed before measurement (P02-D12); an overshoot measured at the third milestone is a decision on the surface (native Swift with UniFFI), not a revision of the threshold. The functional path runs under Playwright webkit; a spike of `@wdio/tauri-service` with its `embedded` provider decides whether the full path also runs inside the shell (P02-D13).
- **Extension:** on a real Chrome and a real Firefox.

Mobile devices, Windows and Linux are not part of this palier; they are candidates for a second palier.

### 4. Commercial model of P02 (P02-D1, P02-D7)

- P02 is commercial in two senses: signed and notarised distribution to third parties, and a paid hosted offer for several organizations (P02-D1). The hosted offer amends `docs/positioning/non-goals.md` line stating that no hosted offer exists.
- Plans and quotas are inside the application. Payment is outside it: no payment data, no card data and no payment-provider webhook in the code (P02-D7).
- Hosting of the paid offer on Clever Cloud follows I-07. It is an established convention, not one of the owner decisions above.

## Consequences

- **I-06 amended.** Rust is admitted as a complete server runtime for a product when that product's ADR decides it. Bun fullstack stays the rule for every other product.
- **ADR-0042 §5, §7 and §8 amended** as stated above, for P02 and for the domain Connaissance only.
- **Y4 replaced for P02.** Y4 (worker in Rust, API in Bun) is recorded in the P02 specification, which is not in this repository. P02-D5 replaces it for P02.
- **`libre-ai/personal-knowledge-workspace#23` becomes a donor of reference**, not the base of the new work. This ADR does not close it.
- **No P02 product code starts before this pull request is merged** (P02-D11).
- **Process decisions** (sub-agents on Haiku 5.5, blocking review by a second model family) are recorded in the register only (D84). They are not doctrine amendments.
- **Nothing here creates a repository, changes a ruleset, or executes an owner act.** The inventory entry `libre-ai/information-watch` is declared in `ecosystem/repositories.v1.yaml` before the repository exists; the inventory-drift gate reports presence drift until the owner creates it. That is a known, declared state, recorded in the file.
- **Non-goals updated.** `docs/positioning/non-goals.md` no longer states that no hosted offer exists; it keeps « software that anyone can host, replicate and leave ».

## Invariants

- I-06 amended in `docs/decisions/INVARIANTS.md`; its historical text is kept between quotes.

## Source

- Owner decisions P02-D1 to P02-D13, in chat, 2026-10-22.
- Measured facts: the commands listed in the pull request body, run on 2026-10-22.
