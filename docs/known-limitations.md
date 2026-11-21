# What this does not do

- **`--apollo-local` needs a config that loads the Apollo plugin**, and the only
  bundle that works against JBrowse 5 today is built from
  [an open Apollo branch](https://github.com/GMOD/Apollo3/pull/823), so
  https://jbrowse.org/demos/apollo3/config.json can break when that branch
  moves.
- **Edits made in local Apollo live in one browser**, and clearing site data
  loses them: see [Without a server](evidence-and-apollo.md#without-a-server).
- **A card's Apollo link carries its model in the URL.** A 58-part Tiberius
  model makes a 1,632-byte link. Nothing caps or warns about a much larger one.
- **The classifier reads each annotation into memory whole.** `--region` keeps
  that bounded; a whole-genome run without one has not been measured.
