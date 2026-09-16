# Flags worth knowing

`--help` lists every flag. These are the ones that bite.

- Without `--with-app` the links point at `jbrowse.org/code/jb2/latest`, which
  **cannot read a config on your laptop** — that mode is for data already
  published at a public URL. The CLI says so when it applies.
- `--aliases <file|url>` a refName alias table, for the usual case where the
  annotation says `chr22` and the FASTA says `22`. Without it the assembly loads,
  both tracks open, and every capture fails with "unknown reference sequence
  name", which reads like a bad locus rather than a mismatched config.
- `--height` defaults to 450, which fits the three annotation lanes a card
  stacks — prediction, disagreements, and the reference the model was read
  against. A shorter frame cuts the reference off, and the picture stops saying
  what the model disagrees *with*. `--rnaseq` lanes sit below those and want a
  taller one again: `--rnaseq-height 170` inside `--height 920` shows two whole.
- `--region` restricts the scan, repeatable. A whole mammalian genome is a lot
  of captures; one chromosome is a demo.
- `--hub <name>` and `--reference-track <id>` — see [hubs](hubs.md).
- `--measurement <prefix>` writes the run's counts as measurement records —
  `<prefix>-classes.json`, `-run.json`, and `-evidence.json` when `--rnaseq` is
  given — so a page quotes a generated cell rather than a number somebody typed.
  That is the one that goes stale first: fixing the junction comparison moved
  chr22's structure conflicts from 21 to 3 and took a card the prose named down
  with it.
- **The captures show a release unless you say otherwise.** `jbrowse create`
  installs the latest npm release and `code/jb2/latest` is that same release, so
  a portal showing off work that has not shipped shows the version before it.
  `--app-branch main` bundles the development build instead, `--app-dir <dir>` a
  build you made yourself, and `--instance https://jbrowse.org/code/jb2/main/`
  drives main without bundling anything.
