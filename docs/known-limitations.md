# What this does not do

Frank list, kept here so nobody rediscovers these by being surprised.

- **`--apollo-local` needs a config that loads the Apollo plugin**, and the only
  bundle that works against JBrowse 5 today is built from
  [an open, unreviewed Apollo branch](https://github.com/GMOD/Apollo3/pull/823).
  https://jbrowse.org/demos/apollo3/config.json is one to copy, and it can break
  when that branch moves. Point at a published Apollo release once one
  peer-depends `@jbrowse/core@^5`.
- **Edits made in local Apollo live in one browser.** IndexedDB, scoped to the
  origin serving JBrowse, so nothing syncs between people or machines and
  clearing site data loses them. Apollo's **Download GFF3** is the durable
  output. A review with more than one annotator wants the collaboration server
  and `--apollo`.
- **A card's link carries its model in the URL.** The Tiberius chr22 model, 58
  exon and CDS parts, gzips to a 1,256-byte parameter in a 1,632-byte link. A
  model an order of magnitude larger has not been tried, and nothing here caps
  it or warns.
- **The classifier reads each annotation into memory whole**, decompressing it
  in one go (`readGff`). `--region` is what keeps that bounded, and a
  whole-genome run without one has not been measured.
