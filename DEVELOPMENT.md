# Development

```bash
pnpm install
pnpm test
pnpm lint
pnpm format
```

## Test

Regenerates a synthetic genome built to produce one candidate of every class,
then checks the classifier still puts each model where the fixture intends.
Offline, about a second.

It then drives the review page itself in a headless Chrome — the keyboard queue,
the in-place repaint, the progress arithmetic and the TSV round trip, none of
which the offline half can reach. `pnpm install` brings the puppeteer that needs
and downloads its browser; without it the run says so and stops rather than
reporting a page it never opened.

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

## Screenshots

`docs/shoot.mjs` rebuilds the README's screenshots in light mode:
`docs/review-page.png` from the test fixture against a JBrowse build, and
`docs/review-tiberius.png` from the hosted
[Tiberius demo](https://jbrowse.org/demos/tiberius_review/).

```bash
node docs/shoot.mjs                       # jbrowse create, needs the network
node docs/shoot.mjs <jbrowse-web/build>   # a build you already have
```

`bin/frame-card.mjs` frames a single card out of a built portal — the picture to
hang off an issue or a PR, rather than of the whole page.

## How the page is built

`lib/app.jsx` is a React app, and the portal renders it twice. `renderPage`
builds it to a string with `react-dom/server` when the portal is written, so the
cards, the captures and the prose are in `index.html` before any script runs;
the browser hydrates the same tree to take input. Turn scripting off and the
review page is still a readable, printable document — only judging it stops.

React earns its place on the card list. Filtering used to rebuild the whole list
from a string, which recreated every `<img>` on every keystroke — and with
`--inline-images` each of those carries a quarter-megabyte data URI. Four
keystrokes over 35 cards made 56 of them; keyed reconciliation makes none, with
no hand-written "repaint just this bit" path to keep correct.

esbuild does both bundles at portal-build time, so nothing is checked in and
there is no separate build step to forget. The client bundle is about 200 KB, 68
KB over the wire.

### Staging a lane, and the gap in it

A card's picture and its link have to agree, so anything that says _how_ to draw
a track has to live where both of them read it. That is the track config, which
this pipeline writes: `--rnaseq-height` puts a `LinearAlignmentsDisplay` block
in the evidence track, and a released JBrowse honours it in the capture and in
the live view both.

The two routes that look easier do not work:

- **`displayDefaults`** on a track is the documented spelling and postdates the
  released build — grep a `jbrowse create` bundle for the word and it is not
  there.
- **A session spec's `tracks` are ids**, not objects. Write a track as an object
  to hang settings off and the whole list resolves to nothing: the view opens
  with "No tracks active" and a `Could not resolve identifiers: ,,,` toast.

So what is still missing is per-card staging — sorting, filtering or colouring
one card's evidence differently from another's, which is most of what a review
preset would be. That needs settings in the link, and the link is a spec.
