# Flags worth knowing

- `--no-capture` skips the screenshots. Fast, and the links still work.
- `--region` restricts the scan, repeatable. A whole mammalian genome is a lot
  of captures; one chromosome is a demo.
- `--max` caps candidates per class (default 12).
- `--aliases <file|url>` a refName alias table, for the usual case where the
  annotation says `chr22` and the FASTA says `22`. Without it the assembly loads,
  both tracks open, and every capture fails with "unknown reference sequence
  name", which reads like a bad locus rather than a mismatched config.
- `--hub <name>` and `--reference-track <id>` — see [hubs](hubs.md).
- `--assembly-from <url>` is `--hub` for a config a hub name does not reach.
- `--inline-images` embeds the captures, so the portal is one file.
- Without `--with-app` the links point at `jbrowse.org/code/jb2/latest`, which
  **cannot read a config on your laptop** — that mode is for data already
  published at a public URL. The CLI says so when it applies.
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
