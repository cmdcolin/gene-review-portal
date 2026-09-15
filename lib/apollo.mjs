import { gzipSync } from 'node:zlib'

// Apollo 3 edits annotations inside JBrowse. Given an assembly that names no
// internet account it stores them in the browser's IndexedDB rather than on a
// collaboration server, so a card can hand a reviewer a working editor with no
// infrastructure behind it. The model travels in the `apolloFeatures` URL
// parameter, which Apollo submits as an AddFeatureChange on load and then
// strips from the address bar.

// Coordinates are already interbase here: readGff subtracts one from the GFF
// start, which is the same origin Apollo counts from.
function snapshot(row, idFor) {
  const parts = {}
  for (const [i, p] of (row.parts ?? []).entries()) {
    const id = idFor(`${p.type.toLowerCase()}_${i}`)
    parts[id] = {
      _id: id,
      refSeq: row.refName,
      type: p.type === 'CDS' ? 'CDS' : 'exon',
      min: p.start,
      max: p.end,
      strand: row.strand === '-' ? -1 : 1,
      ...(p.type === 'CDS' && p.phase !== undefined ? { phase: p.phase } : {}),
    }
  }
  const txId = idFor('transcript')
  return {
    _id: idFor('gene'),
    refSeq: row.refName,
    // "gene" and "transcript", not "mRNA": Apollo's renderer calculates CDS
    // locations only for a transcript or an ontology equivalent, and an mRNA
    // child throws from a mobx reaction on every repaint.
    type: 'gene',
    min: row.start,
    max: row.end,
    strand: row.strand === '-' ? -1 : 1,
    attributes: { gff_id: [row.id], gff_name: [row.id] },
    children: {
      [txId]: {
        _id: txId,
        refSeq: row.refName,
        type: 'transcript',
        min: row.start,
        max: row.end,
        strand: row.strand === '-' ? -1 : 1,
        attributes: { gff_id: [row.id] },
        children: parts,
      },
    },
  }
}

function encode(payload) {
  const b64 = gzipSync(Buffer.from(JSON.stringify(payload))).toString('base64')
  return b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

// Apollo keys the IndexedDB store, the track it adds and this payload by
// assembly NAME, so the name here has to be the one the config declares.
export function apolloFeaturesParam(row, assemblyName) {
  if (!row.parts?.length) {
    return undefined
  }
  const idFor = part => `${row.id}_${part}`.replaceAll(/[^\w]/g, '_')
  return encode({ [assemblyName]: [snapshot(row, idFor)] })
}

// A local Apollo link is an ordinary JBrowse session link plus the payload. It
// carries the config, unlike the collaboration-server form, because there is no
// server holding one.
export function apolloLocalLink({ instance, configUrl, session, features }) {
  const sep = instance.endsWith('/') ? '' : '/'
  const spec = encodeURIComponent(`spec-${JSON.stringify(session)}`)
  const cfg = encodeURIComponent(configUrl)
  const base = `${instance}${sep}?config=${cfg}&session=${spec}`
  return features ? `${base}&apolloFeatures=${features}` : base
}
