# How a model gets flagged

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

**A gene's junctions are read one isoform at a time and then unioned.** Sorting
every isoform's exons into one list and joining consecutive pairs is the obvious
shortcut, and it invents junctions no transcript has: across RANBP1's 13
isoforms it matched none of Tiberius's five correct junctions. That shortcut was
what 18 of the 21 structure conflicts first reported on human chr22 turned out
to be.

## Where the disagreement is

A capture of a structure conflict shows a plausible-looking model over a stack
of reference isoforms, and nothing says which junction is the one in dispute. So
the classifier also writes down where it looked.

`data/conflicts.bed` is one BED6 record per place a model and the reference
actually differ, named `<transcript>:<what disagrees>`:

```
chr22  21636314  21636431  g13605.t1:donor-1048     0  +
chr22  23977067  23977386  g13682.t1:donor+3025     0  -
chr22  50012765  50018574  g14001.t1:split          0  -
```

| name                           | what it marks                                                     |
| ------------------------------ | ------------------------------------------------------------------ |
| `donor±N`                      | the acceptor matches a reference intron, the donor is N bp off     |
| `acceptor±N`                   | the donor matches, the acceptor is N bp off                        |
| `skips-N-exons`                | the intron swallows N whole reference exons                        |
| `unannotated-pairing`          | both ends are reference splice sites, this pairing of them is not  |
| `shifted±N`                    | the intron lies inside a reference intron sharing neither end      |
| `intron-in-exon`               | the intron is cut inside a reference exon                          |
| `novel-intron`                 | no reference intron nearby at all                                  |
| `split`                        | a merged model's cut point: the gap between the genes it joined    |
| `novel-locus` / `novel-coding` | the model's span, having no reference gene to disagree with        |

**Donor and acceptor are read in the direction of transcription**, not left to
right. The donor is the intron's 5' end, so it is the record's `start` on a `+`
model and its `end` on a `-` one — which is why the row above, on the minus
strand, names the right-hand end. Naming the two sites by coordinate instead
puts every minus-strand edit at the wrong end of its intron.

The same file rides in every capture and every live link as the
**Disagreements** track, directly under the prediction, so the picture points at
the junction rather than leaving a reviewer to find it.

**The BED reaches further than the page does.** Cards exist only for the four
flagged classes, and a model sharing four junctions out of five is filed as
`agrees` and never gets one — while the fifth is still a real splice-site edit.
On chr22 that is 58 models the page cannot show and the BED lists.
