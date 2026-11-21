# Evidence

`--rnaseq <bam>` adds an alignments track, repeatable, to every capture and live
link, under the prediction and the reference. A novel locus with reads across
its exons is a candidate gene, and one without them a candidate false positive.

## Apollo

The edit a card asks for, such as **Split into two models**, belongs in an
annotation editor. The portal links to Apollo 3 in one of two ways.

### Without a server

With no internet account in the assembly, Apollo keeps annotations in the
browser's IndexedDB, so nothing needs standing up:

```bash
gene-review-portal … --apollo-local --public-config https://example.org/portal/config.json
```

- Each card's link carries the model, gzipped into Apollo's `apolloFeatures`
  parameter, so the reviewer arrives with it already in the editable track.
- `--public-config` is required: the link carries the config's URL. That config
  loads the Apollo plugin and declares no `internetAccounts`;
  https://jbrowse.org/demos/apollo3/config.json is one to copy.
- **The edits live in that browser alone.** Clearing site data loses them, and
  nothing syncs. **Download GFF3** in the Apollo menu is the durable output.

### Against a collaboration server

```bash
gene-review-portal … --apollo https://apollo.example.org/
```

Every card then carries an **Edit in Apollo** link that opens the same window in
[Apollo 3](https://github.com/GMOD/Apollo3), and `Export` gains an `apollo_url`
column, so a triaged queue hands over as a spreadsheet of links.

- `--apollo-assembly <name>` when Apollo's name for the assembly, from its own
  server, is not `--assembly`.
- `--apollo-track <trackId>` opens Apollo's annotation layer with the view. By
  default the link names no track, because a link naming one the Apollo server's
  config does not declare fails to open at all.
