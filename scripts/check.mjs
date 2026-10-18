import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
for (const dir of ['lib', 'scripts']) {
  for (const name of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(n => /\.[cm]?js$/.test(n))) {
    const file = new URL(`../${dir}/${name}`, import.meta.url)
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(file)], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`)
  }
}
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
if (manifest.name !== '@local/dsh-next' || !manifest.dsh?.bundle?.patch || !manifest.dsh?.client) throw new Error('Missing plugin manifest faces')
console.log('Syntax and plugin manifest passed.')
