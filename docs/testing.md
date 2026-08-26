# Test

```bash
pnpm test
```

Regenerates a synthetic genome built to produce one candidate of every class,
then checks the classifier still puts each model where the fixture intends.
Offline, about a second.

It then drives the review page itself in a headless Chrome — the keyboard queue,
the in-place repaint, the progress arithmetic and the TSV round trip, none of
which the offline half can reach. That needs puppeteer; without it the run says
so and stops rather than reporting a page it never opened.

The fixture deliberately contains a small gene inside a big gene's intron **on
the same strand**, which is the case that fails if the comparison reverts to
span overlap. Reverting it is one of the two sabotages this suite is written
against — the other cases survive it.

The second is `TWOFORM`, a gene with two isoforms and a prediction reproducing
the second one exactly. Flatten the gene's exons into one list and that
prediction shares none of the junctions the flattening produces, so a correct
model lands in structure conflict. Every other gene in the fixture has a single
isoform, where flattening and reading per transcript agree — which is why the
fixture missed the bug for as long as it did.

`docs/shoot.mjs` rebuilds the two screenshots in the main README against a
local JBrowse build.
