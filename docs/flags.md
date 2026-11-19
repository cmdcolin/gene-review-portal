# Flags worth knowing

`--help` lists every flag. These are the ones that bite.

- Without `--with-app` the links point at `jbrowse.org/code/jb2/latest`, which
  **cannot read a config on your laptop** — that mode is for data already
  published at a public URL. The CLI says so when it applies.
- `--aliases <file|url>` a refName alias table, for the usual case where the
  annotation says `chr22` and the FASTA says `22`. Without it the assembly
  loads, both tracks open, and every capture fails with "unknown reference
  sequence name", which reads like a bad locus rather than a mismatched config.
- `--height` defaults to 450, which fits the three annotation lanes a card
  stacks — prediction, disagreements, and the reference the model was read
  against. A shorter frame cuts the reference off, and the picture stops saying
  what the model disagrees _with_. `--rnaseq` lanes sit below those and want a
  taller one again: `--rnaseq-height 170` inside `--height 920` shows two whole.
- `--region` restricts the scan, repeatable. A whole mammalian genome is a lot
  of captures; one chromosome is a demo.
- `--hub <name>` and `--reference-track <id>` — see
  [naming an assembly](#naming-an-assembly-instead-of-assembling-one) below.
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

## Naming an assembly instead of assembling one

`--fasta` plus `--aliases` builds an assembly out of parts, and a portal built
that way is pinned to whichever FASTA somebody uploaded once. `--hub` names a
published one instead:

```bash
gene-review-portal --prediction tiberius.gff3 --hub hg38 --region chr22 --out ./portal
```

That is a UCSC database name (`hg38`, `mm39`, `danRer11`) or a GenArk accession
(`GCF_000001405.40`) — the same tokens JBrowse itself takes, resolved to
[genomes.jbrowse.org](https://genomes.jbrowse.org) the same way. What arrives
with it is the sequence UCSC actually distributes for that build, its
`chrom.sizes`, the chromAlias table already wired as `refNameAliases`, and the
cytobands, which a hand-built assembly never had.

A hub also publishes annotation, so the reference need not be a URL somebody
pasted either:

```bash
gene-review-portal --prediction tiberius.gff3 \
  --hub hg38 --reference-track hg38-gencodeComp --region chr22 --out ./portal
```

Both names are discoverable from the terminal, and both print one per line
because the answer to "which one is zebrafish" is a grep:

```console
$ gene-review-portal --list-hubs | grep -i zebrafish
  danRer11  Zebrafish — May 2017 (GRCz11/danRer11)

$ gene-review-portal --hub hg38 --list-tracks | grep -i gencode
  hg38-gencodeComp   GENCODE V49 - Comprehensive gene annotation
  hg38-gencodeBasic  GENCODE V49 - Basic gene annotation
```

`--list-tracks` offers annotation tracks only. Most of a hub's several hundred
are signal and variants, and none of those is something to compare gene models
against.

The track's own adapter is what goes into the portal's config, rather than one
rebuilt from its URL: a hub big enough to need a CSI index says where that index
is, and a rebuilt adapter could only assume it sits beside the file.
