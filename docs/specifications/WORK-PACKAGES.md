# Work-package standard

Every change to a repository of the constellation traces back to an objective of a product requirements document (PRD) through a chain that a gate can read: PRD, criterion, work package, pull request, evidence. This standard fixes the documents that carry the chain, the grammar of each link, and the limit of what the chain proves. It complements section 12 (Work packages) of `SPECIFICATION-STANDARD.md` and does not amend it.

The grammars below are the ones accepted by `tools/quality/prd-model.ts`. The five labelled examples below are read by tests: `criteria-example`, `work-package-table-example`, `maturity-example` and `trailer-example` by `tools/quality/prd-model.test.ts`, and `issue-body-example` by `tools/quality/check-work-package-link.test.ts`; other sentences are checked by the other tests named there (the table header rule, the `Validation :` rule, the section headings and the ladder). A sentence that no test pins is not guaranteed against the parser. Where this document and the parser disagree, the parser is the defect to fix or the sentence is, never both left standing.

## Normative language

- **MUST / MUST NOT**: release-blocking invariant; the gate refuses.
- **SHOULD / SHOULD NOT**: default that requires written evidence to override.
- **MAY**: local choice that cannot alter the chain.
- A document or declaration that cannot be read in full is refused with a named reason. It is never read as "nothing declared".

## Location of the documents

- The PRD is `docs/prd.md` and the requirements specification is `docs/cahier-des-charges.md`, both in the repository they describe, side by side.
- The gate reads the work-package table in the PRD and resolves each `CA-n` in the specification, from the same commit. A work package never cites a criterion of another repository.
- Both files are read with `git` at the cited commit, never through a quota-limited API.
- The parsers read each file as lines of text; how the Markdown renders does not matter (the reviewer of a PRD sees the raw diff). They give no meaning to fences, indented blocks or list items.
- Every raw occurrence of a declaration form, spelled with the characters of the skeleton table and the ASCII confusables listed below, is either read as live or makes the document unreadable, with a reason naming its line; a spelling outside that set is a limit, stated in the last bullet of this section. The three declaration forms are the maturity line, the work-package table (its header and its rows) and the criterion definition; each section below states which lines are read and which are refused. A PRD therefore never quotes a declaration form, not even in a fence, an indented block or a list item: it paraphrases it.
- That invariant can only be held on a closed set of spellings, so the invariant is held by enumerating what a document may contain, not by detecting what it must not. A PRD and a specification are written in a closed alphabet, checked on every character of the file before anything is read. The alphabet is the skeleton table: the tab, a line end (LF, CR LF or a lone CR), the printable ASCII characters, and the code points listed by `SKELETON` in `tools/quality/prd-model.ts`, a hand-written table of 138 entries, each with its skeleton (what a person may read it as: an ASCII letter, a digit, `-`, `.`, `'`, `"`, `/`, `%`, `?`, `,`, a space, or a neutral separator; no entry has the skeleton `|` or `:`). An entry is admitted only when its appearance is that of one skeleton: the precomposed Latin-1 letters of French and `Œ`, `œ`, `Ÿ` (the base letter, `æ` and `œ` two letters, `ß` a `b`), the Latin-1 signs `¡` (an `i`), `¢` (a `c`), `¥` (a `y`), `§` (an `s`), `ª` (an `a`), `°` and `º` (an `o`), `²` `³` `¹` (digits), `¯` (a dash), `×` (an `x`), `´ ¸ ¿ « »`, the typographic punctuation of French (quotes, the dashes `‐ ‑ ‒ – — ― − ⁃` read as `-`, `…` and `⋯` as `.`, `‰`, `⁄`, the no-break, thin and narrow no-break spaces as a space, `‹ ›`), the letterlike and mathematical symbols `№` (`no`), `™` (`tm`), `∈` (an `e`), `∞` (`oo`), `∩` (an `n`), `∪` (a `u`), `⊂ ⊆` (a `c`), `∨` (a `v`), the arrows `← → ↔ ⇐ ⇒ ⇔` and the comparison signs `≈ ≠ ≤ ≥` (neutral), and the shapes, check marks and status emoji `○ ◦ 🔴 🟠 🟡 🟢 🔵` (an `o`), `✓ ✔` (a `v`), `✗ ✘ ❌` (an `x`), `★ ☆ ◆ ▶` (neutral). Removed from the table because their appearance is ambiguous between two skeletons, hence refused: `£` (an `l` or an `e`), `€` (an `e` or a `c`), `©` and `®` (a letter or a circle), `¦` and `‖` (bars or a colon or an `H`), `¬` and `±` (a dash or a plus), `÷` (a colon or a dash), `·` and `•` (a dot or nothing or an `o`), `¨`, `¤`, `¶`, `¼ ½ ¾`, `† ‡`, `∧`, `↑ ↓` (a bar), `▲ ▼ ⚠` (an `A` or a `V`), `■ ▪ ▫ □ ☐ ☑ ☒ ● ✅` (a box, a dot or an `o`), `Ð ð Þ þ`. Prose writes `EUR`, `livres`, `section`, `(c)` instead. One exception: the variation selector U+FE0F directly after an entry of category So (the emoji presentation of that symbol), read as nothing. Everything else is refused naming the line, the column (counted in code points) and the code point with its Unicode category: every other letter (Cyrillic, Greek, the dotless i, the fullwidth letters, the hangul fillers, the modifier letters, `µ`), every other digit, the format characters (Cf: U+00AD, U+200B to U+200F, U+2060, U+FEFF, the bidirectional controls, the zero-width joiner U+200D), the combining marks, every control character except the tab (DEL and the C1 controls included), every other space and separator (U+2000 to U+2008, U+200A, U+2028, U+2029, U+3000), every other punctuation and symbol (the box-drawing bars, the fullwidth forms, `∣`, `∶`, `⎯`, `˗`, `₵`, `℮`, `∘`, `∂`, the braille patterns, every other emoji), the private-use, surrogate and unassigned code points. A test enumerates every code point from U+0080 to U+10FFFF and prints how many the reader admits: exactly the entries of the table; another pins the table entry by entry. Admitting a character is a reviewed edit of that table, with its skeleton, and of that test.
- A PRD holds no HTML. A `<` immediately followed by a letter, `!`, `?` or `/` (a tag, a comment, a declaration, a CDATA section, a processing instruction) and an ampersand followed by a letter and another letter or digit, by a letter and `;`, by `#` and digits or by `#x` and hexadecimal digits (a named or numeric entity, with or without its semicolon, since a browser decodes the legacy ones without it) are refused naming the line and the column. `a < b`, `R&D`, `Q&A` and `a & b` are permitted. The parsers decode nothing and remove nothing; there is no second reading path.
- To decide whether a line holds a declaration form, the parsers read its skeleton; this is the only folding the parsers do, and it folds only characters the alphabet lets through. The structural form of a line is its lower case, every non-ASCII character replaced by its skeleton, `*`, `_`, `~`, backticks and backslashes removed, runs of white space read as one space: the `|` of a table and the `-` of an identifier are read on it. The detection form adds the ASCII confusables of the key words: `rn` and `nn` read as `m`, `cl` as `d`, `vv` as `w`, `0` as `o`, `1`, `i` and `|` as `l`, `b` as `8`, `s` as `5` — only to find a key word or an identifier (`Maturité du document`, the header cells `WP` and `CA`, `WP-<n>`, `CA-<n>`, whose digits are then read as `2` to `9`, `l` or `o`), never to accept anything and never for the `|` that separates the cells of a table. The key words themselves are compared on their own skeleton. Two further readings serve only to refuse: a line holding a no-break, thin or narrow no-break space is read twice, with that space as a space and as nothing, and is refused (`a non-ASCII space inside a declaration form is not read`) when the two readings disagree on whether it is a header, a row or a criterion definition (a thin space inside `CA-1` or `WP-3`); and for a header or a row, a letter standing alone between white space or at an end of the line that a person may read as a bar — `I`, `l`, `1`, `i`, `ì í î ï Ì Í Î Ï`, `¡`, `¹` — is read as `|` in a second detection, so that `I WP I CA-n I …` is a header-like line and `l WP-3 l CA-1 l …` a row outside the table (the `1` of `WP-1` and the `l` of `l'export` stay what they are). The declaration itself is then read on the raw line, which MUST have the strict form, in ASCII where the form says so.
- Line ends may be LF, CRLF or a lone CR; the parsers keep the line numbers of the original text. The text of a file is read once: the alphabet is checked and the skeletons computed one time, and the maturity, the table and the criteria are read on that one reading.
- Faux refusals are accepted: a PRD cannot hold `Array<string>` or `a&b1` in its prose, nor a letter outside Latin-1, nor an emoji outside the table, nor an emoji sequence joined by U+200D; a line that starts, after bullets, numbers or punctuation, with a word whose skeleton reads `CA-<n>` or `WP-<n>` is a declaration form even when it is prose. Every refusal is fail-closed and named; none reads a value.
- Limits the reader states rather than closes. It recognises the label `Maturité du document` only: a paraphrase (`Maturité de ce document`, `maturité du PRD`) is prose, neither read nor refused. It reads a line as a person reads text, not as a renderer lays it out: a level hidden by the length of its line (three hundred spaces before it) is read all the same. A `Validation :` clause inside a struck bold span (`~~**Validation :** x~~`) counts as the clause, since only the character before the word is examined.
- Assumed limit: visual confusion. The reader makes a visual confusion harder, it does not make it impossible. The table is closed by construction for the non-ASCII characters: every admitted one has one declared skeleton, and everything else is refused. It is not closed for the pairs of ASCII characters a person may read as one letter: `rn`, `nn`, `cl`, `vv`, `0`, `1`, `i`, `|`, `b` and `s` are folded above, and that list is not exhaustive (a font may draw other pairs alike). The control is an audit trail, not a security boundary: the reviewer of a pull request reads the raw diff, where a confusable spelling is visible as such.
- This norm is not a PRD: it quotes every declaration form and names HTML constructions in its examples, so read as a PRD it is refused. Its tests hand each labelled example to the parsers alone.
- The PRD in git is the authority. An issue is a projection for visibility and discussion; it MUST NOT hold a scope, a verification command or a status that the PRD does not hold.

## Criteria grammar

A criterion is one bullet of `docs/cahier-des-charges.md`:

- The bullet starts with zero to three spaces, then `-`, `*` or `+` and a space or a tab, optionally followed by bold markers, then `CA-` and decimal digits (`CA-3`, `CA-15`).
- Every line whose first token, on its detection form and after its leading markers, reads `CA-<n>` MUST be a strict criterion bullet; otherwise the document is unreadable, naming the line. The leading markers are every character that is neither a letter nor a digit, and a numbering token (digits, one letter or a roman numeral, with or without a `.` or `)`, before a character that is neither a letter nor a digit), repeated: `1.`, `1)`, `1.2`, `a)`, `iv.` and a task-list box `[ ]` or `[x]` are markers; the token is `ca`, a dash and a digit read as `2` to `9`, `l` or `o`. An indented example bullet, an ordered or lettered item, a quote, a heading, a link, a struck or otherwise emphasised id, a non-ASCII dash of the table, a lower-case `ca-`, a letter glued to the number (`CA-1é`), a letter for the digit (`CA-l`, `CA-O`), a symbol of the table for a letter (`¢A-1`, `Cª-1`) and a table row whose first cell is a `CA-<n>` are therefore refused; so is a definition spelled with a non-ASCII space inside `CA-<n>`. A `CA-<n>` in the middle of a line is not a definition, and a spelling outside the table and the folded confusables is a limit (see "Assumed limit").
- The bullet MUST contain the clause `Validation :` (a colon after the word, optional spaces before it) naming how the criterion is verified. The clause starts a word: only white space, `.`, `,`, `;`, `(`, `*`, `_` or a backtick may precede it, so `Invalidation :`, `Non-Validation :` and `~~Validation :~~` are not the clause. The clause MAY be on an indented continuation line of the same bullet. The parser reads a criterion without it and reports that it has no validation; it does not refuse the document. A work package MUST NOT cite a criterion that has no `Validation :` clause; the gate refuses it.
- A `CA-n` MUST be declared once per document. A second declaration makes the document unreadable. Two spellings of one number (`CA-01` and `CA-1`) are one criterion; the id is kept as written, so a work package cites it as written.
- Numbers are local to a repository. Outside it a criterion is cited by its qualified reference `<owner>/<repo>@<40 hex>:<path>#CA-<n>`; the commit digest is the only integrity mechanism, no second hash is added.
- A strict criterion bullet inside a fence or an indented block is a criterion: the raw text is read.
- A heading is not a criterion, and a table row that starts with a `CA-<n>` is refused. A specification that uses them is migrated to bullets; a traceability table lists the criterion in a cell that is not the first.

```markdown criteria-example
- CA-3 The supervision daemon refuses a command whose signature does not verify. Validation : `cargo test -p work-supervision-daemon --locked refuses_unsigned`
- CA-15 Every refusal carries a stable machine code. Validation : `cargo test -p work-supervision-daemon --locked refusal_codes`
- CA-16 A schema migration can be replayed from an empty store.
  Validation : `cargo test -p work-supervision-daemon --locked migrations`
```

## Work-package table

The PRD holds exactly one table with this header, one row per work package. The table is part of the merged PRD, so a change of scope is a pull request visible on the PRD.

- The header has five cells: `WP`, `CA-n couverts`, `Périmètre (chemins, globs)`, `Vérification (commande)`, `Porte anticipée`. Matching is case-insensitive and ignores backticks; accents MUST be written. The `WP` cell MUST be exactly `WP`: a header such as `WP (id)` is refused. Each of the other four cells only has to begin with its word (`CA-n`, `Périmètre`, `Vérification`, `Porte`), so `Porte anticipée` and `Porte` are both accepted.
- The next line is a separator row whose every cell is one or more dashes, with optional colons (`|-|-|-|-|-|` is accepted). The separator row has as many cells as the header; otherwise the document is unreadable.
- Each following line whose first character, after leading white space (spaces, tabs and the admitted no-break, thin and narrow no-break spaces), is `|` is a row; a closing `|` is optional. The first line that does not start that way ends the table, and the header, the separator and the rows form the block of the table. The header and the rows may be indented.
- The document holds exactly one strict header; any other line that looks like a header makes it unreadable. A line looks like a header when its structural form, or that form with its lone bar-like letters read as `|`, holds a `|` and, the cells cut on that `|` and read on their detection form after their leading markers, one cell's first word is `WP` (not `WP-<digit>`) and one cell's first word is `CA` (a word ends before a character that is not a letter, a digit or `_`): a header without its leading `|`, with bold cells, with a marker before `WP`, with `CA-n` spelled with another dash of the table, or with `I`, `l` or `1` for its bars is refused, naming its line; a header spelled with a non-ASCII space inside `WP` or `CA-n` is refused as well. Two strict headers, wherever they stand (a fence or an indented block included), are refused naming both lines: the parser never picks one of them.
- Every line whose first token, on its detection form and after its leading markers (the markers of the criteria grammar), reads `WP-<n>`, and whose structural form holds a `|` or a lone bar-like letter, MUST be a row of the block of that table; otherwise the document is unreadable, naming the line (a row without its leading `|`, after a blank line that ended the table, quoted, in a list item, linked, struck, written with a non-ASCII dash of the table, with `I`, `l` or `1` for its bars, with `VV` for `W` or with a letter for a digit, is refused; so is a row spelled with a non-ASCII space inside `WP-<n>`). Prose that starts with `WP-<n>` and holds a lone `l`, `I` or `1` somewhere is refused too, a faux refusal accepted; `WP-1 livre l'export` is not, since `l'` is not alone.
- `WP`: `WP-<k>`, where `<k>` is a positive decimal integer of at most nine digits and no leading zero (the grammar of `WP-<k>` in the trailer), unique in the table, optionally in backticks. A row that no trailer could declare (`WP-01`, `WP-0`, `WP-1234567890`) makes the table unreadable, naming the row and its line.
- `CA-n couverts`: one or more `CA-<digits>` separated by commas. The parser does not check that they exist; the gate resolves them in the specification, and a criterion that does not exist is a refusal.
- `Périmètre`: one or more repository-relative paths or globs separated by commas. A comma inside braces does not separate (`src/{a,b}/**` is one entry); braces MUST be balanced. The scope is non-empty. Containment of a changed file in an entry is decided by the gate; authors SHOULD limit themselves to literal paths, `*`, `**` and `{a,b}` alternation. The gate accepts only entries made of the characters `A-Z a-z 0-9 . _ / @ + = , { } * -`, without a leading `/` and without a `..` segment, and refuses any other entry (`!` negation, `[..]`, `?`, `\`, `(..)` and spaces included) rather than guess how to match it. It also refuses a `*` inside braces: braces are for literal alternatives (`src/{a,b}/**` is accepted, `{src/**,lib/**}` is refused), and wildcard alternatives are listed as separate entries. A changed file is inside the scope when it matches at least one entry; matching is case-sensitive, `*` does not cross `/`, `**` (outside braces) does, and dotfiles are matched. An entry that bounds nothing (`**`, `*` or `**/*`) is accepted, since a work package may cover everything, and is flagged: the verdict records `scope unbounded` and the volume line says `scope: unbounded`. Only these three exact forms are detected and flagged; an equivalent entry (for example `**/**`) is not.
- `Vérification`: a non-empty command. It cannot contain `|`: cells are split on it, so a pipe shifts the columns and the row is refused for its cell count. Every backtick of a cell is removed silently before it is read, so a command cannot contain one either: a backtick written in it is lost, not refused.
- `Porte anticipée`: exactly `one-way` or `two-way`.
- A malformed row makes the whole table unreadable: the parser reports the row and its line and returns no partial table. A document without the table, or with a header and no row, is also unreadable.
- One pull request realizes one work package. A work package MAY be realized by several pull requests. A change that spans several work packages is split.

```markdown work-package-table-example
| WP | CA-n couverts | Périmètre (chemins, globs) | Vérification (commande) | Porte anticipée |
| --- | --- | --- | --- | --- |
| `WP-1` | `CA-3`, `CA-15` | `crates/work-supervision-daemon/**` | `cargo test -p work-supervision-daemon --locked` | `two-way` |
| `WP-2` | `CA-16` | `crates/work-supervision-daemon/migrations/**` | `cargo test -p work-supervision-daemon --locked migrations` | `one-way` |
```

The gate compares the diff of a pull request with the `Périmètre` cell of the PRD at the cited commit, never with a text that can be edited outside a pull request.

## Document maturity

A PRD declares its own maturity on one line:

```markdown maturity-example
Maturité du document : décision
```

- The strict line starts with zero to three spaces and an optional list bullet (`-`, `*` or `+`) and bold markers, then `Maturité du document` written with its accent as one character (the alphabet admits no other spelling), then an ASCII colon, then a level of the ladder followed by the end of the line, a space, a tab, `.`, `,`, `;`, `:` or `)`, after which a remark MAY follow (`décision (arbitrage cited in the pull request)`, `décision, arbitrée`). Case is ignored; the level MUST be written with its accents.
- Every line whose detection form mentions `maturité du document` MUST be exactly one strict declaration line; otherwise the document is unreadable, naming the line. A mention split across the lines of a paragraph (a run of consecutive non-empty lines, however many) is refused naming its first and last line. A heading, a bold label (`**Maturité du document** :`), an escaped colon, a dash for the colon, an indentation of four spaces or a tab, a quote, an ordered item, a table cell, a link, two mentions on one line, a mention in prose, a label broken by a line end and a label spelled with a folded confusable or a character of the table (`docurnent`, `docunnent`, `clu`, `d0cument`, `Matur|té`, `do¢ument`, `Mäturité`) are all refused; a label spelled with a character outside the table (`Ma†urité`) is refused by the alphabet; a label spelled with an unlisted ASCII confusable is a limit (see "Assumed limit").
- The line `Maturité :` without `du document` qualifies the observed project, not the document, and is ignored.
- A strict line inside a fence or an indented block is read as a declaration. An absent line, an unknown level, a level followed by anything but the boundary above (`décisionnel`, `décision2`, `décision-rejetée`, `décision/x`, `décision?`, `décision–x`), or several strict lines that disagree, give no maturity; a document with no maturity is not approved. Several strict lines of the same level give that level.

Ladder: `exploration`, `hypothèse`, `proposition`, `décision`, `prototype`, `mise en service`, `industrialisation`, `standardisation`.

The order is the order of maturity. The lowest level from which a PRD is approved is the `approvedFrom` entry of `ecosystem/work-package-policy.v1.yaml`; it is data, not a constant of the gate.

## Approved PRD

A PRD is approved for a pull request when both hold:

1. the commit cited by the work package is an ancestor of the branch the repository serves, the branch being resolved from the remote and never written down;
2. the `Maturité du document :` line of the PRD at that commit carries a level at least equal to `approvedFrom` on the ladder.

No other status and no gated path is introduced. Promoting a PRD is a dedicated pull request that edits the maturity line; its body cites the arbitration given by the owner. The gate does not verify that citation, which is declarative.

## Commit trailer

A pull request declares its work package in a git trailer of its commits: the last paragraph of a commit message, as `git interpret-trailers` reads it. A trailer has no Markdown semantics, which is why the description is not used: the declaration the gate reads is the one that was written. The trailer has one of two forms:

```text
Work-package: <owner>/<repo>#<n> WP-<k>
Exempt: <class>
```

Set it with `git commit --trailer "Work-package: <owner>/<repo>#<n> WP-<k>"`, or with `git commit --trailer "Exempt: <class>"`, on at least one commit of the pull request.

```text trailer-example
feat(daemon): refuse a command whose signature does not verify

Work-package: libre-ai/ai-work-supervision#12 WP-1
Signed-off-by: Example Author <author@users.noreply.github.com>

test(daemon): cover the refusal code

Work-package: libre-ai/ai-work-supervision#12 WP-1
Signed-off-by: Example Author <author@users.noreply.github.com>
```

- `<owner>/<repo>#<n>` is the issue that projects the work package, `WP-<k>` the row of the PRD table. Both MUST agree with the issue body (next section).
- The value of `Work-package:` has one space after the colon and one space between its two parts, and nothing after `WP-<k>`. `<owner>` is a GitHub login, `<repo>` a GitHub repository name, `<n>` is a positive decimal integer without a leading zero, and `<k>` a positive decimal integer of at most nine digits and no leading zero; the table itself refuses a row such as `WP-01`, which no trailer could declare. The value of `Exempt:` is one space and a class name (lowercase letters, digits and hyphens, starting with a letter).
- The historical I-08 check of `.github/workflows/doctrine-governance.yml`, which looks for a `WP-G<phase>-<letter><NN>` reference in the commits of a pull request touching `apps/**`, coexists with the `WP-<k>` grammar and does not concern it.
- The gate collects the declarations of every commit in `base..head`. The range MUST carry exactly one distinct value: at least one commit carries it, and the same value repeated on several commits is fine. Two distinct values, or a `Work-package` and an `Exempt`, is a refusal that names them (at most twenty pairs, the rest counted as `and M more`). A range with no declaration is a refusal, except for the implicit exemption below.
- A `Work-package:` or `Exempt:` line anywhere else in a commit message (in the free body, outside the trailer block) is not a declaration.
- The description of the pull request plays no role in the declaration.
- A pull request with no declaration whose author satisfies the `author` predicate of an exempt class (a bot that writes its own commits) is exempt implicitly in that class, and the verdict says that the exemption is implicit. The implicit exemption is decided by the author of the pull request, not by the author of each commit: a human who pushes to a bot's pull request keeps it (the limit of a shared identity).
- `Exempt:` takes only a class listed in the `exempt` section of `ecosystem/work-package-policy.v1.yaml`. Each class describes one predicate on the pull request itself (its author, the paths it changes, or its title); the gate verifies the predicate and never believes the author's claim. A class that is not listed, or whose predicate is false, is a refusal. The globs of a `paths` predicate obey the grammar of a `Périmètre` entry; a glob outside it (a `*` inside braces, `!`, a `..` segment, an empty entry) is a refusal that names the rule and the glob, and the predicate is not consulted. Adding a class is a reviewed edit of that data file.
- The class `fleet-bump` covers a pull request that moves governance pins and nothing else. Its predicate is `paths`: every changed file is one of the pin surfaces that `tools/fleet/bump-generation.ts` can edit, at the depth where a bump was measured to edit them (workflow files directly under `.github/workflows/`, and `package.json`, `bun.lock`, `project.v1.yaml`, `toolchains/*.json`, `README.md` and `README.fr.md` at the root). A nested file, a `Cargo.toml`, the composition manifest and `AGENTS.md` (which agents read as instructions, and which no measured bump edited) are outside it: such a pull request declares a work package. The class is declared by trailer like any other (`Exempt: fleet-bump`); an author never receives it implicitly. It is tied to no author, branch or title: a rule holds exactly one predicate, so any author can declare it, and the gate only verifies that every changed file is one of the listed paths. The caller workflow of this gate (`.github/workflows/work-package-link.yml`) is inside the class, because a bump edits its pin. A change that also touches a guarded surface is refused under the guarded-surface rule below, whatever the class.
- The existing `Door: one-way` or `Door: two-way` line remains required in the description by its own gate. That line does not trigger the explicit `ready` described below: the one-way trigger is the `Porte anticipée` column of the work package in the PRD.

## Issue body

The issue that projects a work package has a body of two sections, whether it was created by the web form, by `gh issue create` or by the API:

```text
### PRD-ref

<owner>/<repo>@<40 hex>:docs/prd.md

### WP

WP-<k>
```

- The issue body MUST be exactly the text the `work-package` issue form produces, and nothing else: the line `### PRD-ref`, an empty line, the `PRD-ref` value on one line, an empty line, the line `### WP`, an empty line, the `WP` value on one line. Line ends MAY be CRLF, and one final line end MAY follow the `WP` value.
- Anything else makes the body unreadable and the gate refuses it, naming the line or the value at fault: text before, between or after the sections, a third or a repeated section, the sections in another order, a comment, the form's `_No response_`, a value on two lines, a space or a tab at the start or end of a line, a byte order mark or any other invisible character. The gate never reads the body heuristically.
- `PRD-ref` is the repository (`<owner>/<repo>`, the grammar of the trailer), the full commit as 40 lowercase hexadecimal characters, and the path of the PRD, which MUST be exactly `docs/prd.md`. A short, uppercase or symbolic revision is refused.
- `WP` is `WP-<k>`, with the grammar of the trailer, and MUST equal the `WP-<k>` of the trailer.
- The repository of the issue (`<owner>/<repo>` of the trailer) and the repository of the `PRD-ref` MUST belong to the same owner as the repository of the pull request, the owners being compared case-insensitively; the repository name MAY differ. The gate refuses any other owner, before reading the issue for the first and before resolving the commit for the second, naming both owners. A repository that the gate's token cannot read is a named failure, never a pass. A commit that is unreachable or rewritten is a named failure.
- The gate validates the structure of the body itself, because the web form is not the only way to create an issue.
- Nothing else is allowed in the body: scope and verification live in the PRD.

The example below is read by the test `tools/quality/check-work-package-link.test.ts`:

```text issue-body-example
### PRD-ref

libre-ai/ai-work-supervision@0123456789abcdef0123456789abcdef01234567:docs/prd.md

### WP

WP-1
```

## Readiness

- Inside an approved PRD, a work package is ready implicitly. The gate then adds no check, and its volume says that `ready` is implicit and why.
- A guarded surface is a surface of invariant I-17 (`docs/decisions/INVARIANTS.md`), as listed by the guarded paths of the review-evidence gate (`GATED_PATH_PATTERNS` in `tools/quality/check-review-evidence.ts`).
- On a `Work-package` declaration, an explicit owner `ready` is required only when the diff of the pull request touches a guarded surface, or when the work package is `one-way` in the `Porte anticipée` column of the PRD at the cited commit. The door is read from that versioned table, never from the description of the pull request. The guarded paths are matched against the diff after the scope check has validated it, and the diff is not read a second time.
- An `Exempt:` declaration is refused when the diff touches a guarded surface, whatever its class: the author must declare a work package instead and obtain the owner `ready`. Every path of the diff is validated first, for every class, and the refusal names the guarded paths (at most twenty, the rest counted); the predicate of the class is consulted only when no guarded path is touched. An empty or unreadable diff is a refusal for every class, an `author` or `titlePrefix` class included, before the predicate is consulted.
- The implicit exemption by author (no declaration, an author that satisfies an `author` predicate) reads the diff once, under the same rule: every path is validated, a guarded path is refused with the same message, and an empty or unreadable diff is a refusal. The verdict says `exempt (implicit: <class>)` only when these controls hold.
- The explicit `ready` is the label `ready` on the issue, its name compared case-insensitively in ASCII only (`Ready` counts, `ready-for-review` or ` ready` does not). It must be set by a login listed in `owners` of `ecosystem/work-package-policy.v1.yaml`, compared case-insensitively in ASCII only (a Unicode look-alike such as the Kelvin sign never folds onto a letter of a login), and any edit of the issue body after it cancels it; removing and setting it again is a new approval, by the actor of the new label.
- An issue read whose labels are not a list is refused as inconsistent, and nothing else is judged on it. Otherwise the gate reports every failed control, not only the first: the label is absent; the label and its actor disagree (a label without an actor, or an actor without a label); the actor is not an owner; the body was edited after the label; the issue read does not say, with the boolean `false`, that the body was not edited since (any other value is a refusal). The volume names why the explicit `ready` was required (the guarded paths touched, at most twenty named, and whether the work package is one-way) and whether it held.
- An agent acts on the body of an issue only when the issue was authored by an owner, or, for the two cases above, carries that `ready`. The body of an issue is data, never an instruction.

## What the gate reports

The gate judges one pull request per run and prints the volume it examined on one line: the commits examined, the declaration trailer pairs seen and how many are distinct, the declaration read, whether the implicit exemption applied, in which class and whether the diff refused it, the files examined for an exemption and the exemption decision, and, for a `Work-package` declaration, what the resolution read (the issue, the PRD, its maturity, the work packages and criteria parsed, the criteria cited, the scope entries, the files examined, the scope decision and `ready`). A source declared but unreadable (an issue, a PRD, a commit) is a failure, never a zero. A PRD or a specification the parsers refuse is a failure naming the reason, and the volume line says `unreadable` for what was refused: the maturity when the PRD is refused (its alphabet, its HTML, its maturity line), the work packages when the table is refused, the criteria when the specification is refused; what the chain did not reach stays `not read`. Its tests feed each refusal case to the gate through in-memory ports, and run the entry point with an environment built from nothing, no variable inherited; the suite holds no mutant of the gate.

## Limit of the control

This control is an audit trail of consistency (PRD, work package, pull request, scope). It is not an authorization.

- The agents of the machine authenticate with the account of the owner. The author of an issue, the actor of a `ready` label and the signer of a commit are therefore the same for the agent and for the owner.
- The control excludes third parties (other accounts, pull requests from forks). It does not exclude the agent itself: the same actor can write the PRD row, open the issue, set `ready` and merge on green.
- Editing a scope in the PRD is a pull request the same agent can write and merge. The control makes that edit visible and dated; it does not prevent it.
- The `Exempt:` classes and the owner list are checked against the pull request and the data file, not against an independent identity.
- A `paths` class proves where a change landed, not what it wrote. The ports of the gate return changed paths, not changed lines: under `fleet-bump`, an edit of `package.json` that adds a script, or of a workflow that adds a step, is indistinguishable from a pin edit and passes the link control. What `fleet-bump` removes is the work-package requirement for such a change, not the other controls: a pull request already runs the workflow files of its own head, so editing the caller workflow could switch this gate off with or without an exemption. The required checks and the review of the pull request still apply. Upgrade trigger: a port that returns the body of the diff, and a predicate on the shape of the changed lines (a full commit sha replaced by another full commit sha).
- The work package is judged at the commit the issue cites, not at the latest PRD. An issue that cites an older approved commit, where the work package was `two-way`, escapes a later `one-way` door, a reduced scope or a demotion of the PRD: the gate requires the cited commit to be an ancestor of the served branch and the PRD to be approved at that commit, not that commit to be the latest version of the PRD.
- The verdict is taken when the pull request is pushed: the caller workflow prescribed by `reusable-work-package-link.yml` runs on `opened`, `synchronize` and `reopened`. An edit of the issue, or a change of its labels, after a green verdict is seen only at the next run.
- Only a distinct identity for the agents (a dedicated account or token) would lift this limit. Creating it is an act of the owner and is outside this standard.

The control MUST NOT be presented as a security boundary, nor the owner field as an authentication.
