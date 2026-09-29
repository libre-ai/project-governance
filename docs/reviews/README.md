# Review authority during consolidation

AGENT-REVIEW-PROTOCOL.md is restored byte-for-byte from libre-ai/governance
commit 496cd814930d938198d9d487a01e4e9cb80f549d. Its source SHA-256 is
`a7df46b45db98d154db74c7b979b48416f45e8415d8384a259761e1e3bae9f52`.
Contract dossiers in schemas-and-contracts still require this protocol; losing
its destination must not silently remove the specialized review gates.

Historical references to `tools/review/fanout.ts` and `fanout-core.ts` now resolve
in execution-continuity-evaluator. They describe a review runner, not an admitted
Forge execution boundary. Existing main/tag freezes and the owner-selected
recovery admission policy remain effective. The historical protocol does not
authorize bypassing those controls or promoting a candidate contract implicitly.

Final candidate reviews must bind an immutable commit. Earlier reviews of a
working diff provide preliminary findings only, even when content hashes later
match the commit. Review receipts live outside the reviewed authoring commit;
new normative changes require a fresh affected review.
