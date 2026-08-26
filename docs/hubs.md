# Naming an assembly instead of assembling one

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
