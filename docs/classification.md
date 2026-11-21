# How a model gets flagged

| class              | test                                                                          | annotator action        |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------- |
| merged model       | exons hit exons of ≥2 same-strand coding genes that do not overlap each other | split into two models   |
| structure conflict | covers one coding gene, shares none of its splice junctions                   | check exon structure    |
| novel locus        | exons hit nothing annotated                                                   | assess, then create     |
| novel coding       | exons hit only non-coding annotation                                          | assess coding potential |

Everything else is `agrees` and never reaches the page. Each class has its own
color, on its cards' chips and its filter button.

- **Exons, same strand.** The classifier compares a model's exons with
  same-strand genes only, so a gene nested in another's intron (SERPIND1 in
  PI4KA) is no fusion, and readthrough genes (`CHKB-CPT1B`) are left out.
- **`exon`, else `CDS`.** The classifier reads `exon` features and falls back to
  `CDS` per model.
- **Isoform by isoform.** A gene's junctions are read one isoform at a time and
  then unioned, so no junction is counted that no transcript has.

## Where the disagreement is

`data/conflicts.bed` holds one BED6 record per place a model and the reference
differ, named `<transcript>:<what disagrees>`:

```
chr22  21636314  21636431  g13605.t1:donor-1048     0  +
chr22  23977067  23977386  g13682.t1:donor+3025     0  -
chr22  50012765  50018574  g14001.t1:split          0  -
```

| name                           | what it marks                                                     |
| ------------------------------ | ----------------------------------------------------------------- |
| `donor±N`                      | the acceptor matches a reference intron, the donor is N bp off    |
| `acceptor±N`                   | the donor matches, the acceptor is N bp off                       |
| `skips-N-exons`                | the intron swallows N whole reference exons                       |
| `unannotated-pairing`          | both ends are reference splice sites, this pairing of them is not |
| `shifted±N`                    | the intron lies inside a reference intron sharing neither end     |
| `intron-in-exon`               | the intron is cut inside a reference exon                         |
| `novel-intron`                 | no reference intron nearby at all                                 |
| `split`                        | a merged model's cut point: the gap between the genes it joined   |
| `novel-locus` / `novel-coding` | the model's span, having no reference gene to disagree with       |

- **Donor and acceptor follow transcription.** The donor is the intron's 5' end:
  the record's `start` on a `+` model and its `end` on a `-` one, as in the
  minus-strand row above.
- **The Disagreements track.** Every capture and live link shows it as
  **Disagreements**, under the prediction and above the reference, so the
  picture points at the junction and the lane below says what it disagrees
  _with_.
- **It lists models the page leaves out.** A model sharing four of five
  junctions is `agrees` and gets no card, yet its fifth is still an edit. On
  chr22 the BED lists 58 such models.
