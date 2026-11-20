// Usage (repo root, for playwright): node perf.mjs <dir with variant pages> [runs]
// Each run is a fresh headless Chromium (no shader or image cache), so it measures a first paint.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const { chromium } = require('playwright')
const dir = path.resolve(process.argv[2])
const runs = Number(process.argv[3] ?? 12)
const variants = readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5))
const RASTER = new Set(['RasterTask', 'GPUTask', 'ImageDecodeTask', 'Decode Image', 'Paint', 'PaintImage'])

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const results = {}
for (let r = 0; r < runs; r++) {
  // Interleave variants so drift on the box hits all of them alike.
  for (const v of variants) {
    const browser = await chromium.launch({ args: ['--disable-gpu-shader-disk-cache'] })
    const page = await browser.newPage({ viewport: { width: 260, height: 900 }, deviceScaleFactor: 2 })
    await browser.startTracing(page, {
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'gpu', 'cc', 'viz']
    })
    const html = readFileSync(path.join(dir, `${v}.html`), 'utf8')
    const t0 = Date.now()
    await page.setContent(html)
    const painted = await page.evaluate(async () => {
      await Promise.all([...document.images].map((img) => img.decode()))
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return performance.now()
    })
    const wall = Date.now() - t0
    const trace = JSON.parse((await browser.stopTracing()).toString())
    let raster = 0
    for (const e of trace.traceEvents ?? []) {
      if (e.ph === 'X' && RASTER.has(e.name)) raster += (e.dur ?? 0) / 1000
    }
    await browser.close()
    ;(results[v] ??= { wall: [], painted: [], raster: [] }).wall.push(wall)
    results[v].painted.push(painted)
    results[v].raster.push(raster)
  }
}
console.log('variant | median ms to painted (setContent→2 rAF after decode) | median raster+decode+paint ms (trace)')
for (const [v, r] of Object.entries(results)) {
  console.log(`${v} | ${median(r.wall).toFixed(0)} | ${median(r.raster).toFixed(1)}  (runs ${r.wall.length})`)
}
console.log('PERF-JSON ' + JSON.stringify(results))
