# Review of PR #161 at 5e16fab — negatives gate, misplaced-key detection against GitHub's rendering

- reviewPassId: `pr161-negatives-5e16fab-rendering-2026-10-26`
- Role and mode: `candidate-integration`, review-only, adversarial pass scoped to `tools/quality/check-pr-negatives.ts` and its test. Not a role-specific promotion approval.
- Reviewed head: `5e16fab49cde68d6821c70f0264ad406cefcb8da` (`gh pr view 161 -R libre-ai/project-governance --json headRefOid`)
- Starting point (ADR-0056 D2 re-review rule): the previous round on `a11fc53`; this is a fresh pass over the whole diff `a5cd2b4..5e16fab`
- Served branch at the start: `migrate/recover-code` at `a5cd2b4`; at the end: `ac0d68e` (#155, `skills/pr-body/SKILL.md` only); `git ls-remote --symref https://github.com/libre-ai/project-governance HEAD`
- SHA-256 at the reviewed head:
  - `tools/quality/check-pr-negatives.ts` `cd6e38a5c688b5469a84c2b78ee5076bdcfdef5b583149c1301a96d80fff75b0`
  - `tools/quality/check-pr-negatives.test.ts` `c42d8af1dd504920501794390e47416230081bbc5567cedec18430d80e483040`
  - `tools/quality/pr-negatives.v1.json` (unchanged) `27912c88b3e673b54c85e96aecd24a465267144466eace202dde947d9be2171a`
  - `tools/quality/check-pr-door.ts` (unchanged) `692b9188d52d5c5f57a6f2ece03327ac4673ac8e7919626f472d6d4054b6c758`
- Date: 2026-10-26
- Reviewer: Claude Opus 5.5 (`claude-opus-5-5`), a separate context that did not author the change. Fresh clone, detached checkout, no file of the PR modified at the end (sha256 identical before and after the mutant campaign).

**Verdict: approve-with-minor-reservations.** No finding is blocking or major, and no required evidence is open. The 14 false greens below fall under the header's explicit non-guarantee (`tools/quality/check-pr-negatives.ts:125-126`, `:165`). One sentence of the header is contradicted by GitHub's rendering (F3).

## Instruments

- Second instrument: `gh api -X POST /markdown -f mode=gfm -F text=@<body>`. Note: `-f text=@<body>` sends the literal string `@<path>`; measured, it renders `<p>@/…/t.md</p>`.
- Combined verdict: `evaluateDoor(body, "PR #0 description", null, 2026-10-24)`, then `readNegativesDeclaration(body)`; red when Door fails or the gate refuses.
- Each body is `Door: two-way\nOrigin: proposal\n\n` + probe + `\n`.

## Probes (46 bodies)

"Shown" = GitHub's rendering shows `Not-added:` (or a form the gate's own `NORMALISED_KEY` accepts) at the start of a displayed line.

| Id | Probe (after the block) | GitHub render (excerpt) | Shown | Gate | Agree |
| --- | --- | --- | --- | --- | --- |
| P01 | `[](https://example.com)Not-added: dependency` | `<a href="https://example.com"></a>Not-added:` | yes | green | no, FG |
| P02 | `[]()Not-added: dependency` | `<a href=""></a>Not-added:` | yes | green | no, FG |
| P03 | `![]()Not-added: dependency` | `<a href=""><img src="" alt=""></a>Not-added:` | yes (inferred: an empty img renders nothing) | green | no, FG |
| P04 | `<span` / `title="x">Not-added: dependency` | `<span title="x">Not-added: dependency</span>` | yes | green | no, FG |
| P05 | `Not<span` / `id="a">-added: dependency` | `Not<span id="user-content-a">-added: …` | yes | green | no, FG |
| P06 | `Not<!--` / `-->-added: dependency` | `<p>Not-added: dependency</p>` | yes | green | no, FG |
| P07 | `_Not-added: dependency` / `more_` | `<em>Not-added: dependency<br>more</em>` | yes | green | no, FG |
| P08 | `<div>` / `Not` / `added: dependency` / `</div>` | raw block, lines joined (inferred: browser whitespace collapse) | yes | green | no, FG |
| P09 | `<?x ?>Not-added: dependency` | `Not-added: dependency` | yes | green | no, FG |
| P10 | `<!DOCTYPE x>Not-added: dependency` | `Not-added: dependency` | yes | green | no, FG |
| P11 | `<![CDATA[x]]>Not-added: dependency` | `Not-added: dependency` | yes | green | no, FG |
| P12 | `Not` U+2212 `added: dependency` | `Not−added:` | yes (homoglyph) | green | no, declared |
| P13 | `Not&minus;added: dependency` | `Not−added:` | yes (homoglyph) | green | no, declared |
| P14 | fullwidth `Ｎｏｔ-ａｄｄｅｄ: dependency` | as written | yes (homoglyph) | green | no, declared |
| P15 | `Not-added` U+FF1A ` dependency` | as written | yes (homoglyph) | green | no, declared |
| P16 | `$\phantom{x}$Not-added: dependency` | literal `$\phantom{x}$Not-added:` | unavailable (math rendered client-side) | green | unavailable |
| P17 | table, header cell `Not-added:` | `<th>Not-added:</th>` | yes | green | no, declared |
| P18 | footnote `[^n]: Not-added: dependency` | `<li><p>Not-added: dependency ↩` | yes | green | no, declared |
| P19 | clean fence holding `Not-added: dependency` | `<pre><code>Not-added: dependency` | yes, as code | green | exempt by T3; see F3 |
| P20 | ```` ```Not-added: dependency ```` (info string) | `<pre lang="Not-added:">` | no | red | no, FR |
| P21 | `_Not-added: dependency _` | literal | no | red | no, FR |
| P22 | `Not_-added: see _x_` | `Not_-added: see <em>x</em>` | no | red | no, FR |
| P23 | ``_Not-added: dependency `_` `` | `_Not-added: … <code>_</code>` | no | red | no, FR |
| P24 | `-Not-added: dependency` | literal | no | red | no, FR |
| P25 | `1.Not-added: dependency` | literal | no | red | no, FR |
| P26 | `[ ] Not-added: dependency` | literal `[ ] Not-added:` | no | red | no, FR |
| P27 | `<http://a.example>Not-added: dependency` | link text then key | no | red | no, FR |
| P28 | `&#42;Not-added: dependency` | `*Not-added:` | no | red | no, FR |
| P29 | `\<b>Not-added: dependency` | `&lt;b&gt;Not-added:` | no | red | no, FR |
| P30 | `**Not-added:** dependency` | `<strong>Not-added:</strong>` | yes | red | yes |
| P31 | `> Not-added: dependency` | blockquote | yes | red | yes |
| P32 | `<b></b>Not-added: dependency` | `<b></b>Not-added:` | yes | red | yes |
| P33 | `The Not-added: line is optional.` | prose | no | green | yes |
| P34 | `<!--` / `x --!>` / `Not-added: dependency` / `-->` | key displayed | yes | red (Door T3) | yes |
| P35 | `<details>` / `<summary>Not-added: …</summary>` | summary | yes | red | yes |
| P36 | `<!--` / `x -->Not\-added: dependency` | raw `Not\-added:` | no | red | no, FR |
| P37 | `<!-- a -- b -->Not-added: dependency` | `Not-added:` | yes | red | yes |
| P38 | `    Not-added: dependency` (indented code) | `<pre><code>Not-added:` | yes, as code | red | yes; see F3 |
| P39 | `[](https://example.com "a` / `b")Not-added: dependency` | `<a …></a>Not-added:` | yes | green | no, FG |
| P40 | `x<br>Not-added: dependency` | `x<br>Not-added:` | yes | green | no, declared |
| P41 | `~Not-added:~ dependency` | `<del>Not-added:</del>` | yes | red | yes |
| P42 | `Not&#x2060;-added: dependency` | word joiner, invisible | yes | red | yes |
| P43 | `__Not-added:` / `dependency__` | `<strong>Not-added:<br>dependency</strong>` | yes | green | no, FG |
| P44 | `*Not-added: dependency` / `more*` | `<em>…` | yes | red | yes |
| P45 | `<a name="x"></a>Not-added: dependency` | `<a name="user-content-x"></a>Not-added:` | yes | red | yes |
| P46 | `- [](#x)Not-added: dependency` | `<li><a href="#x"></a>Not-added:` | yes | green | no, FG |

Tally (counted from the table above): agree 12; false green not declared 14 (P01–P11, P39, P43, P46; P03 and P08 rest on an inference about the browser); false green in a declared class 7; code exempted by T3 1 (P19); false red 11; unavailable 1. Total 46.

## Mutants re-run

No-op substitution by Edit, then `bun test tools/quality/check-pr-negatives.test.ts`, then `git checkout -- tools/quality/check-pr-negatives.ts`. Baseline: 296 pass, 0 fail.

| Mutant | Substitution | Result | Probe that turns red |
| --- | --- | --- | --- |
| Y01 | `return [line, visible]` to `return [line]` (`:426`) | killed, 3 fail | minor-1 b7, b9, b14 |
| Y02 | same line to `return [visible]` | killed, 25 fail | point 3, an opener in a code span (and 23 others) |
| Y04 | `inside: stripped.inside` to `stripped.insideClean` (`:391`) | killed, 3 fail | minor-1 b7, b9, b14 |
| Y05 | `--!?>` to `-->` (`:212`) | killed, 1 fail | minor-2 `<!-- a --!>` |
| Y06 | `-?>\|` removed (`:212`) | killed, 2 fail | minor-2 `<!-->`, `<!--->` |
| Y07 / Y12b | `!inBlock(…)` to `true` (`:468`) | killed, 1 fail | minor-3 |
| Y08 | `EDGE_UNDERSCORES` to `/_+/gu` (`:228`) | killed, 1 fail; with the test file of `e357753`: 295 pass, 0 fail (survives) | `not_added: names a snake_case field` |
| Y09 | `>= 2` to `>= 1` (`:233`) | killed, 1 fail | lone `Not_-added` |
| Y10 | edge runs never removed (`:233`) | killed, 5 fail | `__Not-added:__`, `_Not-added:_`, `_Not_-added` |
| Y11 | trailing-edge branch removed (`:228`) | killed, 1 fail | `_Not_-added` |
| Y12 | three exclusions to `true` (`:467`, `:468`, `:470`) | killed, 4 fail | the restored test, "a key hidden in a comment beside a visible one" |
| Y12a | visible-key exclusion alone (`:467`) | killed, 1 fail | "a mention that stays visible in prose" |
| Y12c | left-to-Door exclusion alone (`:470`) | killed, 1 fail | "N4: a key in a comment opened mid-line" |

The claims of the PR body on Y08 and Y12 are confirmed. Sources had the same sha256 before and after the campaign (`shasum -a 256`, compared with `diff`).

## Base merges

- `git diff --stat a5cd2b4 5e16fab`: 2 files, `tools/quality/check-pr-negatives.ts` and `tools/quality/check-pr-negatives.test.ts`, 363 insertions and 63 deletions. Nothing beyond the base.
- `d71fd6e` (parents `e357753`, `0fb4a46`) and `ff203a9` (parents `d71fd6e`, `a5cd2b4`) carry a DCO `Signed-off-by:` trailer. `git log --format=%G? a5cd2b4..5e16fab` gives `N` on all 6 commits: "signed" in the PR body means DCO sign-off, not a cryptographic signature.
- Against the base as it stands at the end of the review, `ac0d68e`: `git merge-tree --write-tree 5e16fab ac0d68e` merges cleanly; #155 touches only `skills/pr-body/SKILL.md`.

## Findings

**F1. minor, suggestion.** `tools/quality/check-pr-negatives.ts:212-214`, `:246-268`: single-line constructs that GitHub renders as nothing before the key are not removed by the normalisation.
- Affected: empty links and images (P01, P02, P03, P46; P39 with a two-line title), and processing instructions, declarations and CDATA (P09, P10, P11).
- P01 and P45 render the same HTML, `<a …></a>Not-added:`, and get opposite verdicts: green for P01, refused for P45.
- Smallest fix: remove `<\?[\s\S]*?\?>`, `<![A-Za-z][^>]*>`, `<!\[CDATA\[[\s\S]*?\]\]>` and `!?\[\]\([^)]*\)` next to `HTML_COMMENT` and `HTML_TAG`, each with a probe and a mutant. Or list them under "does NOT recognise".

**F2. minor, suggestion.** `tools/quality/check-pr-negatives.ts:138-140`, `:149-168`, `:221-234`: constructs that span two source lines produce false greens that the header does not declare.
- Cases:
  - P04, a tag over two lines;
  - P05 and P06, the key split by a multi-line tag or comment (P06 renders exactly `<p>Not-added: dependency</p>`);
  - P08, an HTML block that joins lines;
  - P07 and P43, a `_` or `__` emphasis pair opened on one line and closed on the next.
- The header lists only the reverse case, one source line displayed as two (`<br>`).
- The underscore approximation counts runs per line. `*` is removed anywhere, so the `*` equivalent (P44) is refused while P07 is green.
- "none the reverse" (`:153-154`) holds on the author's 60-body bench. On this round's 46 bodies, 14 undeclared false-green forms are found.
- Fix: declare these forms in the "does NOT recognise" list, or count edge `_` runs over the paragraph (consecutive non-blank lines) instead of the line.

**F3. minor, suggestion (text).** `tools/quality/check-pr-negatives.ts:142-145` and `:409-410` say that a line wholly inside an exempt comment or fence "is not displayed", and that "GitHub hides the rest".
- For a fence this is false: GitHub displays the content in a `<pre>` (P19).
- The behaviour itself follows the ADR-0059 T3 exemption, so the text should say "displayed as code, exempt by T3".
- Related inconsistency: an indented code block is refused (P38) while a fenced one is exempt (P19).

**F4. non-blocking, suggestion.** `tools/quality/check-pr-negatives.ts:464-471`, `:912-913`: on this PR's own body the volume line overstates what is hidden.
- It prints "108 description line(s) = 94 examined + 14 removed in 9 comment/code block(s); 1 line(s) mentioning Not-added inside them ignored".
- The body holds 0 fences, and its GitHub render holds 0 comments: the 9 `<!--` sit in code spans.
- Line 72, displayed prose, is counted as ignored inside a comment.
- The partition is the Door gate's `stripNonDeclarations`, unchanged here; the `ignored` counter of this PR inherits it.
- The verdict is not affected: `displayedForms` judges raw lines inside a comment that is not exempt.

**F5. non-blocking, suggestion.** 11 false reds: P20 to P29 and P36.
- They are mostly `_` runs that do not pair (P21 to P23), markers without the space a list or heading needs (P24, P25), a task box outside a list (P26), and escapes or entities that GitHub shows literally (P28, P29, P36).
- Observed cost: 0. The 60 latest bodies (#92 to #162) replayed through the combined verdict give 4 declared, 56 absent, 0 refused (`gh pr list -R libre-ai/project-governance --state all --limit 60 --json number,body,author`).

**Ready.**
- Mutant claims: confirmed (table above).
- Base merges: clean.
- This PR's own negatives: the gate run end to end (`GITHUB_EVENT_NAME=pull_request`, `GITHUB_BASE_REF=migrate/recover-code`, event built with `jq` from the PR body) passes with 5 assertions; `schema` and `workflow` have 0 contacts over 2 changed paths, and `.ts` files are skipped by extension.

## Residual risks

- A misplaced key built on F1 or F2 is displayed and not refused. Exploiting it does not create a verified negative: only the block at the top declares.
- P03 and P08 rest on browser behaviour that was inferred, not measured.
- P16 (math) is unverified, because the API does not render math.

## CI

13 of 13 checks pass on `head_sha` `5e16fab` (`gh pr checks 161 -R libre-ai/project-governance`; run ids 40306542735, 40307090144 and 40307090119 checked with `gh api …/actions/runs/<id> --jq .head_sha`). Merge state is `BEHIND` (base `ac0d68e`), and the PR merges cleanly. Locally, `bun test` on `check-pr-negatives.test.ts` and `check-pr-door.test.ts` gives 545 pass, 0 fail. The full `bun run check` was not run locally: unavailable.
