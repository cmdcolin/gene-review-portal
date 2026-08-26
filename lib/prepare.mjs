import { execFileSync } from 'node:child_process'
// Turn the caller's files into a static data directory JBrowse can read over
// plain HTTP, and write the config.json that names them.
import fs from 'node:fs'
import path from 'node:path'

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })

function have(cmd) {
  try {
    run('sh', ['-c', `command -v ${cmd}`])
    return true
  } catch {
    return false
  }
}

// All three, always: bgzip and tabix index the annotations, and samtools faidx
// the FASTA whether or not there is a BAM to go with it.
export function checkTools() {
  const missing = ['bgzip', 'tabix', 'samtools'].filter(c => !have(c))
  if (missing.length) {
    throw new Error(
      `missing required tools: ${missing.join(', ')}. ` +
        'Install htslib (bgzip, tabix) and samtools.',
    )
  }
}

const isGz = f => f.endsWith('.gz')

export const isUrl = s => /^https?:\/\//.test(s)

const reachable = async url => {
  try {
    // a range rather than HEAD: S3 and hgdownload both answer one, and not
    // every server in front of a genome file answers the other
    const res = await fetch(url, { headers: { range: 'bytes=0-0' } })
    return res.ok
  } catch {
    return false
  }
}

// Which index sits beside a tabix file. `uri` on its own means `.tbi` to
// JBrowse, so a CSI-indexed reference — which is what a GENCODE big enough to
// need one carries — loads as a track that fetches a 404 and draws nothing.
export async function usesCsi(ref, dir) {
  if (isUrl(ref)) {
    return !(await reachable(`${ref}.tbi`)) && (await reachable(`${ref}.csi`))
  }
  const local = path.join(dir, ref)
  return !fs.existsSync(`${local}.tbi`) && fs.existsSync(`${local}.csi`)
}

// A UCSC database name (hg38, mm39, ...) maps to /ucsc/<db>/; a GenArk
// accession fans its nine digits out into a three-level tree. Same mapping
// core's fetchHub uses, so a name that works in JBrowse works here.
const HUB_HOST = 'https://jbrowse.org'
const HUB_LIST = `${HUB_HOST}/ucsc/list.json`

export function hubUrl(hub) {
  const genark = /^(GC[AF])_(\d{3})(\d{3})(\d{3})/.exec(hub)
  return genark
    ? `${HUB_HOST}/hubs/genark/${genark[1]}/${genark[2]}/${genark[3]}/${genark[4]}/${hub}/config.json`
    : `${HUB_HOST}/ucsc/${hub}/config.json`
}

// A hub config is a published, maintained assembly: the sequence UCSC actually
// distributes for that build, its chrom.sizes, and the alias table already
// wired to it. Taking one whole beats rebuilding an assembly out of --fasta and
// --aliases, which is how a portal ends up pinned to whichever FASTA somebody
// uploaded once and never touched again.
export async function fetchHubConfig({ hub, assemblyFrom }) {
  const url = hub ? hubUrl(hub) : assemblyFrom
  const flag = hub ? `--hub ${hub}` : `--assembly-from ${assemblyFrom}`
  const res = await fetch(url).catch(e => {
    throw new Error(`${flag}: ${e.message} (${url})`)
  })
  if (!res.ok) {
    throw new Error(
      `${flag}: HTTP ${res.status} from ${url}.` +
        (hub ? ' See https://genomes.jbrowse.org for the names.' : ''),
    )
  }
  const config = resolveUris(await res.json(), url)
  if (!config.assemblies?.[0]?.name) {
    throw new Error(`${flag}: no named assembly in ${url}`)
  }
  return config
}

// The assembly names to give --hub. A thousand of them, one per line, because
// the answer to "which one is zebrafish" is a grep rather than a pager.
export async function listHubs() {
  const res = await fetch(HUB_LIST)
  if (!res.ok) {
    throw new Error(`--list-hubs: HTTP ${res.status} from ${HUB_LIST}`)
  }
  const genomes = (await res.json()).ucscGenomes ?? {}
  const names = Object.keys(genomes).sort()
  const pad = Math.max(...names.map(n => n.length))
  return names
    .map(n =>
      `  ${n.padEnd(pad)}  ${[genomes[n].organism, genomes[n].description]
        .filter(Boolean)
        .join(' — ')}`.trimEnd(),
    )
    .join('\n')
}

// A reference annotation the hub already publishes, so --reference does not
// have to be a URL somebody pasted. Feature tracks only: the rest of a hub's
// 600 are signal and variants, and none of them is something to compare gene
// models against.
const isAnnotation = t =>
  t.type === 'FeatureTrack' && /Gff3Tabix|Gtf|BedTabix/.test(t.adapter?.type)

export function hubTracks(config) {
  const tracks = (config.tracks ?? []).filter(isAnnotation)
  const pad = Math.max(0, ...tracks.map(t => t.trackId.length))
  return tracks
    .map(t => `  ${t.trackId.padEnd(pad)}  ${t.name ?? ''}`.trimEnd())
    .join('\n')
}

// A hub writes an adapter either way round: the `uri` shorthand, or the long
// form with a *GzLocation and an explicit index. The classifier needs the file
// itself, so dig the one out of the other.
const dataUri = adapter =>
  adapter?.uri ??
  Object.entries(adapter ?? {}).find(([k]) => k.endsWith('GzLocation'))?.[1]
    ?.uri

export function trackFromHub(config, trackId) {
  const hit = (config.tracks ?? []).find(t => t.trackId === trackId)
  if (!hit) {
    throw new Error(
      `--reference-track ${trackId}: no such track. List them with --list-tracks.`,
    )
  }
  const uri = dataUri(hit.adapter)
  if (!uri) {
    throw new Error(
      `--reference-track ${trackId} is a ${hit.adapter?.type ?? 'track'}, which names no single file to read.`,
    )
  }
  // The hub's own adapter goes into the config rather than one rebuilt from the
  // uri: it already says where its index is, which a rebuilt one can only
  // assume sits adjacent.
  return { uri, name: hit.name ?? trackId, adapter: hit.adapter }
}

// A hub names its files relative to its own config, and the portal's config.json
// is published somewhere else entirely — so every one of them has to be made
// absolute on the way in or the assembly loads against the wrong origin.
// `chromSizes` is a URI too, it just is not spelled `uri`.
const URI_KEYS = new Set(['uri', 'chromSizes'])

// `metadata` is UCSC's own bookkeeping — twoBitPath, chromAlias.bb, htmlPath —
// carried through for description, not read for data. It is full of things
// shaped like relative paths, and rewriting them would publish a config whose
// metadata no longer says what the hub's does.
function resolveUris(node, base) {
  if (Array.isArray(node)) {
    return node.map(v => resolveUris(v, base))
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [
        k,
        k === 'metadata'
          ? v
          : URI_KEYS.has(k) && typeof v === 'string'
            ? new URL(v, base).href
            : resolveUris(v, base),
      ]),
    )
  }
  return node
}

// Pull just the regions the portal covers out of a remote tabix-indexed file,
// so an example over a published genome costs a few hundred kB rather than the
// whole annotation.
//
// Runs from the output directory on purpose: tabix caches a remote .tbi into
// the process's working directory, so calling it from wherever the user
// happened to be drops a stray index file beside their shell.
export function fetchRegions(url, regions, outFile) {
  const cwd = path.dirname(outFile)
  fs.mkdirSync(cwd, { recursive: true })
  const out = JSON.stringify(path.resolve(outFile))
  run('sh', ['-c', `tabix -H ${JSON.stringify(url)} > ${out} || true`], { cwd })
  for (const r of regions) {
    run(
      'sh',
      ['-c', `tabix ${JSON.stringify(url)} ${JSON.stringify(r)} >> ${out}`],
      { cwd },
    )
  }
  return outFile
}

// A GFF has to be sorted by contig then start before tabix will index it, and
// the header lines have to stay on top.
function sortGff(input, output) {
  const script = `(grep '^#' ${JSON.stringify(input)} || true; grep -v '^#' ${JSON.stringify(input)} | sort -k1,1 -k4,4n) > ${JSON.stringify(output)}`
  run('sh', ['-c', script])
}

export function prepareGff(input, outDir, name) {
  if (isUrl(input)) {
    return input
  }
  fs.mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, `${name}.gff.gz`)
  if (isGz(input)) {
    fs.copyFileSync(input, target)
    for (const ext of ['.tbi', '.csi']) {
      if (fs.existsSync(input + ext)) {
        fs.copyFileSync(input + ext, target + ext)
      }
    }
  } else {
    const sorted = path.join(outDir, `${name}.sorted.gff`)
    sortGff(input, sorted)
    run('sh', [
      '-c',
      `bgzip -c ${JSON.stringify(sorted)} > ${JSON.stringify(target)}`,
    ])
    fs.unlinkSync(sorted)
  }
  if (!fs.existsSync(`${target}.tbi`) && !fs.existsSync(`${target}.csi`)) {
    run('tabix', ['-p', 'gff', target])
  }
  return path.basename(target)
}

export function prepareFasta(input, outDir, name) {
  if (isUrl(input)) {
    return input
  }
  fs.mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, `${name}.fa.gz`)
  if (isGz(input)) {
    fs.copyFileSync(input, target)
    for (const ext of ['.fai', '.gzi']) {
      if (fs.existsSync(input + ext)) {
        fs.copyFileSync(input + ext, target + ext)
      }
    }
  } else {
    // bgzip, not gzip: JBrowse needs block compression to seek into it
    run('sh', [
      '-c',
      `bgzip -c ${JSON.stringify(input)} > ${JSON.stringify(target)}`,
    ])
  }
  if (!fs.existsSync(`${target}.fai`) || !fs.existsSync(`${target}.gzi`)) {
    run('samtools', ['faidx', target])
  }
  return path.basename(target)
}

// The conflicts BED is written by the portal rather than handed to it, so it
// lands twice: plain, because "where are the disagreements" should be a file
// anyone can open, and bgzipped for the track that puts the answer in the
// picture.
export function prepareBed(text, outDir, name) {
  fs.mkdirSync(outDir, { recursive: true })
  const plain = path.join(outDir, `${name}.bed`)
  const target = path.join(outDir, `${name}.bed.gz`)
  fs.writeFileSync(plain, text)
  run('sh', [
    '-c',
    `bgzip -f -c ${JSON.stringify(plain)} > ${JSON.stringify(target)}`,
  ])
  run('tabix', ['-f', '-p', 'bed', target])
  return path.basename(target)
}

export function prepareBam(input, outDir) {
  if (isUrl(input)) {
    return input
  }
  fs.mkdirSync(outDir, { recursive: true })
  const target = path.join(outDir, path.basename(input))
  fs.copyFileSync(input, target)
  const idx = fs.existsSync(`${input}.bai`)
    ? `${input}.bai`
    : fs.existsSync(input.replace(/\.bam$/, '.bai'))
      ? input.replace(/\.bam$/, '.bai')
      : null
  if (idx) {
    fs.copyFileSync(idx, `${target}.bai`)
  } else {
    run('samtools', ['index', target])
  }
  return path.basename(target)
}

// Every annotation lane sizes itself to what it drew and stops. A gene track
// left at the fixed 100px default spends most of a card on whitespace — two
// rows of features in a lane deep enough for six — and three such lanes above
// the evidence is where the vertical budget went.
const grownLane = (displayId, growMaxHeight, rest = {}) => [
  {
    type: 'LinearBasicDisplay',
    displayId,
    heightMode: 'grow',
    growMaxHeight,
    ...rest,
  },
]

export function buildConfig({
  assembly,
  hubAssembly,
  fastaRef,
  aliasesRef,
  predictionRef,
  predictionCsi,
  conflictsRef,
  referenceRef,
  referenceCsi,
  referenceAdapter,
  rnaRefs,
  rnaNames = [],
  rnaHeight,
  predictionName,
  referenceName,
}) {
  const uri = f => (isUrl(f) ? f : `data/${f}`)
  const gff = (f, csi) => ({
    type: 'Gff3TabixAdapter',
    uri: uri(f),
    ...(csi ? { csi: true } : {}),
  })
  const tracks = [
    {
      type: 'FeatureTrack',
      trackId: 'prediction',
      name: predictionName || 'Prediction',
      category: ['Review'],
      assemblyNames: [assembly],
      adapter: gff(predictionRef, predictionCsi),
      displays: grownLane('prediction-LinearBasicDisplay', 130),
    },
  ]
  // Directly under the prediction, because the whole complaint about a capture
  // of a disagreement is that the eye cannot find it among the reference's
  // isoforms. This lane is one short box per disagreement, labelled with what
  // moved.
  if (conflictsRef) {
    tracks.push({
      type: 'FeatureTrack',
      trackId: 'conflicts',
      name: 'Disagreements',
      category: ['Review'],
      assemblyNames: [assembly],
      adapter: { type: 'BedTabixAdapter', uri: uri(conflictsRef) },
      displays: grownLane('conflicts-LinearBasicDisplay', 130),
    })
  }
  if (referenceRef) {
    tracks.push({
      type: 'FeatureTrack',
      trackId: 'reference_annotation',
      name: referenceName || 'Reference annotation',
      category: ['Review'],
      assemblyNames: [assembly],
      adapter: referenceAdapter ?? gff(referenceRef, referenceCsi),
      // The one lane that is genuinely many rows deep, and the one that earns
      // `compact`: the reference's isoforms are context here, not the subject,
      // so a shorter glyph buys the evidence below a hundred pixels.
      displays: grownLane('reference_annotation-LinearBasicDisplay', 170, {
        displayMode: 'compact',
      }),
    })
  }
  rnaRefs.forEach((r, i) => {
    const trackId = `rnaseq_${i + 1}`
    const track = {
      type: 'AlignmentsTrack',
      trackId,
      name:
        rnaNames[i] || (rnaRefs.length > 1 ? `RNA-seq ${i + 1}` : 'RNA-seq'),
      category: ['Evidence'],
      assemblyNames: [assembly],
      adapter: { type: 'BamAdapter', uri: uri(r) },
      // A display block in the TRACK CONFIG is the one way to stage a lane that
      // both halves of a card obey, because both read this file. Neither of the
      // other two routes works on a released JBrowse: `displayDefaults`
      // postdates it, and a session spec's tracks are ids, so a track written
      // as an object to hang settings off resolves to nothing at all.
      displays: [
        {
          type: 'LinearAlignmentsDisplay',
          displayId: `${trackId}-LinearAlignmentsDisplay`,
          ...(rnaHeight ? { height: rnaHeight } : {}),
          // Compact reads (3px against the 7px default) and spliced ones laid
          // out first. A card is a gene-scale window, where an individual read
          // is a tick either way — so what the pileup owes the reader is the
          // shape of the splicing, and both settings buy that: three times the
          // depth in the same lane, with every read carrying a junction in the
          // top rows rather than scattered among the reads that carry none.
          featureHeight: 3,
          splicedReadsFirst: true,
        },
      ],
    }
    tracks.push(track)
  })

  // A hub assembly arrives complete — sequence, chrom.sizes and aliases, all
  // already absolute — so it goes in as it stands rather than being rebuilt out
  // of parts the caller would have to name again.
  const asm = hubAssembly ?? {
    name: assembly,
    sequence: {
      type: 'ReferenceSequenceTrack',
      trackId: `${assembly}-ref`,
      adapter: { type: 'BgzipFastaAdapter', uri: uri(fastaRef) },
    },
  }
  // A prediction GFF says chr22 where a reference FASTA often says 22, and
  // JBrowse reports the mismatch as "unknown reference sequence name" with the
  // assembly otherwise loading fine.
  if (aliasesRef && !asm.refNameAliases) {
    asm.refNameAliases = {
      adapter: { type: 'RefNameAliasAdapter', uri: uri(aliasesRef) },
    }
  }

  return {
    assemblies: [asm],
    tracks,
    defaultSession: {
      name: 'Review',
      views: [{ id: 'review', type: 'LinearGenomeView', tracks: [] }],
    },
  }
}
