#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
// Build a static gene-model review portal from a prediction GFF, a reference
// annotation and a genome.
//
// Everything it emits is static: the data, the config, the pictures, the page,
// and (with --with-app) JBrowse itself. Copy the directory to any web server.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  absoluteLink,
  apolloLink,
  captureAll,
  captureBin,
  relativeLink,
  sessionFor,
} from '../lib/capture.mjs'
import { classify, CLASSES, conflictBed } from '../lib/classify.mjs'
import {
  classTable,
  evidenceTable,
  runTable,
  writeRecords,
} from '../lib/measurements.mjs'
import { renderPage } from '../lib/page.mjs'
import {
  buildConfig,
  checkTools,
  fetchHubConfig,
  fetchRegions,
  hubTracks,
  isUrl,
  listHubs,
  prepareBam,
  prepareBed,
  prepareFasta,
  prepareGff,
  trackFromHub,
  usesCsi,
} from '../lib/prepare.mjs'
import { serveStatic } from '../lib/serve.mjs'

const DEFAULT_INSTANCE = 'https://jbrowse.org/code/jb2/latest/'
// release.yml publishes code/jb2/latest, push.yml publishes code/jb2/<ref>, so
// "latest" is the latest release and main is reachable under its own name.
const MAIN_INSTANCE = 'https://jbrowse.org/code/jb2/main/'
const CLASS_ORDER = [
  'merge',
  'structure-conflict',
  'novel-locus',
  'novel-coding',
]

function usage() {
  console.log(`
make-portal — a static review portal for gene predictions

REQUIRED
  --prediction <gff>     the predicted models (Tiberius, AUGUSTUS, BRAKER, ...)
  --fasta <fa|fa.gz>     the genome the prediction was made against
  --out <dir>            directory to write (created, must not be a live site)

STRONGLY RECOMMENDED
  --reference <gff>      a reference annotation to compare against. Without it
                         every model lands in one bucket and there is nothing
                         to triage.

OPTIONAL
  --rnaseq <bam>         evidence track, repeatable. Appears in every capture
                         and every live link.
  --rnaseq-height <px>   starting height of an evidence lane. The reads in one
                         are compact and spliced-first, and the annotation lanes
                         above size themselves to what they drew, so ~170 in a
                         --height 920 capture shows two lanes whole — coverage,
                         sashimi arcs and pileup each. A BAM left alone opens at
                         250 and pushes the second lane off the picture.
  --rnaseq-name <s>      label for the evidence track, repeatable and paired
                         with --rnaseq in order. Two unlabelled tracks are
                         "RNA-seq 1" and "RNA-seq 2", which says nothing about
                         which tissue is which.
  --aliases <file|url>   a refName alias table (UCSC style, two columns). Needed
                         whenever the annotations say chr22 and the FASTA says 22,
                         which JBrowse reports as "unknown reference sequence name".
  --prediction-name <s>  track label for the prediction (default: its filename)
  --reference-name <s>   track label for the reference (default: its filename)
  --assembly <name>      assembly name in the config (default: the fasta's basename)
  --hub <name>           take the assembly from the hub of that name rather
                         than building one: a UCSC database (\`hg38\`, \`mm39\`)
                         or a GenArk accession (\`GCF_000001405.40\`). Its
                         sequence, chrom.sizes, refName aliases and cytobands
                         arrive already wired, which is the whole of --fasta and
                         --aliases. Replaces --fasta.
  --assembly-from <url>  the same, for a JBrowse config.json at a URL a hub name
                         does not reach.
  --reference-track <id> use one of that hub's own annotation tracks as
                         --reference, so a GENCODE that tracks the hub replaces
                         a URL somebody pasted once. Needs --hub.
  --list-hubs            print the assembly names --hub takes, and stop
  --list-tracks          print the annotation tracks in --hub, and stop
  --region <refName>     restrict the scan to one contig, repeatable
  --max <n>              candidates kept per class (default 12)
  --title <text>         page heading
  --with-app             run \`jbrowse create\` so the portal ships its own copy
                         of JBrowse and needs no internet at all
  --app-branch <name>    bundle the development build from a git branch rather
                         than the npm RELEASE \`jbrowse create\` installs on its
                         own — \`--app-branch main\` is what makes a capture show
                         current main. Implies --with-app.
  --app-dir <dir>        bundle a JBrowse you built yourself, for a branch with
                         no published build or for work not yet pushed:
                         \`products/jbrowse-web/build\` in a jbrowse-components
                         checkout. Implies --with-app.
  --instance <url>       drive/link a hosted JBrowse instead (default ${DEFAULT_INSTANCE},
                         which is also the latest release; ${MAIN_INSTANCE} is main)
  --apollo <url>         an Apollo 3 instance. Every card gains an \`Edit in
                         Apollo\` link that opens the same window there, which is
                         where the annotator action actually happens.
  --apollo-assembly <s>  Apollo's name for the assembly, when it differs from
                         --assembly (Apollo names assemblies from its own server)
  --apollo-track <id>    open this track in the Apollo link. Its own annotation
                         track is usually \`apollo_track_<assembly>\`, but only the
                         ones the Apollo server's config declares resolve from a
                         link; the rest it adds after the session loads, and a
                         link naming one of those fails to open. Default: no
                         track, so the view arrives and the annotator turns
                         Apollo's own layer on.
  --measurement <prefix> write the run's counts as measurement records —
                         \`<prefix>-classes.json\` and \`<prefix>-run.json\`, plus
                         \`-evidence.json\` when --rnaseq is given. A tutorial then
                         quotes a cell instead of a number somebody typed, which
                         is what goes stale the first time the comparison
                         changes.
  --no-capture           skip the screenshots; links still work
  --inline-images        embed the captures in index.html, so the portal is one
                         file. Needs --region with remote inputs.
  --public-config <url>  where config.json will be published. Captures still run
                         against the local copy; only the links use this, which
                         is what lets a single-file portal be deployed on its own.
  --width/--height <px>  capture size (default 1400x400)
  --scale <n>            capture device pixel ratio (default 2)

EXAMPLE
  node bin/make-portal.mjs \\
    --prediction tiberius.gff3 --reference gencode.gff3 --fasta genome.fa \\
    --rnaseq rnaseq.bam --assembly hg38 --region chr22 \\
    --with-app --out ./portal
`)
}

// One entry per flag, so the loop stays four cases rather than forty and every
// flag gets the same treatment: a value that is actually there, and a number
// that is actually a number.
const TEXT = {
  '--prediction': 'prediction',
  '--reference': 'reference',
  '--fasta': 'fasta',
  '--assembly': 'assembly',
  '--assembly-from': 'assemblyFrom',
  '--hub': 'hub',
  '--reference-track': 'referenceTrack',
  '--out': 'out',
  '--title': 'title',
  '--instance': 'instance',
  '--measurement': 'measurement',
  '--public-config': 'publicConfig',
  '--apollo': 'apollo',
  '--apollo-assembly': 'apolloAssembly',
  '--apollo-track': 'apolloTrack',
  '--aliases': 'aliases',
  '--prediction-name': 'predictionName',
  '--reference-name': 'referenceName',
  '--app-dir': 'appDir',
  '--app-branch': 'appBranch',
}
const REPEATED = {
  '--rnaseq': 'rnaseq',
  '--rnaseq-name': 'rnaseqName',
  '--region': 'region',
}
const NUMERIC = {
  '--rnaseq-height': 'rnaseqHeight',
  '--max': 'max',
  '--width': 'width',
  '--height': 'height',
  '--scale': 'scale',
}
const SWITCHES = {
  '--with-app': ['withApp', true],
  '--no-capture': ['capture', false],
  '--inline-images': ['inlineImages', true],
  '--list-hubs': ['listHubs', true],
  '--list-tracks': ['listTracks', true],
  '--help': ['help', true],
  '-h': ['help', true],
}

function parseArgs(argv) {
  const o = {
    rnaseq: [],
    rnaseqName: [],
    region: [],
    max: 12,
    width: 1400,
    height: 400,
    scale: 2,
    capture: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) {
        throw new Error(`${a} takes a value and got nothing`)
      }
      return v
    }
    if (SWITCHES[a]) {
      const [key, val] = SWITCHES[a]
      o[key] = val
    } else if (TEXT[a]) {
      o[TEXT[a]] = value()
    } else if (REPEATED[a]) {
      o[REPEATED[a]].push(value())
    } else if (NUMERIC[a]) {
      // `--max notanumber` used to reach slice(0, NaN) and select nothing,
      // leaving a portal with no cards and no complaint about why
      const v = value()
      const n = Number(v)
      if (!Number.isFinite(n)) {
        throw new Error(`${a} takes a number and got ${v}`)
      }
      o[NUMERIC[a]] = n
    } else {
      throw new Error(`unknown flag ${a}`)
    }
  }
  return { ...o, withApp: Boolean(o.withApp || o.appDir || o.appBranch) }
}

let opts
try {
  opts = parseArgs(process.argv.slice(2))
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
if (opts.listHubs) {
  console.log(await listHubs())
  process.exit(0)
}
if (opts.listTracks) {
  if (!opts.hub && !opts.assemblyFrom) {
    console.error('--list-tracks lists the tracks in a hub; name one with --hub')
    process.exit(1)
  }
  console.log(hubTracks(await fetchHubConfig(opts)))
  process.exit(0)
}
const fromHub = opts.hub || opts.assemblyFrom
if (opts.help || !opts.prediction || !(opts.fasta || fromHub) || !opts.out) {
  usage()
  process.exit(opts.help ? 0 : 1)
}
if (opts.fasta && fromHub) {
  console.error('--fasta and --hub/--assembly-from both say what the assembly is')
  process.exit(1)
}
if (opts.hub && opts.assemblyFrom) {
  console.error('--hub and --assembly-from both say which config to take it from')
  process.exit(1)
}
if (opts.referenceTrack && !fromHub) {
  console.error('--reference-track names a track in a hub; name one with --hub')
  process.exit(1)
}
if (opts.appDir && opts.appBranch) {
  console.error('--app-dir and --app-branch both say where JBrowse comes from')
  process.exit(1)
}
if (opts.appDir && !fs.existsSync(path.join(opts.appDir, 'index.html'))) {
  console.error(`--app-dir has no index.html in it: ${opts.appDir}`)
  process.exit(1)
}
for (const f of [
  opts.prediction,
  opts.reference,
  opts.fasta,
  opts.aliases,
  ...opts.rnaseq,
].filter(Boolean)) {
  if (isUrl(f)) {
    continue
  }
  if (!fs.existsSync(f)) {
    console.error(`no such file: ${f}`)
    process.exit(1)
  }
}

const out = path.resolve(opts.out)
const dataDir = path.join(out, 'data')
const imgDir = path.join(out, 'img')
const hub = fromHub ? await fetchHubConfig(opts) : null
const hubAssembly = hub?.assemblies[0] ?? null
let referenceAdapter = null
if (opts.referenceTrack) {
  const track = trackFromHub(hub, opts.referenceTrack)
  opts.reference = track.uri
  opts.referenceName = opts.referenceName || track.name
  referenceAdapter = track.adapter
}
const assembly =
  opts.assembly ||
  hubAssembly?.name ||
  path.basename(opts.fasta).replace(/\.(fa|fasta)(\.gz)?$/i, '') ||
  'genome'
if (hubAssembly) {
  hubAssembly.name = assembly
}
const portalId = `${assembly}-${path.basename(opts.prediction).replaceAll(/\W+/g, '_')}`

function copyAlongside(input, dir) {
  fs.mkdirSync(dir, { recursive: true })
  const base = path.basename(input)
  fs.copyFileSync(input, path.join(dir, base))
  return base
}

console.log(`→ ${out}`)
checkTools()
fs.mkdirSync(dataDir, { recursive: true })

console.log('preparing data')
const fastaRef = hubAssembly ? null : prepareFasta(opts.fasta, dataDir, assembly)
const predictionRef = prepareGff(opts.prediction, dataDir, 'prediction')
const referenceRef = opts.reference
  ? prepareGff(opts.reference, dataDir, 'reference')
  : null
const rnaRefs = opts.rnaseq.map(b => prepareBam(b, dataDir))

const aliasesRef = opts.aliases
  ? isUrl(opts.aliases)
    ? opts.aliases
    : copyAlongside(opts.aliases, dataDir)
  : null

console.log('classifying')
if (!opts.reference) {
  console.log('  no --reference given: every model is reported unclassified')
}
const refNames = opts.region.length ? new Set(opts.region) : null

// The config can name a remote GFF directly, but the classifier has to read
// one. Pull down just the regions asked for rather than the whole annotation.
function readable(input, name) {
  if (!isUrl(input)) {
    return input
  }
  if (!opts.region.length) {
    console.error(
      `--${name} is a URL, so --region is required: the classifier reads the file and will not fetch a whole remote annotation.`,
    )
    process.exit(1)
  }
  const local = path.join(scratch, `${name}.gff`)
  console.log(`  fetching ${opts.region.join(', ')} from ${input}`)
  return fetchRegions(input, opts.region, local)
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'make-portal-'))
const { rows, tally, total } = opts.reference
  ? classify({
      predictionFile: readable(opts.prediction, 'prediction'),
      referenceFile: readable(opts.reference, 'reference'),
      refNames,
    })
  : { rows: [], tally: {}, total: 0 }
fs.rmSync(scratch, { recursive: true, force: true })

// The config is written after the classifier because one of its tracks is the
// classifier's own output.
const bed = rows.length ? conflictBed(rows) : null
const conflictsRef = bed ? prepareBed(bed, dataDir, 'conflicts') : null

const config = buildConfig({
  assembly,
  hubAssembly,
  fastaRef,
  aliasesRef,
  predictionRef,
  predictionCsi: await usesCsi(predictionRef, dataDir),
  conflictsRef,
  referenceRef,
  referenceAdapter,
  referenceCsi:
    referenceRef && !referenceAdapter
      ? await usesCsi(referenceRef, dataDir)
      : false,
  rnaRefs,
  rnaNames: opts.rnaseqName,
  rnaHeight: opts.rnaseqHeight,
  predictionName:
    opts.predictionName ||
    path.basename(opts.prediction).replace(/\.gff3?(\.gz)?$/i, ''),
  referenceName:
    opts.referenceName ||
    (opts.reference
      ? path.basename(opts.reference).replace(/\.gff3?(\.gz)?$/i, '')
      : null),
})
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2))
const trackIds = config.tracks.map(t => t.trackId)

const agrees = tally.agrees || 0
const flagged = total - agrees
console.log(`  ${total} models · ${agrees} agree · ${flagged} flagged`)
for (const k of CLASS_ORDER) {
  if (tally[k]) {
    console.log(`    ${CLASSES[k].label}: ${tally[k]}`)
  }
}

// Counted separately from the classes, because it is the one finding the page
// itself cannot show: a model sharing four junctions out of five is filed as
// `agrees` and never reaches a card, and the fifth is still a real edit.
if (conflictsRef) {
  const quiet = rows.filter(r => r.cls === 'agrees' && r.conflicts.length)
  console.log(`  data/conflicts.bed written`)
  if (quiet.length) {
    console.log(
      `    ${quiet.length} agreeing model(s) still disagree on a junction; only the BED lists them`,
    )
  }
}

const candidates = CLASS_ORDER.flatMap(cls =>
  rows
    .filter(r => r.cls === cls)
    .sort((a, b) => b.nExons - a.nExons || b.span - a.span)
    .slice(0, opts.max),
)
console.log(
  `  ${candidates.length} candidates selected (max ${opts.max} per class)`,
)

if (opts.withApp) {
  const appDir = path.join(out, 'jbrowse')
  if (fs.existsSync(path.join(appDir, 'index.html'))) {
    console.log('bundling JBrowse — already present, skipping')
  } else if (opts.appDir) {
    console.log(`bundling JBrowse from ${opts.appDir}`)
    fs.cpSync(opts.appDir, appDir, { recursive: true })
  } else {
    // Bare `jbrowse create` installs the latest npm release, so a capture of a
    // feature that has not shipped shows the version before it.
    const branch = opts.appBranch ? ['--branch', opts.appBranch] : []
    console.log(
      `bundling JBrowse (jbrowse create${branch.length ? ` --branch ${opts.appBranch}` : ''})`,
    )
    execFileSync('jbrowse', ['create', appDir, ...branch], { stdio: 'inherit' })
  }
}

let captured = []
if (opts.capture && candidates.length) {
  console.log(`capturing ${candidates.length} views`)
  const server = await serveStatic(out)
  const instance = opts.withApp
    ? `${server.url}/jbrowse/`
    : opts.instance || DEFAULT_INSTANCE
  const configUrl = `${server.url}/config.json`
  if (!opts.withApp) {
    console.log(`  driving ${instance} against ${configUrl}`)
    console.log(
      '  a hosted instance cannot reach a local config; use --with-app for local data',
    )
  }
  try {
    captured = await captureAll({
      candidates,
      trackIds,
      assembly,
      instance,
      configUrl,
      outDir: imgDir,
      captureBin: captureBin(),
      width: opts.width,
      height: opts.height,
      scale: opts.scale,
      settle: 900,
      timeout: 90000,
      onProgress: (c, ok, note, tries) => {
        const retried = tries > 1 ? ` (${tries} tries)` : ''
        console.log(
          `  ${ok ? 'ok  ' : 'FAIL'} ${c.id} ${c.refName}:${c.start + 1}-${c.end}${retried}${ok ? '' : ` — ${note}`}`,
        )
      },
    })
  } finally {
    await server.close()
  }
  const failed = captured.filter(c => !c.ok)
  if (failed.length) {
    console.log(
      `  ${failed.length} capture(s) failed after ${failed[0].tries} tries, so their cards show the link only: ${failed.map(c => c.id).join(', ')}`,
    )
  }
}

const imgFor = id => {
  const hit = captured.find(c => c.id === id)
  if (!hit || !hit.ok) {
    return null
  }
  if (!opts.inlineImages) {
    return `img/${hit.file}`
  }
  const bytes = fs.readFileSync(path.join(imgDir, hit.file))
  return `data:image/png;base64,${bytes.toString('base64')}`
}

const apolloAssembly = opts.apolloAssembly || assembly
const apolloTracks = opts.apolloTrack ? [opts.apolloTrack] : []

const cards = candidates.map(c => {
  const { loc, session } = sessionFor(c, trackIds, assembly)
  return {
    id: c.id,
    cls: c.cls,
    loc,
    refName: c.refName,
    nExons: c.nExons,
    strand: c.strand,
    spanKb: Math.round(c.span / 100) / 10,
    genes: c.genes,
    gapBp: c.gapBp,
    conflicts: c.conflicts,
    sharedJunctions: c.sharedJunctions,
    img: imgFor(c.id),
    apollo: opts.apollo
      ? apolloLink(
          sessionFor(c, apolloTracks, apolloAssembly).session,
          opts.apollo,
        )
      : null,
    url: opts.publicConfig
      ? absoluteLink(
          session,
          opts.instance || DEFAULT_INSTANCE,
          opts.publicConfig,
        )
      : opts.withApp
        ? relativeLink(session)
        : absoluteLink(
            session,
            opts.instance || DEFAULT_INSTANCE,
            'config.json',
          ),
  }
})

if (opts.measurement && rows.length) {
  const prefix = path.resolve(opts.measurement)
  const name = path.basename(prefix)
  const region = opts.region.join(', ')
  // The record is only worth having if somebody else can take it again, so the
  // repro is the invocation verbatim, quoted — a track name with a space in it
  // is one word here and two when pasted back.
  const quote = a =>
    /^[\w./:@=-]+$/.test(a) ? a : `'${a.replaceAll("'", String.raw`'\''`)}'`
  const repro = ['gene-review-portal', ...process.argv.slice(2)]
    .map(quote)
    .join(' ')
  const records = [
    classTable({
      id: `${name}-classes`,
      repro,
      classes: CLASSES,
      classOrder: CLASS_ORDER,
      tally,
      region,
    }),
    runTable({
      id: `${name}-run`,
      repro,
      rows,
      tally,
      bedRecords: (bed || '')
        .split('\n')
        .filter(l => l && !l.startsWith('#')).length,
      region,
    }),
  ]
  if (rnaRefs.length) {
    console.log('  counting evidence reads per candidate')
    records.push(
      evidenceTable({
        id: `${name}-evidence`,
        repro,
        candidates,
        loci: candidates.map(c => sessionFor(c, [], assembly).loc),
        bams: opts.rnaseq,
        names: opts.rnaseqName,
      }),
    )
  }
  for (const f of writeRecords(prefix, records)) {
    console.log(`  ${path.relative(process.cwd(), f)}`)
  }
}

const title = opts.title || `${assembly} gene models`
const data = {
  portalId,
  title,
  eyebrow: [
    assembly,
    opts.region.join(', ') || 'all contigs',
    'prediction vs reference',
  ]
    .filter(Boolean)
    .join(' · '),
  lede:
    `The prediction has <strong>${total}</strong> gene models here. ` +
    `<strong>${agrees}</strong> share splice junctions with a reference gene and need no attention. ` +
    `The other <strong>${flagged}</strong> disagree in one of four ways. ${
      cards.length < flagged
        ? `The ${opts.max} with the most exons in each class are below, `
        : 'All of them are below, '
    }with the evidence staged the same way every time.`,
  footer:
    `<div><b>How this page was built.</b> Every picture is a JBrowse view captured headlessly ` +
    `at that locus, and every <b>Open in JBrowse</b> link reopens the same view live. The candidate ` +
    `list comes from an exon-level comparison of the prediction against the reference annotation. ` +
    `<b>Disagreements</b> in each view, and <code>data/conflicts.bed</code>, mark every junction ` +
    `that differs — including the ones on models that agree well enough not to reach a card.</div>${
      opts.apollo
        ? '<div>The triage is the browser’s half. <b>Edit in Apollo</b> opens the same window in ' +
          'the annotation editor, where <b>Split into two models</b> is a real action rather than a note.</div>'
        : '<div>The triage is the browser’s half. The edit belongs in an annotation editor — ' +
          '<b>Split into two models</b> is not a viewer action.</div>'
    }<div>Verdicts are stored in this browser only. <b>Export</b> writes them out as TSV, and <b>Import</b> reads one back.</div>`,
  total,
  agrees,
  flagged,
  tally,
  classes: CLASSES,
  classOrder: CLASS_ORDER,
  cards,
}

fs.writeFileSync(
  path.join(out, 'index.html'),
  await renderPage({ data, title }),
)

console.log(`\nportal written to ${out}`)
console.log(
  `  ${cards.length} cards, ${captured.filter(c => c.ok).length} captures`,
)
console.log(`\n  npx serve ${path.relative(process.cwd(), out) || '.'}`)
if (!opts.withApp) {
  console.log(
    '  note: without --with-app the links point at a hosted JBrowse, which cannot',
  )
  console.log(
    '        read a config.json on your laptop. Publish the directory, or rebuild',
  )
  console.log('        with --with-app for a portal that is self-contained.')
}
