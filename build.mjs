// Bundles and minifies the Tracking Script into one file (`npm run build`
// type-checks src/ first). The tests and verify.mjs import buildOptions, so they check
// exactly the bytes this build produces.
//
//   node build.mjs                      writes dist/foresite.js
//   node build.mjs --outfile=path.js    writes path.js instead
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))

export const buildOptions = {
  entryPoints: [resolve(here, 'src/foresite.ts')],
  bundle: true,
  minify: true,
  target: 'es2017',
  format: 'iife',
  logLevel: 'warning',
}

// Returns the built script as a string, without writing anything.
export async function buildScript() {
  const result = await build({ ...buildOptions, write: false })
  return result.outputFiles[0].text
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--outfile='))
  const outfile = arg ? resolve(arg.slice('--outfile='.length)) : resolve(here, 'dist/foresite.js')
  await build({ ...buildOptions, outfile })
  console.log(`wrote ${outfile}`)
}
