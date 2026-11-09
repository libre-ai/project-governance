# Review of PR #161 at 6e2311e — negatives gate, paragraph judgement and new removals against GitHub's rendering

- reviewPassId: `pr161-negatives-6e2311e-rendering-2026-10-26`
- Role and mode: `candidate-integration`, review-only, adversarial pass scoped to `tools/quality/check-pr-negatives.ts` and its test. Not a role-specific promotion approval.
- Reviewed head: `6e2311e24cbe36fb665e94c335398689c780cdd0` (`gh pr view 161 -R libre-ai/project-governance --json headRefOid`, the same at the start and at the end of the pass)
- Starting point (ADR-0056 D2 re-review rule): the previous review at `5e16fab`, filed in `2689edc`; this is a fresh pass over the whole diff `4bb0794..6e2311e`
- Served branch: `migrate/recover-code` at `4bb07948c7c62402b37401fe316e9df1ca4135cd`, equal to the PR's base (`git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`)
- SHA-256 at the reviewed head:
  - `tools/quality/check-pr-negatives.ts` `6d8b172998e2542b91f07c64e0f5ad4b813409f0e3c9613d2c8e55caed39d84a`
  - `tools/quality/check-pr-negatives.test.ts` `3101e2baa9f2f5b2ccea702cdc00ccaa2dc0e0a228e9dfb4bc9269f6808c4225`
  - `tools/quality/check-pr-door.ts` (unchanged) `692b9188d52d5c5f57a6f2ece03327ac4673ac8e7919626f472d6d4054b6c758`
  - `tools/quality/pr-negatives.v1.json` (unchanged) `27912c88b3e673b54c85e96aecd24a465267144466eace202dde947d9be2171a`
- Date: 2026-10-26
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`), a separate context that did not author the change. Fresh clone, detached checkout; the sha256 of the four files above were identical before and after the mutant campaign.

**Verdict: approve-with-minor-reservations.**
- No finding is blocking or major, and no required evidence is open.
- The 14 false greens of the previous review are closed.
- 34 new probes find 14 undeclared false greens in the same two classes (F1, F2), on forms next to the ones fixed.
- Two sentences of the new text are contradicted by GitHub's rendering (G3, G4).
- A misplaced key that is not recognised creates no verified negative: only the block at the top declares.

## Instruments

- Second instrument: `gh api -X POST /markdown -f mode=gfm -F text=@<body>`.
- Combined verdict: `evaluateDoor(body, "PR #0 description", null, 2026-10-24)`, then `readNegativesDeclaration(body)`; red when Door fails or the gate refuses.
- Each body is `Door: two-way\nOrigin: proposal\n\n` + probe + `\n`.

## Probes

"Shown" = GitHub's rendering shows `Not-added:` (or a form the gate's `NORMALISED_KEY` accepts) at the start of a displayed line.

### The 46 probes of the review at 5e16fab

The probe bodies are those of the record at `docs/reviews/pr-negatives-161/5e16fab49cde68d6821c70f0264ad406cefcb8da/REVIEW.md`, unchanged.

- At `6e2311e`, P01–P11, P39, P43 and P46 are refused; GitHub shows the key in each.
- The other 32 probes keep their verdict of the previous review.
- Spot-checked renders are unchanged: P01, P06, P07, P08, P09, P19, P21, P43.

Tally, counted from the per-probe verdicts against the previous record's classification: agree 26; false green not declared 0; false green in a declared class 7 (P12–P15, P17, P18, P40); code exempted by T3 1 (P19); false red 11 (P20–P29, P36); unavailable 1 (P16). Total 46. This matches the figures in the gate's header (`tools/quality/check-pr-negatives.ts:168-174`).

### 34 new probes (Q01–Q34)

| Id | Probe (after the block) | GitHub render (excerpt) | Shown | Gate | Agree |
| --- | --- | --- | --- | --- | --- |
| Q01 | `[](https://example.com "a)b")Not-added: dependency` | `<a … title="a)b"></a>Not-added:` | yes | green | no, FG |
| Q02 | `[](https://example.com/x(y))Not-added: dependency` | `<a href="…/x(y)"></a>Not-added:` | yes | green | no, FG |
| Q03 | `[](<https://example.com/a)b>)Not-added: dependency` | `<a href="…/a)b"></a>Not-added:` | yes | green | no, FG |
| Q04 | `[ ](https://example.com)Not-added: dependency` | `<a …> </a>Not-added:` | yes | green | no, FG |
| Q05 | `[![]()](https://example.com)Not-added: dependency` | `<a …><img src="" alt=""></a>Not-added:` | yes (inferred: an empty img renders nothing) | green | no, FG |
| Q06 | `<?a>Not-added: dependency` | `Not-added: dependency` | yes | green | no, FG |
| Q07 | `<?b` / blank / `?>Not-added: dependency` | `Not-added: dependency` | yes | green | no, FG |
| Q08 | `<![CDATA[x` / blank / `]]>Not-added: dependency` | `Not-added: dependency` | yes | green | no, FG |
| Q09 | `<!DOCTYPE` / blank / `x>Not-added: dependency` | `Not-added: dependency` | yes | green | no, FG |
| Q10 | `<span>` / `Not` / `added: dependency` / `</span>` | raw block, lines kept | yes (inferred: browser joins lines) | green | no, FG |
| Q11 | `<a href="https://example.com">` / `Not` / `added: dependency` / `</a>` | raw block, lines kept | yes (inferred) | green | no, FG |
| Q12 | `<center>` / `Not` / `added: dependency` / `</center>` | tag removed, raw lines | yes (inferred) | green | no, FG |
| Q13 | `<menu>` / `Not` / `added: dependency` / `</menu>` | tag removed, raw lines | yes (inferred) | green | no, FG |
| Q14 | `<script>x</script>Not-added: dependency` | `&lt;script&gt;x&lt;/script&gt;Not-added:` | no | green | yes |
| Q15 | `<style>a{}</style>Not-added: dependency` | `&lt;style&gt;…Not-added:` | no | green | yes |
| Q16 | `<div><?a>Not-added: dependency</div>` | `<div>Not-added: dependency</div>` | yes | green | no, FG |
| Q17 | `\[](https://example.com)Not-added: dependency` | `[](` + autolink | no | green | yes |
| Q18 | `` `[](x)`Not-added: dependency `` | `<code>[](x)</code>Not-added:` | no | red | no, FR |
| Q19 | `[](x` / `**Not-added:** dependency)` | `[](x<br><strong>Not-added:</strong>` | yes | red | yes |
| Q20 | `\\[](https://example.com)Not-added: dependency` | `\<a …></a>Not-added:` | no | green | yes |
| Q21 | `<div>[](https://example.com)Not-added: dependency</div>` | `<div>[](https://example.com)Not-added:` | no | red | no, FR |
| Q22 | `_Not-added: dependency` / `- more_` | `<p>_Not-added: dependency</p><ul>…` | no | red | no, FR |
| Q23 | `_Not-added: dependency` / `> more_` | `<p>_Not-added: dependency</p><blockquote>…` | no | red | no, FR |
| Q24 | `> a` / `**Not-added:** dependency` | `<blockquote><p>a<br><strong>Not-added:` | yes | red | yes |
| Q25 | `- a` / `  **Not-added:** dependency` | `<li>a<br><strong>Not-added:` | yes | red | yes |
| Q26 | `**Not-added:** dependency` / `---` | `<h2><strong>Not-added:` | yes | red | yes |
| Q27 | `x\` / `**Not-added:** dependency` | `x<br><strong>Not-added:` | yes | red | yes |
| Q28 | table, key in a body cell | `<td><strong>Not-added:</strong>` | yes | green | no, declared |
| Q29 | `_x` / `**Not-added:**_ dependency` | `<em>x<br><strong>Not-added:</strong></em>` | yes | red | yes |
| Q30 | `<div>` / `prose` / `**Not-added:** dependency` / `</div>` | raw block: `prose **Not-added:**` joined | no | red | no, FR |
| Q31 | `<div>` / `some text` / `Not` / `added: dependency` / `</div>` | raw block, joined after text | no | green | yes |
| Q32 | `<div>` / `Not` / blank / `added: dependency` / `</div>` | `Not` then `<p>added: dependency</p>` | no | green | yes |
| Q33 | `<div>` / `<span>` / `Not` / `added: dependency` / `</span>` / `</div>` | raw block, joined | yes (inferred) | red | yes |
| Q34 | `[x]: https://example.com` / `[](x)Not-added: dependency` | `<a href="x"></a>Not-added:` | yes | red | yes |

Tally (counted from the table above): agree 14; false green not declared 14 (Q01–Q13, Q16; Q05 and Q10–Q13 rest on an inference about the browser); false green in a declared class 1 (Q28); false red 5 (Q18, Q21, Q22, Q23, Q30). Total 34.

## Mutants re-run

No-op substitution by Edit, then `bun test tools/quality/check-pr-negatives.test.ts`, then `git checkout -- tools/quality/check-pr-negatives.ts`. Baseline: 318 pass, 0 fail.

| Mutant | Substitution | Result | Probe that turns red |
| --- | --- | --- | --- |
| Z01 | `.replace(EMPTY_LINK, "")` removed (`:300`) | killed, 5 fail | F1 P01, P02, P03, P46; F2 P39 |
| Z03 | `(?<!\\)` removed from `EMPTY_LINK` (`:245`) | killed, 1 fail | F1 control, an escaped empty link before a dash |
| Z07 | paragraph replaced by `[read.raw[index]]` (`:511`) | killed, 7 fail | F2 P04, P05, P06, P07, P08, P39 |
| Z08 | blank-line stop replaced by `true` (`:525`) | killed, 1 fail | F2 control, a blank line ends the paragraph |
| Z09 | `" "` separator replaced by `"\n"` (`:332`) | killed, 1 fail | F2 P08 |
| Z10 | no cut at the first line break (`:334`) | killed, 2 fail | a line that renders empty does not take the next line's key; a fenced line is ignored |
| Z11 | underscore runs counted on `first` (`:335-338`) | killed, 2 fail | F2 P07, P43 |
| Y01 | `return [paragraph, [visible]]` to `return [paragraph]` (`:512`) | killed, 2 fail | two comments spanning a blank line (`c629cec`) |

Z02, Z04, Z05 and Z06 were not re-run.

## Base merges

- `git diff --stat 4bb0794 6e2311e`: 3 files, `docs/reviews/pr-negatives-161/5e16fab49cde68d6821c70f0264ad406cefcb8da/REVIEW.md`, `tools/quality/check-pr-negatives.ts` and `tools/quality/check-pr-negatives.test.ts`. Nothing beyond the base.
- `d9ef8f8` has parents `2689edc` and `ac0d68e`; `6e2311e` has parents `c629cec` and `4bb0794`. Both carry a DCO `Signed-off-by:` trailer; `git log --format=%G?` gives `N` for both (no cryptographic signature).

## Findings

**G1. minor, suggestion.** `tools/quality/check-pr-negatives.ts:245`: `EMPTY_LINK` ends at the first `)`, and needs `[]` with nothing between the brackets.
- It misses a title holding `)` (Q01), a destination with balanced parentheses (Q02) and an angle destination holding `)` (Q03).
- It misses link text made of white space only (Q04) and a link that wraps an empty image (Q05).
- Smallest fix: parse the destination and title as CommonMark does (balanced parentheses, `<…>`, quoted title), accept white-space-only text, and repeat the removal until nothing changes. Each with a probe and a mutant. Otherwise declare the forms.

**G2. minor, suggestion.** `tools/quality/check-pr-negatives.ts:246`: `PROCESSING_INSTRUCTION` needs `?>`.
- At the start of an HTML block, or inside one (Q06, Q16), the browser reads `<?` as a bogus comment ending at the first `>`. GitHub then shows the key.

**G3. minor, suggestion (code and text).** `tools/quality/check-pr-negatives.ts:519-528`: `paragraphFrom` stops at a blank line.
- CommonMark keeps HTML blocks of types 3, 4 and 5 open across blank lines. A PI, CDATA or declaration over a blank line hides the opener's line and shows the key after its close (Q07, Q08, Q09).
- The `shortcut:` comment says the paragraph "can only refuse more"; Q07–Q09 show it refuses less for these blocks.
- Fix: extend the paragraph to the line holding `?>`, `]]>` or `>` when the first line opens such a block, as `opensRawHtmlBlock` in `check-pr-door.ts` already detects. Or correct the comment and declare the blocks.

**G4. minor, suggestion (code and text).** `tools/quality/check-pr-negatives.ts:149`, `:254`, `:328`, `:332`: the lines are joined by a space only when the first line matches `HTML_BLOCK_OPEN`.
- That pattern holds 38 of the 62 type-6 names of the CommonMark 0.31.2 spec (§4.6, h1–h6 counted separately). The count is inferred from the spec; `center` and `menu` are measured (Q12, Q13).
- It does not cover type-7 blocks: a lone complete tag such as `<span>` or `<a href>` (Q10, Q11).
- The header says "in a type-6 HTML block (`<div>` …) the lines are joined by a space". The join is partial for type 6 and absent for type 7.
- Fix: complete the name list and add the type-7 condition (a complete open or close tag alone on its line, not after a paragraph line), with probes.

**G5. non-blocking, suggestion.** 5 new false reds:
- Q18: an empty link inside a code span is removed;
- Q21: Markdown link syntax inside a raw HTML block is removed;
- Q22, Q23: a `_` pair is counted across a block boundary, a cost the shortcut declares;
- Q30: a key line inside a `<div>` is judged alone, while GitHub joins it to the text before it.
- Observed cost: 0. The 60 latest bodies (#93 to #163) replayed through the combined verdict give 5 declared, 55 absent, 0 refused (`gh pr list -R libre-ai/project-governance --state all --limit 60 --json number,body,author`).

**G6. non-blocking, ready.** The message of `1bc6530` says "8 of 61 bench verdicts and 26 of 46 review probes agree": 8 of 61 differ. The gate's header (`tools/quality/check-pr-negatives.ts:162`) states it correctly. The pushed message is left as is, since rewriting it would take a force push; this record notes the discrepancy.

**Ready.**
- The previous review's F1, F2 and F3: closed on the 46 probes (0 undeclared false green).
- F4: declared in the header, not fixed, as the PR body says.
- Point 3, new removals hiding a displayed key: none found.
  - Q17, Q20 and Q34 are controls in agreement.
  - Q19 stays refused where GitHub shows the key.
  - The only effects are false reds, Q18 and Q21.
  - Inferred from `tools/quality/check-pr-negatives.ts:506-528`: every line is judged on a form that starts at that line, so a removal opened on an earlier line cannot reach it.
- Point 2: lazy continuation (Q24), list continuation (Q25), setext underline (Q26), hard break (Q27) and emphasis closed on the key's line (Q29) all agree. The table (Q28) stays in its declared class.
- Mutants: all 8 re-run are killed by the named probe.
- Base merges: clean.
- This PR's own negatives, gate run end to end on its body and diff: pass, 5 assertions; `schema` and `workflow` have 0 contacts over 3 changed paths.

## Residual risks

- Each round closes the probes it is given. On new probes next to them, 14 undeclared false greens were found at `5e16fab` (46 probes) and 14 again here (34 probes).
- Whether recognition keeps being extended or stops at a declared list is a scope decision for the owner. The header already frames the detection as an aid (`tools/quality/check-pr-negatives.ts:120-126`).
- Q05 and Q10–Q13 rest on browser behaviour that was inferred, not measured.

## CI

- 13 of 13 checks pass (`gh pr checks 161 -R libre-ai/project-governance`).
- The 15 check runs on the head all carry `head_sha` `6e2311e24cbe36fb665e94c335398689c780cdd0` (`gh api repos/libre-ai/project-governance/commits/6e2311e24cbe36fb665e94c335398689c780cdd0/check-runs --jq '[.check_runs[].head_sha]|unique'`).
- `mergeStateStatus` is `CLEAN`.
- Locally, `bun test` on `check-pr-negatives.test.ts` and `check-pr-door.test.ts` gives 567 pass, 0 fail. The full `bun run check` was not run locally: unavailable.
