// Checks that a served Tracking Script is this source, built unchanged.
//
//   npm run verify -- https://t.foresite.dev/s/s_xxxxxxxxxxxx.js
//   npm run verify -- saved-copy.js
//
// The server sends the built script with one change: the __FORESITE_CONFIG__
// placeholder is replaced by the Site's settings as a JSON object. So the
// served file must be exactly <build before placeholder> + <JSON object> +
// <build after placeholder>, and the object may hold only the known settings.
import { readFile } from 'node:fs/promises'
import { buildScript } from './build.mjs'

const PLACEHOLDER = '__FORESITE_CONFIG__'
const SETTINGS = {
  s: 'Site ID',
  e: 'event endpoint',
  o: 'outbound link clicks on',
  d: 'file downloads on',
  n: '404 pages on',
}

const target = process.argv[2]
if (!target) {
  console.error('usage: npm run verify -- <script URL or file>')
  process.exit(2)
}

const served = /^https?:\/\//.test(target)
  ? await fetch(target).then((r) => {
      if (!r.ok) throw new Error(`${target}: HTTP ${r.status}`)
      return r.text()
    })
  : await readFile(target, 'utf8')

const built = await buildScript()
const [before, after, ...rest] = built.split(PLACEHOLDER)
if (after === undefined || rest.length) throw new Error(`build should contain ${PLACEHOLDER} exactly once`)

const fail = (why) => {
  console.error(`MISMATCH: ${why}`)
  console.error('The served script is not a build of this source. Check you are on the latest commit and ran `npm ci`.')
  process.exit(1)
}

if (!served.startsWith(before)) fail('the start of the served script differs from the build')
if (!served.endsWith(after)) fail('the end of the served script differs from the build')
const middle = served.slice(before.length, served.length - after.length)
let cfg
try {
  cfg = JSON.parse(middle)
} catch {
  fail(`the settings are not plain JSON: ${middle.slice(0, 200)}`)
}
if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) fail('the settings are not a JSON object')
for (const [k, v] of Object.entries(cfg)) {
  if (!(k in SETTINGS)) fail(`unknown setting ${JSON.stringify(k)}`)
  if (typeof v !== 'string' && v !== 1) fail(`setting ${k} has unexpected value ${JSON.stringify(v)}`)
}

console.log('OK: the served script is this build, plus these settings:')
for (const [k, v] of Object.entries(cfg)) console.log(`  ${k} = ${JSON.stringify(v)}  (${SETTINGS[k]})`)
