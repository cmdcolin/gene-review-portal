// Regenerate the fixture and check the classifier still puts every model in the
// class the fixture was built to produce. Runs offline in about a second.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  absoluteLink,
  apolloLink,
  captureAll,
  relativeLink,
  sessionFor,
} from '../lib/capture.mjs'
import { classify, CLASSES, conflictBed } from '../lib/classify.mjs'
import { renderPage } from '../lib/page.mjs'
import {
  buildConfig,
  fetchHubConfig,
  hubTracks,
  hubUrl,
  trackFromHub,
  usesCsi,
} from '../lib/prepare.mjs'
import { serveStatic } from '../lib/serve.mjs'

const HERE = import.meta.dirname
const FIXTURE = path.join(HERE, 'fixture')

execFileSync('node', [path.join(HERE, 'make-fixture.mjs'), FIXTURE], {
  stdio: 'pipe',
})

let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`ok   ${name}`)
  } else {
    console.log(`FAIL ${name}\n       expected ${e}\n       actual   ${a}`)
    failures++
  }
}

const { rows, tally, total } = classify({
  predictionFile: path.join(FIXTURE, 'prediction.gff3'),
  referenceFile: path.join(FIXTURE, 'reference.gff3'),
})

check('every predicted transcript is classified', total, 13)
check('class tally', tally, {
  agrees: 8,
  merge: 1,
  'structure-conflict': 1,
  'novel-coding': 1,
  'novel-locus': 2,
})

// The one that fails if the comparison goes back to span overlap: INNER sits in
// OUTER's intron on the same strand, so both spans contain the prediction and
// only exon overlap tells them apart.
const nested = rows.find(r => r.id === 'g500.t1')
check('a gene nested in an intron is not a merge', nested?.cls, 'agrees')
check(
  'the nested case names only the gene it shares exons with',
  nested?.genes,
  ['OUTER'],
)

const merge = rows.find(r => r.cls === 'merge')
check('the merge names both fused genes', merge?.genes, ['FUSEA', 'FUSEB'])
check('the merge reports the gap between them', merge?.gapBp, 3999)

const conflict = rows.find(r => r.cls === 'structure-conflict')
check('the structure conflict names its gene', conflict?.genes, ['SHIFTY'])

// The sabotage this pair is written against: build a gene's junctions by
// sorting every isoform's exons into one list and joining consecutive pairs,
// rather than reading one transcript at a time. That invents junctions no
// transcript has. TWOFORM's second isoform shares none of the invented ones, so
// flattening files a model that reproduces it exactly as a structure conflict —
// which is what it did to 18 of the 21 conflicts reported on human chr22,
// RANBP1 among them. Every other gene in this fixture has one isoform, where
// flattening and reading per transcript agree.
const twoform = rows.find(r => r.id === 'g600.t1')
check('a model reproducing one isoform of two agrees', twoform?.cls, 'agrees')
check(
  "and it is credited with that isoform's junctions",
  twoform?.sharedJunctions,
  2,
)

// A class says a model disagrees; these say what the edit is. SHIFTY's
// prediction is offset from it by a widening margin, so all three of its
// introns land inside a reference intron with neither end shared.
check(
  'each disagreeing junction says how far it moved',
  conflict?.conflicts.map(c => c.label),
  ['shifted-110', 'shifted-150', 'shifted-190'],
)
check(
  'and which junction of the model it is',
  conflict?.conflicts.map(c => `${c.index}/${c.of}`),
  ['1/3', '2/3', '3/3'],
)
check(
  'an agreeing model reports nothing to fix',
  rows.find(r => r.id === 'g1.t1')?.conflicts,
  [],
)

// ---- the BED the same finding leaves behind ------------------------------

const bed = conflictBed(rows)
const bedRows = bed
  .split('\n')
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.split('\t'))
check(
  'every flagged model reaches the BED, and no agreeing one does',
  [...new Set(bedRows.map(r => r[3].split(':')[0]))],
  ['g100.t1', 'g200.t1', 'g300.t1', 'g400.t1', 'g401.t1'],
)
// A merged model is cut in the intergenic space, and a merge can put an exon
// there, so the record is the gap rather than either junction beside it.
check(
  'a merge is one record over the gap it should be split at',
  bedRows.filter(r => r[3] === 'g100.t1:split').map(r => +r[2] - +r[1]),
  [merge.gapBp],
)
check(
  'a novel locus is its span, having no reference to disagree with',
  bedRows.find(r => r[3] === 'g400.t1:novel-locus')?.slice(0, 3),
  ['ctgB', '7999', '10699'],
)
check(
  'the records come out sorted, as tabix requires',
  bedRows.map(r => `${r[0]}:${r[1]}`),
  [...bedRows.map(r => `${r[0]}:${r[1]}`)].sort(
    (a, b) =>
      a.split(':')[0].localeCompare(b.split(':')[0]) ||
      +a.split(':')[1] - +b.split(':')[1],
  ),
)

const novel = rows.filter(r => r.cls === 'novel-locus').map(r => r.refName)
check('novel loci are the ones off the annotated contig', novel, [
  'ctgB',
  'ctgB',
])

// Restricting to a contig must not reclassify what stays in scope.
const scoped = classify({
  predictionFile: path.join(FIXTURE, 'prediction.gff3'),
  referenceFile: path.join(FIXTURE, 'reference.gff3'),
  refNames: new Set(['ctgA']),
})
check('--region drops the other contig only', scoped.tally, {
  agrees: 8,
  merge: 1,
  'structure-conflict': 1,
  'novel-coding': 1,
})

// A file compared against itself agrees with itself. This is what caught exons
// being keyed by a name attribute their own line does not carry — before that
// fix a self-comparison reported every model as a novel locus.
//
// LINCX is the exception and is not a bug: the classes are written for a
// coding-gene predictor, so a lncRNA model lands in novel-coding even when the
// reference is the same file.
const self = classify({
  predictionFile: path.join(FIXTURE, 'reference.gff3'),
  referenceFile: path.join(FIXTURE, 'reference.gff3'),
})
check('a self-comparison agrees with itself', self.tally, {
  agrees: 13,
  'novel-coding': 1,
})

// ---- which end of an intron moved ----------------------------------------

// The donor is the intron's 5' END on the minus strand and its START on the
// plus one, so the two sites cannot be named from coordinates alone. These two
// genes are the same arrangement read in opposite directions: three exons, and
// a prediction whose middle exon starts 30 bp late, leaving one junction that
// shares the reference's left end and misses its right one by 30. Naming the
// moved site by position calls both of them the same thing, and is wrong about
// one of them.
function gffModel(id, strand, exons, asGene) {
  const line = (type, start, end, attrs) =>
    `ctgS\tt\t${type}\t${start}\t${end}\t.\t${strand}\t.\t${attrs}`
  const out = []
  const span = [exons[0][0], exons.at(-1)[1]]
  if (asGene) {
    out.push(line('gene', ...span, `ID=${id};Name=${id};gene_type=protein_coding`))
  }
  const parent = asGene ? `;Parent=${id}` : ''
  out.push(
    line(asGene ? 'mRNA' : 'transcript', ...span, `ID=${id}.t1${parent}`),
  )
  for (const [s, e] of exons) {
    out.push(line('exon', s, e, `Parent=${id}.t1`))
  }
  return out
}
const REF_EXONS = [
  [1000, 1200],
  [1500, 1700],
  [2000, 2200],
]
const PRED_EXONS = [
  [1000, 1200],
  [1530, 1700],
  [2000, 2200],
]
const tenKbOn = ([s, e]) => [s + 10000, e + 10000]
const strandDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-strand-'))
const writeGff = (name, lines) => {
  const file = path.join(strandDir, name)
  fs.writeFileSync(file, `##gff-version 3\n${lines.join('\n')}\n`)
  return file
}
const strandRows = classify({
  predictionFile: writeGff('prediction.gff3', [
    ...gffModel('plus', '+', PRED_EXONS, false),
    ...gffModel('minus', '-', PRED_EXONS.map(tenKbOn), false),
  ]),
  referenceFile: writeGff('reference.gff3', [
    ...gffModel('PLUSG', '+', REF_EXONS, true),
    ...gffModel('MINUSG', '-', REF_EXONS.map(tenKbOn), true),
  ]),
}).rows
const siteOf = id => strandRows.find(r => r.id === id)?.conflicts.map(c => c.label)
check('on the plus strand the moved site is the acceptor', siteOf('plus.t1'), [
  'acceptor-30',
])
check(
  'and the same intron on the minus strand is the donor',
  siteOf('minus.t1'),
  ['donor-30'],
)
fs.rmSync(strandDir, { recursive: true, force: true })

// ---- the links a card carries -------------------------------------------

const candidate = { refName: 'chr22', start: 20000, end: 30000 }
const { loc, session } = sessionFor(candidate, ['prediction'], 'hg38')

// 40% of a 10 kb model is 4,000, over the 2 kb floor, so both ends move 4 kb
check('a big model gets 40% of its span', loc, 'chr22:16000-34000')
check(
  'a small one gets the padding floor instead',
  sessionFor({ refName: 'chr22', start: 20000, end: 24000 }, [], 'hg38').loc,
  'chr22:18000-26000',
)
check(
  'padding cannot walk off the start of a contig',
  sessionFor({ refName: 'chr22', start: 10, end: 400 }, [], 'hg38').loc,
  'chr22:1-2400',
)
check('the session names the tracks it was given', session.views[0].tracks, [
  'prediction',
])

check(
  'a bundled portal links relatively, config included',
  relativeLink(session),
  `jbrowse/?config=../config.json&session=${encodeURIComponent(`spec-${JSON.stringify(session)}`)}`,
)
check(
  'a hosted portal links absolutely, config encoded',
  absoluteLink(
    session,
    'https://jbrowse.org/code/jb2/latest',
    'https://example.org/config.json',
  ),
  `https://jbrowse.org/code/jb2/latest/?config=${encodeURIComponent('https://example.org/config.json')}&session=${encodeURIComponent(`spec-${JSON.stringify(session)}`)}`,
)

// The Apollo link carries NO config — the Apollo server's own is the point —
// and by default no tracks, because Apollo adds apollo_track_<assembly> from a
// reaction that runs after the session parses. A link naming a track its config
// does not itself declare fails to open at all, which is worse than arriving
// with the layer switched off.
const apolloUrl = apolloLink(
  sessionFor(candidate, [], 'hg38').session,
  'https://apollo.example.org/',
)
check('an Apollo link carries no config', apolloUrl.includes('config='), false)
check(
  'an Apollo link opens no track by default',
  JSON.parse(decodeURIComponent(apolloUrl.split('session=spec-')[1])).views[0]
    .tracks,
  [],
)
check(
  'an Apollo link opens the track it is given',
  JSON.parse(
    decodeURIComponent(
      apolloLink(
        sessionFor(candidate, ['apollo_track_hg38'], 'hg38').session,
        'https://apollo.example.org/',
      ).split('session=spec-')[1],
    ),
  ).views[0].tracks,
  ['apollo_track_hg38'],
)

// ---- the config the pictures and the links share -------------------------

const withEvidence = buildConfig({
  assembly: 'hg38',
  fastaRef: 'hg38.fa.gz',
  predictionRef: 'prediction.gff.gz',
  conflictsRef: 'conflicts.bed.gz',
  referenceRef: 'reference.gff.gz',
  rnaRefs: ['brain.bam', 'uhr.bam'],
  rnaNames: ['brain'],
  rnaHeight: 110,
})
// Directly under the prediction and above the reference. The complaint this
// lane answers is that a capture of a disagreement shows a correct-looking
// model over a stack of isoforms and no way to see which junction is the one.
check(
  'the disagreements lane sits between the two annotations',
  withEvidence.tracks.map(t => t.trackId).slice(0, 3),
  ['prediction', 'conflicts', 'reference_annotation'],
)
// Every annotation lane sizes itself to what it drew. Left at the fixed 100px
// default the three of them spent about 200px of a card on whitespace, which is
// what pushed the second evidence lane off the bottom of the frame.
check(
  'and sizes itself to the rows it drew, like the annotations around it',
  withEvidence.tracks
    .filter(t => t.type === 'FeatureTrack')
    .map(t => t.displays[0].heightMode),
  ['grow', 'grow', 'grow'],
)
check(
  'the reference annotation is the one drawn compact',
  withEvidence.tracks
    .filter(t => t.type === 'FeatureTrack')
    .map(t => t.displays[0].displayMode),
  [undefined, undefined, 'compact'],
)
check(
  'and it is left out when there is nothing to mark',
  buildConfig({
    assembly: 'hg38',
    fastaRef: 'hg38.fa.gz',
    predictionRef: 'prediction.gff.gz',
    referenceRef: null,
    rnaRefs: [],
  }).tracks.map(t => t.trackId),
  ['prediction'],
)
const evidence = withEvidence.tracks.filter(t => t.type === 'AlignmentsTrack')
check(
  'an unnamed second evidence track keeps its number',
  evidence.map(t => t.name),
  ['brain', 'RNA-seq 2'],
)
// The height rides in the track config because that is the only one of the
// three routes a released JBrowse honours — displayDefaults postdates it, and a
// session spec's tracks are ids rather than objects.
check(
  'each evidence lane carries its own display',
  evidence.map(t => t.displays[0].displayId),
  ['rnaseq_1-LinearAlignmentsDisplay', 'rnaseq_2-LinearAlignmentsDisplay'],
)
check(
  'the lane height is the one asked for',
  evidence[0].displays[0].height,
  110,
)
// Compactness is not the caller's to ask for: a card is a gene-scale window
// where a read is a tick, so what the pileup owes the reader is the shape of
// the splicing, and both settings buy that whatever height the lane opens at.
check(
  'and the reads are compact and spliced-first whether or not a height was asked for',
  buildConfig({
    assembly: 'hg38',
    fastaRef: 'hg38.fa.gz',
    predictionRef: 'prediction.gff.gz',
    referenceRef: null,
    rnaRefs: ['brain.bam'],
  }).tracks.find(t => t.type === 'AlignmentsTrack').displays[0],
  {
    type: 'LinearAlignmentsDisplay',
    displayId: 'rnaseq_1-LinearAlignmentsDisplay',
    featureHeight: 3,
    splicedReadsFirst: true,
  },
)

// ---- finding a hub, and reading one ---------------------------------------

// The same mapping core's fetchHub uses, so a name that opens in JBrowse opens
// here: a UCSC database is a flat path, a GenArk accession fans its nine digits
// into three levels.
check('a UCSC database name is a flat hub path', hubUrl('hg38'), 'https://jbrowse.org/ucsc/hg38/config.json')
check(
  'a GenArk accession is sharded three deep',
  hubUrl('GCF_000001405.40'),
  'https://jbrowse.org/hubs/genark/GCF/000/001/405/GCF_000001405.40/config.json',
)

// A hub read over HTTP, served locally so this stays offline. What matters is
// what comes back out: every URI absolute against the config's own location,
// and `metadata` untouched.
const hubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-hub-'))
fs.writeFileSync(
  path.join(hubDir, 'config.json'),
  JSON.stringify({
    assemblies: [
      {
        name: 'tst1',
        sequence: {
          type: 'ReferenceSequenceTrack',
          trackId: 'tst1-ref',
          // UCSC's own bookkeeping rides along for description. It is full of
          // things shaped like relative paths and none of them is ours to
          // rewrite — a published config whose metadata no longer says what the
          // hub's does is worse than one that carries it verbatim.
          metadata: { twoBitPath: 'tst1.2bit', chromSizes: 'tst1.chrom.sizes' },
          adapter: {
            type: 'TwoBitAdapter',
            uri: 'tst1.2bit',
            chromSizes: 'tst1.chrom.sizes',
          },
        },
        refNameAliases: {
          adapter: { type: 'RefNameAliasAdapter', uri: 'tst1.chromAlias.txt' },
        },
      },
    ],
    tracks: [
      {
        type: 'FeatureTrack',
        trackId: 'tst1-genes',
        name: 'Genes',
        adapter: { type: 'Gff3TabixAdapter', uri: 'genes.gff3.gz' },
      },
      {
        // The long form, which is what a hub big enough to need a CSI writes:
        // the file under a *GzLocation and the index named outright rather than
        // assumed to sit beside it. hg38's GENCODE is one of these.
        type: 'FeatureTrack',
        trackId: 'tst1-gencode',
        name: 'GENCODE',
        adapter: {
          type: 'Gff3TabixAdapter',
          gffGzLocation: { uri: 'gencode.gff3.gz', locationType: 'UriLocation' },
          index: {
            location: { uri: 'elsewhere/gencode.csi', locationType: 'UriLocation' },
            indexType: 'CSI',
          },
        },
      },
      {
        type: 'QuantitativeTrack',
        trackId: 'tst1-signal',
        name: 'Signal',
        adapter: { type: 'BigWigAdapter', uri: 'signal.bw' },
      },
    ],
  }),
)
const hubServer = await serveStatic(hubDir)
const hubConfig = await fetchHubConfig({
  assemblyFrom: `${hubServer.url}/config.json`,
})
await hubServer.close()

const seqAdapter = hubConfig.assemblies[0].sequence.adapter
check(
  'a hub URI comes back absolute against the config it came from',
  [seqAdapter.uri, seqAdapter.chromSizes],
  [`${hubServer.url}/tst1.2bit`, `${hubServer.url}/tst1.chrom.sizes`],
)
check(
  'and so does one nested under refNameAliases',
  hubConfig.assemblies[0].refNameAliases.adapter.uri,
  `${hubServer.url}/tst1.chromAlias.txt`,
)
check(
  'but metadata is carried verbatim, path-shaped values and all',
  hubConfig.assemblies[0].sequence.metadata,
  { twoBitPath: 'tst1.2bit', chromSizes: 'tst1.chrom.sizes' },
)

// --reference has to be something the classifier can tabix, so the listing is
// annotation tracks — not the signal and variant tracks that make up most of a
// hub's six hundred.
check(
  'only annotation tracks are offered as a reference',
  hubTracks(hubConfig),
  ['  tst1-genes    Genes', '  tst1-gencode  GENCODE'].join('\n'),
)
check(
  'and one of them resolves to a readable file',
  trackFromHub(hubConfig, 'tst1-genes').uri,
  `${hubServer.url}/genes.gff3.gz`,
)
// The long form is the one that matters: reading only `adapter.uri` found
// nothing on hg38's GENCODE and refused the track it was pointed at.
check(
  'the long adapter form names its file too',
  trackFromHub(hubConfig, 'tst1-gencode').uri,
  `${hubServer.url}/gencode.gff3.gz`,
)
// Carried whole rather than rebuilt from the uri: a rebuilt one can only assume
// the index sits adjacent, and this hub's does not.
check(
  "and the hub's own adapter is what goes into the config",
  trackFromHub(hubConfig, 'tst1-gencode').adapter.index,
  {
    location: {
      uri: `${hubServer.url}/elsewhere/gencode.csi`,
      locationType: 'UriLocation',
    },
    indexType: 'CSI',
  },
)
check(
  'a trackId the hub does not carry says so, and says where to look',
  (() => {
    try {
      trackFromHub(hubConfig, 'nope')
      return 'no error'
    } catch (e) {
      return e.message
    }
  })(),
  '--reference-track nope: no such track. List them with --list-tracks.',
)
fs.rmSync(hubDir, { recursive: true, force: true })

// ---- an assembly taken from a hub ----------------------------------------

// A hub config names its own files relative to itself, and the portal's
// config.json is published somewhere else entirely, so every URI in it has to
// come out absolute. chromSizes is one of them and is not spelled `uri`.
const HUB = {
  name: 'hg38',
  sequence: {
    type: 'ReferenceSequenceTrack',
    trackId: 'hg38-ref',
    adapter: {
      type: 'TwoBitAdapter',
      uri: 'https://hgdownload.soe.ucsc.edu/goldenPath/hg38/bigZips/hg38.2bit',
      chromSizes: 'https://jbrowse.org/ucsc/hg38/hg38.chrom.sizes',
    },
  },
  refNameAliases: {
    adapter: {
      type: 'RefNameAliasAdapter',
      uri: 'https://jbrowse.org/ucsc/hg38/hg38.chromAlias.txt',
    },
  },
}
const fromHub = buildConfig({
  assembly: 'hg38',
  hubAssembly: structuredClone(HUB),
  predictionRef: 'prediction.gff.gz',
  referenceRef: 'https://jbrowse.org/ucsc/hg38/gencode.v49.annotation.sorted.gff3.gz',
  referenceCsi: true,
  rnaRefs: [],
})
check(
  'a hub assembly goes in whole rather than being rebuilt',
  fromHub.assemblies[0],
  HUB,
)
// --aliases exists for the assemblies this tool builds itself. A hub already
// carries the right table, and overwriting it with the caller's would be the
// one thing worse than not having one.
check(
  'and its own alias table survives an --aliases beside it',
  buildConfig({
    assembly: 'hg38',
    hubAssembly: structuredClone(HUB),
    aliasesRef: 'someone_elses_aliases.txt',
    predictionRef: 'prediction.gff.gz',
    rnaRefs: [],
  }).assemblies[0].refNameAliases,
  HUB.refNameAliases,
)
// `uri` alone means `.tbi` to JBrowse, so a CSI-indexed reference loads as a
// track that fetches a 404 and draws nothing.
check(
  'a CSI-indexed reference says so',
  fromHub.tracks.find(t => t.trackId === 'reference_annotation').adapter,
  {
    type: 'Gff3TabixAdapter',
    uri: 'https://jbrowse.org/ucsc/hg38/gencode.v49.annotation.sorted.gff3.gz',
    csi: true,
  },
)
check(
  'and a tbi-indexed one stays the short spelling',
  fromHub.tracks.find(t => t.trackId === 'prediction').adapter,
  { type: 'Gff3TabixAdapter', uri: 'data/prediction.gff.gz' },
)

const idxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-index-'))
fs.writeFileSync(path.join(idxDir, 'tbi.gff.gz'), '')
fs.writeFileSync(path.join(idxDir, 'tbi.gff.gz.tbi'), '')
fs.writeFileSync(path.join(idxDir, 'csi.gff.gz'), '')
fs.writeFileSync(path.join(idxDir, 'csi.gff.gz.csi'), '')
check(
  'a local file is read off the index beside it',
  [await usesCsi('tbi.gff.gz', idxDir), await usesCsi('csi.gff.gz', idxDir)],
  [false, true],
)
fs.rmSync(idxDir, { recursive: true, force: true })

// ---- a flaky capture gets a second go -----------------------------------

// A stub standing in for jb2capture: fails its first N runs, writes the PNG
// after that. Nothing here launches a browser.
function stubBin(failuresBeforeSuccess) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-capture-'))
  const counter = path.join(dir, 'runs')
  fs.writeFileSync(counter, '0')
  const bin = path.join(dir, 'stub.mjs')
  fs.writeFileSync(
    bin,
    `import fs from 'node:fs'
const runs = Number(fs.readFileSync(${JSON.stringify(counter)}, 'utf8')) + 1
fs.writeFileSync(${JSON.stringify(counter)}, String(runs))
if (runs <= ${failuresBeforeSuccess}) {
  process.stderr.write('jb2capture: Attempted to use detached Frame\\n')
  process.exit(1)
}
fs.writeFileSync(process.argv[process.argv.indexOf('-o') + 1], 'png')
`,
  )
  return { bin, dir, runs: () => Number(fs.readFileSync(counter, 'utf8')) }
}

const captureArgs = {
  candidates: [
    { id: 'g1.t1', refName: 'chr22', start: 20000, end: 30000, cls: 'merge' },
  ],
  trackIds: ['prediction'],
  assembly: 'hg38',
  instance: 'http://127.0.0.1:1/',
  configUrl: 'http://127.0.0.1:1/config.json',
  width: 800,
  height: 400,
  scale: 1,
  settle: 0,
  timeout: 5000,
}

const flaky = stubBin(1)
const retried = await captureAll({
  ...captureArgs,
  outDir: path.join(flaky.dir, 'img'),
  captureBin: flaky.bin,
})
check(
  'a flake costs a card nothing',
  [retried[0].ok, retried[0].tries],
  [true, 2],
)
check('and the second run is what wrote the picture', flaky.runs(), 2)

const dead = stubBin(99)
const gaveUp = await captureAll({
  ...captureArgs,
  outDir: path.join(dead.dir, 'img'),
  captureBin: dead.bin,
})
check(
  'a locus that will not draw is reported, not retried forever',
  [gaveUp[0].ok, gaveUp[0].tries, gaveUp[0].file],
  [false, 2, null],
)
check('the run gives up after the second try', dead.runs(), 2)
check(
  'and the card is told why',
  gaveUp[0].note.includes('detached Frame'),
  true,
)

fs.rmSync(flaky.dir, { recursive: true, force: true })
fs.rmSync(dead.dir, { recursive: true, force: true })

// --- the page carries an inlined capture once, not twice ------------------

const SHOT = `data:image/png;base64,${'A'.repeat(2000)}`
const pageData = {
  portalId: 'test-portal',
  title: 'T',
  eyebrow: 'e',
  lede: 'l',
  footer: 'f',
  total: 2,
  agrees: 1,
  flagged: 1,
  tally: {},
  classes: CLASSES,
  classOrder: ['novel-locus'],
  cards: [
    {
      id: 'm1',
      cls: 'novel-locus',
      loc: 'ctgA:1-2',
      nExons: 1,
      spanKb: 1,
      strand: '+',
      genes: [],
      url: 'https://example.org/',
      img: SHOT,
    },
  ],
}
const page = await renderPage({ data: pageData, title: 'T' })
check(
  'the capture is rendered into the markup',
  page.includes(`src="${SHOT}"`),
  true,
)
// It used to ride in the JSON as well, which doubled a 2 MB portal.
check('and appears exactly once in the file', page.split(SHOT).length - 1, 1)
check(
  'the card is in the HTML before any script runs',
  page.includes('data-id="m1"'),
  true,
)

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed')
if (failures) {
  process.exit(1)
}

// The review page is the other half, and it needs a browser. Runs last so a
// classifier regression reports in a second rather than behind a Chrome launch.
console.log('')
const browser = spawnSync('node', [path.join(HERE, 'browser.mjs')], {
  stdio: 'inherit',
})
process.exit(browser.status ?? 1)
