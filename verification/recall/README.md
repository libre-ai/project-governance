# Recall against injected defects

`recall.ts` measures how many known defects an audit instrument finds. Defects
are injected into a copy of a repository beforehand (the injection is not part
of this module); the ground truth lists them, and the score counts how many
each instrument found. The score is deterministic: a defect is identified by a
literal needle, never by a judgement on whether two texts mean the same thing.

```sh
bun verification/recall/recall.ts <truth.tsv> <owner/name> --evidence <state-dir>
bun verification/recall/recall.ts <truth.tsv> <owner/name> --spec <specification.md>
bun verification/recall/recall.ts <truth.tsv> <owner/name> --evidence <state-dir> --spec <specification.md>
```

## Ground truth

A TSV table, header exactly `id	classe	aiguille	détecteur	description`:

| Column | Meaning |
| --- | --- |
| `id` | unique identifier of the defect |
| `classe` | `C` covered by a detector, `U` without a detector |
| `aiguille` | the literal string that identifies the defect |
| `détecteur` | the detector expected to find it, or `-` |
| `description` | free text |

A truth with an unexpected header, a wrong column count, an empty or repeated
identifier, an unknown class, an empty needle (spaces only included), or no
defect at all, is refused (exit 1).

## Instruments

- **Detectors** (`--evidence`): a state directory written by
  `bun ecosystem/fleet-state.ts state` (`state.tsv` and `preuves/`). A defect is
  found when its needle occurs in the proof of the expected detector for this
  repository, or for the whole fleet (a `parc` measure). With `-`, the proof of
  any detector with an integer target counts. The proof of an informative
  detector (target `info`) never counts — a list of things to look at is not a
  detection — and neither does the proof of another repository. In a `parc`
  proof, a line that names another repository of the state (as a whole
  `owner/name`) speaks for that repository and does not count. A proof reached
  through a symbolic link, or that is not a regular file, is an error.
- **Agent** (`--spec`): a Markdown specification, read as GitHub renders it
  (GFM). A defect is found when its needle occurs in a cell of a body row of a
  table in the single section titled `Constats` (ATX `## Constats` or Setext
  title); a table needs no leading pipe. Prose, other sections, a
  `Hors périmètre` section above or inside `Constats`, fenced or indented code
  blocks, HTML blocks (comments included), header rows and the cells a row holds
  beyond the header's count do not count; a pipe inside inline code, or written
  `\|`, stays in its cell. A `Constats` section without any table is an error.

## Output and exit codes

One row per defect (`trouvé`, `RATÉ`, or `—` for an instrument not requested),
then `rappel <repo> : détecteurs x/y · agent x/y` and the same summary per
class. An instrument not requested is absent from the summary, never reported
as zero.

| Code | Meaning |
| --- | --- |
| 0 | scored (missed defects included) |
| 1 | truth, evidence or specification unreadable — including an evidence directory that is absent, a measure the score needs that is in error, exempt or missing, a proof through a symbolic link, or a specification without its `Constats` section or without a table in it: none of these is a missed defect |
| 2 | usage: no `--evidence` nor `--spec`, unknown option, repository not `owner/name` |
