# Libre AI licensing policy

Libre AI is a multi-licence monorepo. The licence of a file is identified by
its SPDX metadata or by the closest applicable annotation in `REUSE.toml`.
The root `LICENSE` is only a human-readable summary.

## Effective transition and historical grants

This policy applies to the first canonical revision that contains this file and
to subsequent revisions.

Code published before that transition remains available under the licence grant
that accompanied its publication, principally `MIT OR Apache-2.0`. Those grants
are not withdrawn. A recipient may continue to use or fork an historical
revision under its original terms.

The 18 repositories listed in `ecosystem/LEGACY-MANIFEST.yaml` are immutable
archives. Their licensing is frozen at their recorded revision; canonical
future development and the policy below apply only in this monorepo.

## First-party software

| Scope                                                                                                            | Licence      | Rationale                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applications, services, control planes and first-party software by default                                       | `EUPL-1.2`   | Network reciprocity for strategic runtime code                                                                                                                         |
| Strategic engines, including `crates/ecosystem-engine/**`, `crates/notebook-core/**` and `packages/knowledge/**` | `EUPL-1.2`   | Improvements communicated as a service remain available as source                                                                                                      |
| Executable authorization and retention policies under `contracts/authz/**` and `contracts/data/**`               | `EUPL-1.2`   | These files are runtime policy, not merely interoperability contracts                                                                                                  |
| Operational prompts under `prompts/**`                                                                           | `EUPL-1.2`   | They are directly consumed by the canonical engineering workflow                                                                                                       |
| OpenAPI, JSON Schema, WIT, fixtures and other interoperability contracts, except executable policies             | `Apache-2.0` | Broad adoption with an explicit patent grant                                                                                                                           |
| Generated contract types and boundary validators                                                                 | `Apache-2.0` | Friction-bounded reuse across implementations                                                                                                                          |
| Client-facing design/web packages and application templates                                                      | `Apache-2.0` | Adoption and integration boundary                                                                                                                                      |
| Generic quality, migration, qualification and benchmark tooling                                                  | `Apache-2.0` | Reusable technical harnesses                                                                                                                                           |
| Agent skills collection under `skills/**`                                                                        | `Apache-2.0` | Portable adoption artefact meant to be copied into another harness (ADR-0025); each `SKILL.md` also carries an inline SPDX header so the licence travels with the file |

The EUPL grant is made under version 1.2 with the later-version mechanism in
Article 5 of that licence. The SPDX identifier remains `EUPL-1.2`.

`MPL-2.0` is not currently applied to a canonical component. It may be introduced
only by an accepted ADR that demonstrates a concrete need for proprietary
embedding and explicitly accepts that service-only modifications may not be
published. The corresponding licence text and SPDX annotations are added only
when such a component exists.

## Documentation and executable examples

Editorial documentation and first-party project records are licensed under
`CC-BY-4.0`. Normative or executable specifications remain under a software
licence as mapped above. A code sample intended for direct incorporation must
carry its own `Apache-2.0` SPDX annotation instead of relying on the surrounding
document's licence.

## Generated and template output

Generated Libre AI contract types remain `Apache-2.0` and retain their generated
SPDX notice. Applications created from an Apache-licensed template may choose a
project-level licence, while copied template portions continue to carry the
Apache notices required by that licence. No Libre AI trademark right is granted
with generated output.

## Data

There is no repository-wide default licence for real datasets, imported model
outputs or third-party data. Each publishable dataset requires a provenance
record and an explicit licence as described in `DATA-PROVENANCE.md`. Synthetic
contract fixtures are software test material and use `Apache-2.0`.

## Third-party material

Third-party and vendored material retains its upstream copyright and licence.
A parent-directory annotation never overrides a file-level notice or the
specific third-party annotations in `REUSE.toml`. The vendored RustCrypto AES
source remains `MIT OR Apache-2.0`. Aggregated Bun licensing evidence is marked
`LicenseRef-ThirdParty-Notices` and must be read with the notices it contains.

## Trademarks

Software and content licences do not grant rights to the names, logos or marks
of Libre AI. Nominative use is governed by `TRADEMARKS.md`.

## Inbound and outbound policy

This file defines **outbound** licences for Libre AI material. Dependency
allowlists in `deny.toml`, `vision.md` and quality scripts define the separate
**inbound** policy. A compatible outbound licence does not automatically make a
dependency acceptable.

## Contributions

Contributions are accepted under the licence already indicated for each covered
file. Every commit must include a Developer Certificate of Origin 1.1 sign-off,
as described in `CONTRIBUTING.md`. The DCO does not assign copyright and does
not grant a right to proprietary relicensing.

## Machine-readable precedence

1. an SPDX notice in a file or adjacent `.license` file;
2. the closest applicable `REUSE.toml` annotation;
3. the first-party `EUPL-1.2` default declared by the root `REUSE.toml`.

Run `reuse lint` before publication. A new file, dataset, brand asset or imported
material must not be published until this command can identify its copyright
and licence unambiguously.
