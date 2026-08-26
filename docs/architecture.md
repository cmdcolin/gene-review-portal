# How the page is built

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
there is no separate build step to forget. The client bundle is about 200 KB,
68 KB over the wire.

## Staging a lane, and the gap in it

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
