import { spawn } from 'node:child_process'
import { join } from 'node:path'
const desktop = join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness')
const child = spawn(join(desktop, 'DeepSeek Harness.exe'), ['--expose-internals', join(desktop, 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'), ...process.argv.slice(2)], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE:'1' }, windowsHide:true, stdio:['ignore','pipe','pipe'],
})
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
child.on('error', error => { console.error(error.message); process.exitCode=1 })
child.on('close', code => { process.exitCode=code ?? 1 })
