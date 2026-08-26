# gene-review-portal

Turn a gene prediction, a reference annotation and a genome into a **static
review portal**: a page of the predicted models that disagree with the
reference, each with a JBrowse screenshot of the locus, a verdict, and a link
that opens the same view live.

A gene finder returns tens of thousands of models and no way to tell which are
wrong. Comparing them against an existing annotation sorts the disagreements
into four kinds, and only those need a person.

```bash
gene-review-portal \
  --prediction tiberius.gff3 \
  --reference gencode.v47.gff3 \
  --fasta GRCh38.fa \
  --rnaseq rnaseq.bam \
  --assembly hg38 --region chr22 \
  --with-app --out ./portal

npx serve ./portal
```

Live example, built from the command in
[`demos/`](https://jbrowse.org/demos/tiberius_review/): Tiberius on human
chr22, read against GENCODE 47.

## Install

```bash
pnpm install
```

The one dependency is [`@jbrowse/capture`](https://github.com/GMOD/jbrowse-components/tree/main/products/jbrowse-capture),
which is what knows when a JBrowse has actually finished drawing — the
difference between a directory of screenshots and a directory of pictures of
empty browsers. It is not on npm yet, so `package.json` links it out of a
jbrowse-components checkout beside this one:

```
~/src/jbrowse-components
~/src/gene-review-portal
```

Point the link somewhere else, or drop the dependency and run with
`--no-capture`, which builds the same page with links and no pictures.

Also needed on PATH: `bgzip`, `tabix` and `samtools` (htslib + samtools), plus
the `jbrowse` CLI (`npm i -g @jbrowse/cli`) for `--with-app`.

## What comes out

```
portal/
  index.html      the review page — filters, verdicts, export
  config.json     a JBrowse config naming the data below
  data/           bgzipped and indexed copies of your inputs
  img/            one capture per candidate
  jbrowse/        JBrowse itself, with --with-app
```

Nothing points outside the directory, so `aws s3 sync portal/ s3://…` is the
whole deployment. Verdicts live in the reviewer's browser (`localStorage`);
**Export decisions** writes them out as TSV to hand back to a pipeline.

## How a model gets flagged

| class              | test                                                                          | annotator action        |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------- |
| merged model       | exons hit exons of ≥2 same-strand coding genes that do not overlap each other | split into two models   |
| structure conflict | covers one coding gene, shares none of its splice junctions                   | check exon structure    |
| novel locus        | exons hit nothing annotated                                                   | assess, then create     |
| novel coding       | exons hit only non-coding annotation                                          | assess coding potential |

Everything else is `agrees` and never reaches the page. Each class carries its
own color through the chip, the filter and the card's left stripe, so a card
says which kind of disagreement it is before its label is read.

**The comparison is at exon level, against same-strand genes only.** Span
overlap is the obvious test and it is wrong twice over: a gene nested in
another's intron shares the whole span and no exon, and two overlapping
same-strand genes are a fact about the reference rather than a prediction error.
On real chr22 data the span test called Tiberius's correct PI4KA model a
two-gene fusion, because SERPIND1 sits inside PI4KA's intron. Readthrough genes
(`CHKB-CPT1B`) are excluded for the same reason.

The classifier prefers `exon` features and falls back to `CDS` per model, since
plenty of annotation files carry only one of the two.

## Evidence

`--rnaseq <bam>` adds an alignments track, repeatable. It appears in every
capture and every live link, under the prediction and the reference, which is
what turns "the reference says nothing here" into a judgement: a novel locus
with reads across its exons is a candidate gene, and one without them is a
candidate false positive.

Tiberius has an evidence mode of its own (Nextflow, taking proteins, RNA-Seq and
Iso-Seq) that folds evidence into the prediction. This track is the other half —
the same class of data, kept beside the model rather than inside it, so the
reviewer sees what the call was made against.

## Apollo

The triage is the browser's half. The edit belongs in an annotation editor:
**Split into two models** is not a viewer action.

```bash
gene-review-portal … --apollo https://apollo.example.org/
```

Every card then carries an **Edit in Apollo** link that opens the same window in
[Apollo 3](https://github.com/GMOD/Apollo3), and `Export decisions` gains an
`apollo_url` column, so a triaged queue hands over as a spreadsheet of links.

Two things Apollo names differently:

- `--apollo-assembly <name>` when Apollo's name for the assembly is not
  `--assembly`. Apollo takes its assemblies from its own server, so the two
  namespaces often disagree.
- `--apollo-track <trackId>` to open Apollo's annotation layer with the view.
  **Default is no track**, on purpose: Apollo is a JBrowse plugin, so a link is
  an ordinary session spec, and it adds `apollo_track_<assembly>` from a
  reaction that runs *after* the session is parsed. A link naming a track that
  the Apollo server's config does not itself declare fails to open at all, where
  a link naming none arrives at the right locus and leaves the annotator one
  click from their own layer.

## Test

```bash
pnpm test
```

Regenerates a synthetic genome built to produce one candidate of every class,
then checks the classifier still puts each model where the fixture intends.
Offline, about a second.

The fixture deliberately contains a small gene inside a big gene's intron **on
the same strand**, which is the case that fails if the comparison reverts to
span overlap. Reverting it is the sabotage this suite is written against — the
other cases survive it.

## Flags worth knowing

- `--no-capture` skips the screenshots. Fast, and the links still work.
- `--region` restricts the scan, repeatable. A whole mammalian genome is a lot
  of captures; one chromosome is a demo.
- `--max` caps candidates per class (default 12).
- `--aliases <file|url>` a refName alias table, for the usual case where the
  annotation says `chr22` and the FASTA says `22`. Without it the assembly loads,
  both tracks open, and every capture fails with "unknown reference sequence
  name", which reads like a bad locus rather than a mismatched config.
- `--inline-images` embeds the captures, so the portal is one file.
- Without `--with-app` the links point at `jbrowse.org/code/jb2/latest`, which
  **cannot read a config on your laptop** — that mode is for data already
  published at a public URL. The CLI says so when it applies.

## Known gap

`jbrowse.org/code/jb2/latest` silently drops a track entry's inline display
settings, so the staged recipe is bare trackIds and every track arrives at its
default. Verified: `height: 400` on a track renders at the default height. Once
that lands, the recipe can also say _how_ to show the evidence — sorted,
filtered, coloured — which is most of what a review preset is for.

## License

Apache-2.0. Extracted from
[jbrowse-components](https://github.com/GMOD/jbrowse-components), where it lives
as `demo/tiberius-portal`.
