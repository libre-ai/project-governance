# Prompt — G4/G5 integration and cutover

## Mission

Produce, deploy and switch the global release candidate after reconstruction.

## Sequence

1. integrate all contracts and product journeys ;
2. migrate selected data with backups and rollback ;
3. prove Biscuit, CSRF, RLS, accessibility and load behavior ;
4. configure Clever Cloud Paris/UE only now ;
5. verify logs contain no secrets/PII ;
6. build SBOM, checksums and provenance ;
7. rehearse deployment and rollback ;
8. perform the single cutover ;
9. activate public projections and archive legacy permanently.

## Gate

The release candidate rebuilds from canonical source, runs without legacy repositories, and can be rolled back from recorded artifacts.
