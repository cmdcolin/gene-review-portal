# Flags worth knowing

`--help` lists every flag. These are the ones that bite.

- Without `--with-app` the links point at `jbrowse.org/code/jb2/latest`, which
  **cannot read a config on your laptop** — that mode is for data already
  published at a public URL. The CLI says so when it applies.
- `--aliases <file|url>` is a refName alias table, for an annotation that says
  `chr22` over a FASTA that says `22`. Without it every capture fails with
  "unknown reference sequence name", which reads like a bad locus.
- `--height` defaults to 450, which fits the prediction, disagreements and
  reference lanes; a shorter frame cuts the reference off. `--rnaseq` lanes need
  more: `--rnaseq-height 170` inside `--height 920` shows two whole.
- `--max` caps the cards a class, 12 by default. The header counts the flagged
  models it left out, and a review meant to finish the callset wants it raised.
- `--region` restricts the scan, repeatable. A whole mammalian genome is a lot
  of captures; one chromosome is a demo.
- `--hub <name>` and `--reference-track <id>` — see
  [naming an assembly](#naming-an-assembly-instead-of-assembling-one) below.
- `--measurement <prefix>` writes the run's counts as measurement records,
  `<prefix>-classes.json`, `-run.json`, and `-evidence.json` with `--rnaseq`, so
  a tutorial quotes a generated number rather than a typed one.
- **The captures show the latest JBrowse release** unless told otherwise.
  `--app-branch main` bundles the development build, `--app-dir <dir>` a build
  of your own, and `--instance https://jbrowse.org/code/jb2/main/` drives main
  without bundling anything.
- `--question <json>` replaces the question and answers on every card: see
  [Asking your own question](reviewing.md#asking-your-own-question).

## Naming an assembly instead of assembling one

`--hub` takes a published assembly in place of `--fasta` and `--aliases`:

```bash
gene-review-portal --prediction tiberius.gff3 --hub hg38 --region chr22 --out ./portal
```

The name is a UCSC database (`hg38`, `mm39`, `danRer11`) or a GenArk accession
(`GCF_000001405.40`), resolved through
[genomes.jbrowse.org](https://genomes.jbrowse.org). It brings the sequence,
`chrom.sizes`, the chromAlias table as `refNameAliases`, and the cytobands.
`--reference-track` takes the reference from the hub's own annotation:

```bash
gene-review-portal --prediction tiberius.gff3 \
  --hub hg38 --reference-track hg38-gencodeComp --region chr22 --out ./portal
```

`--list-hubs` and `--list-tracks` print one name a line, to grep:

```console
$ gene-review-portal --list-hubs | grep -i zebrafish
  danRer11  Zebrafish — May 2017 (GRCz11/danRer11)

$ gene-review-portal --hub hg38 --list-tracks | grep -i gencode
  hg38-gencodeComp   GENCODE V49 - Comprehensive gene annotation
  hg38-gencodeBasic  GENCODE V49 - Basic gene annotation
```

`--list-tracks` lists annotation tracks only. The portal's config keeps the
track's own adapter, so a CSI index the hub names elsewhere still resolves.
