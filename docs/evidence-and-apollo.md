# Evidence

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
[Apollo 3](https://github.com/GMOD/Apollo3), and `Export` gains an
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
