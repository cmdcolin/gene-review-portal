// Rebuild the README's two screenshots. Nothing else reads them, and they go
// stale the moment the page changes, so the command that makes them is checked
// in beside them rather than living in somebody's shell history.
//
//   node docs/shoot.mjs                       # jbrowse create, needs the network
//   node docs/shoot.mjs <jbrowse-web/build>   # a build you already have
//
// The portal is pnpm test's own fixture, so the models in the pictures are the
// ones the suite asserts about, and the captures are a real JBrowse. Needs
// puppeteer, same as test/browser.mjs.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import puppeteer from 'puppeteer'

const HERE = import.meta.dirname
const appDir = process.argv[2]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gene-review-shots-'))
const fixture = path.join(tmp, 'fixture')
const portal = path.join(tmp, 'portal')

execFileSync('node', [path.join(HERE, '..', 'test', 'make-fixture.mjs'), fixture], {
  stdio: 'inherit',
})
execFileSync(
  'node',
  [
    path.join(HERE, '..', 'bin', 'make-portal.mjs'),
    '--prediction', path.join(fixture, 'prediction.gff3'),
    '--reference', path.join(fixture, 'reference.gff3'),
    '--fasta', path.join(fixture, 'genome.fa'),
    '--assembly', 'fixture',
    '--title', 'Fixture gene models',
    ...(appDir ? ['--app-dir', appDir] : ['--with-app']),
    '--width', '1200',
    '--height', '340',
    '--out', portal,
  ],
  { stdio: 'inherit' },
)

// 772 ends the frame on the first card's bottom edge, with the second one's
// stripe just showing — a queue rather than a single card, and no ragged cut
// through the middle of a capture.
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox'],
})
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage()
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: scheme },
  ])
  await page.setViewport({ width: 1280, height: 772 })
  await page.goto(`file://${path.join(portal, 'index.html')}`, {
    waitUntil: 'load',
  })
  // verdicts persist per portalId, and both shots share one, so the second
  // would otherwise open on the first one's marks
  await page.evaluate(() => {
    localStorage.clear()
  })
  await page.reload({ waitUntil: 'load' })
  // a queue mid-review says more than an untouched one: one card judged, the
  // progress bar carrying it, the cursor moved on
  await page.keyboard.press('j')
  await page.keyboard.press('2')
  await page.keyboard.press('j')
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
  await new Promise(r => setTimeout(r, 400))
  const file = path.join(HERE, `review-page-${scheme}.png`)
  await page.screenshot({ path: file })
  console.log(`${path.relative(process.cwd(), file)} ${fs.statSync(file).size} bytes`)
  await page.close()
}
await browser.close()
fs.rmSync(tmp, { recursive: true, force: true })
