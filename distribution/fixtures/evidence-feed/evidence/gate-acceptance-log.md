# Gate acceptance log — fixture

Extrait synthétique reproduisant le format réel du journal, y compris ses cas
limites : plage de dates, caractères hostiles au XML, ligne incomplète.

| Date                                                 | Gate                                               | Verdict                                             | Référence vérifiable      |
| ---------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- | ------------------------- |
| 2026-01-10                                           | G-X — gate simple accentuée                        | ACCEPTÉ                                             | PR #1                     |
| 2026-01-11/12                                        | G-Y — plage & <chevrons> "guillemets" 'apostrophe' | **APPROUVÉ** (périmètre borné) — narratif long omis | PR #2, `docs/adr/0001.md` |
| 2026-01-13 ligne incomplète sans les quatre cellules |
