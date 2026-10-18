import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readVerificationSnapshot } from './verification.js'

const hash = text => createHash('sha256').update(text).digest('hex')
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) }
const lockFiles = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']
const scriptNames = ['test', 'typecheck', 'check', 'lint', 'build']
const safeRelative = (workspace, file) => typeof file === 'string' && file.trim() !== '' && !file.includes('\0') && !isAbsolute(file) && inside(workspace, resolve(workspace, file))
const stringList = value => Array.isArray(value) && value.length <= 64 && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 512)
export class ProjectCheckExpiredError extends Error {}

/** Registrations contain exact command and input bindings; nothing is auto-registered. */
export function normalizeVerificationChecks(input = []) {
  if (!Array.isArray(input) || input.length > 64) throw new TypeError('NEXT verification checks must be a bounded array.')
  const ids = new Set()
  return input.map(check => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) throw new TypeError('Invalid NEXT verification check.')
    // The native schema materializes optional array fields as []; disregard only those inert defaults.
    check = Object.fromEntries(Object.entries(check).filter(([key, value]) => value !== undefined && !(
      Array.isArray(value) && value.length === 0 && ((key === 'bindings' && check.kind !== 'command')
        || (key === 'requiredColumns' && !(check.kind === 'artifact' && check.format === 'csv'))
        || (key === 'requiredText' && !(check.kind === 'artifact' && check.format === 'markdown'))))))
    if (typeof check.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(check.id) || ids.has(check.id)) throw new TypeError('NEXT verification check ids must be unique identifiers.')
    ids.add(check.id)
    if (typeof check.workspace !== 'string' || !isAbsolute(check.workspace) || check.workspace.includes('\0')) throw new TypeError('NEXT verification workspace must be absolute.')
    const workspace = resolve(check.workspace), base = { id: check.id, workspace, kind: check.kind }
    let keys, value
    if (check.kind === 'command') {
      keys = ['id', 'workspace', 'kind', 'command', 'timeoutMs', 'bindings']
      if (typeof check.command !== 'string' || check.command.trim() === '' || check.command.length > 16384 || check.command.includes('\0')
        || !Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1000 || check.timeoutMs > 120000
        || !Array.isArray(check.bindings) || check.bindings.length < 1 || check.bindings.length > 16) throw new TypeError('Invalid registered NEXT command or timeout.')
      const seen = new Set()
      const bindings = check.bindings.map(binding => {
        if (!binding || Object.keys(binding).some(key => !['file', 'sha256'].includes(key)) || !safeRelative(workspace, binding.file)
          || !/^[a-f0-9]{64}$/.test(binding.sha256) || seen.has(resolve(workspace, binding.file))) throw new TypeError('Invalid NEXT command file binding.')
        seen.add(resolve(workspace, binding.file))
        return Object.freeze({ file: binding.file, sha256: binding.sha256 })
      })
      if (!bindings.some(binding => binding.file === 'package.json')) throw new TypeError('NEXT command registration must bind package.json.')
      value = { ...base, command: check.command, timeoutMs: check.timeoutMs, bindings: Object.freeze(bindings) }
    } else if (check.kind === 'artifact') {
      keys = ['id', 'workspace', 'kind', 'file', 'format', 'requiredColumns', 'requiredText']
      if (!safeRelative(workspace, check.file) || !['csv', 'json', 'markdown'].includes(check.format)
        || (check.requiredColumns !== undefined && (check.format !== 'csv' || !stringList(check.requiredColumns)))
        || (check.requiredText !== undefined && (check.format !== 'markdown' || !stringList(check.requiredText)))) throw new TypeError('Invalid NEXT artifact registration.')
      value = { ...base, file: check.file, format: check.format,
        ...(check.requiredColumns === undefined ? {} : { requiredColumns: Object.freeze([...check.requiredColumns]) }),
        ...(check.requiredText === undefined ? {} : { requiredText: Object.freeze([...check.requiredText]) }) }
    } else if (['json-syntax', 'json-schema'].includes(check.kind)) {
      keys = ['id', 'workspace', 'kind', 'file', 'schemaFile']
      if (!safeRelative(workspace, check.file) || (check.kind === 'json-schema' ? !safeRelative(workspace, check.schemaFile) : check.schemaFile !== undefined)) throw new TypeError('NEXT verification files must stay inside their registered workspace.')
      value = { ...base, file: check.file, ...(check.schemaFile === undefined ? {} : { schemaFile: check.schemaFile }) }
    } else throw new TypeError('Unsupported NEXT verification kind.')
    if (Object.keys(check).some(key => !keys.includes(key))) throw new TypeError('Invalid NEXT verification check field.')
    return Object.freeze(value)
  })
}

async function existingLocks(ctx, workspace, signal) {
  const found = []
  for (const file of lockFiles) {
    signal?.throwIfAborted()
    const target = await ctx.fs.resolve(file, { cwd: workspace, signal })
    if (!inside(workspace, ctx.fs.processPath(target))) throw new Error('Project lock path escapes its workspace.')
    const stat = await ctx.fs.stat(target, signal)
    if (stat?.type === 'file') found.push(file)
    else if (stat !== undefined && stat !== null && stat.type !== 'missing') throw new Error('Project lock path cannot be inspected.')
  }
  return found
}

/** A scan reads through native read policy, never executes scripts and never installs dependencies. */
export async function scanProjectChecks(ctx, { agent, workspace, signal }) {
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw new TypeError('NEXT project scan workspace must be absolute.')
  const exec = { agent, signal, callId: randomUUID() }, files = ['package.json', ...await existingLocks(ctx, resolve(workspace), signal)]
  const snapshots = []
  for (const file of files) snapshots.push(await readVerificationSnapshot(ctx, { id: 'project-scan', workspace, kind: 'json-syntax', file }, exec))
  const canonical = snapshots[0].workspace, pkg = JSON.parse(snapshots[0].content.replace(/^\uFEFF/, ''))
  const bindings = snapshots.map((snapshot, index) => ({ file: files[index], sha256: hash(snapshot.content) }))
  const manager = files.includes('pnpm-lock.yaml') ? 'pnpm' : files.includes('yarn.lock') ? 'yarn' : 'npm'
  // Shell syntax is selected from the actual native capability. Paths travel as workdir, never interpolated.
  const pwsh = Boolean(ctx.tools.get('pwsh', agent)), executable = pwsh && process.platform === 'win32' ? `${manager}.cmd` : manager
  const candidates = scriptNames.filter(name => typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].trim()).map(name => {
    const command = pwsh ? `& '${executable}' run '${name}'; exit $LASTEXITCODE` : `${executable} run '${name}'`
    return { id: `project-${name}`, label: `${manager} run ${name}`, check: { id: `project-${name}`, workspace: canonical, kind: 'command', command, timeoutMs: 120000, bindings } }
  })
  return { workspace: canonical, candidates, bindings }
}

export async function readProjectCommandSnapshot(ctx, check, exec, maxBytes) {
  const currentLocks = await existingLocks(ctx, check.workspace, exec.signal)
  const registeredLocks = check.bindings.filter(binding => lockFiles.includes(binding.file)).map(binding => binding.file)
  if (JSON.stringify(currentLocks.slice().sort()) !== JSON.stringify(registeredLocks.slice().sort())) throw new ProjectCheckExpiredError('Project lock files changed; review and register this command again.')
  const inputs = []
  for (const binding of check.bindings) {
    const target = await ctx.fs.resolve(binding.file, { cwd: check.workspace, signal: exec.signal })
    if (await ctx.fs.stat(target, exec.signal) === undefined) throw new ProjectCheckExpiredError('A registered script or dependency file was removed; review and register this command again.')
    let snapshot
    try { snapshot = await readVerificationSnapshot(ctx, { ...check, kind: 'json-syntax', file: binding.file }, exec, maxBytes) }
    catch (error) { throw error }
    if (hash(snapshot.content) !== binding.sha256) throw new ProjectCheckExpiredError('A registered script or dependency binding changed; review and register this command again.')
    inputs.push({ file: snapshot.file, target: snapshot.target, version: snapshot.version, sha256: binding.sha256 })
  }
  const sources = await readProjectSourceVersions(ctx, check.workspace, exec.signal)
  return { workspace: check.workspace, file: check.workspace, target: hash(JSON.stringify(inputs.map(input => input.target))),
    version: hash(JSON.stringify(inputs.map(input => input.version))), content: JSON.stringify({ command: check.command, timeoutMs: check.timeoutMs, inputs, sources }) }
}

const excludedSourceDirectories = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.cache', '.turbo', '.vite', 'out', 'target'])
/** Metadata-only source scope, bounded and collected afresh before/after each actual command. */
export async function readProjectSourceVersions(ctx, workspace, signal) {
  if (typeof ctx.fs.listDir !== 'function') throw new Error('Native project source enumeration is unavailable.')
  const sources = [], visited = new Set(), queue = [{ target: await ctx.fs.resolve(workspace, { signal }), depth: 0 }]
  let directories = 0
  while (queue.length) {
    signal?.throwIfAborted()
    const { target, depth } = queue.shift(), directory = ctx.fs.processPath(target)
    if (!isAbsolute(directory) || !inside(workspace, directory) || depth > 32 || visited.has(target.targetKey) || ++directories > 256) throw new Error('Project source enumeration is unsafe or exceeds its directory limit.')
    visited.add(target.targetKey)
    const entries = await ctx.fs.listDir(target, signal)
    if (!Array.isArray(entries) || entries.length > 4000) throw new Error('Project source enumeration exceeds its entry limit.')
    for (const entry of entries) {
      signal?.throwIfAborted()
      if (entry.type === 'directory' && excludedSourceDirectories.has(String(entry.name).toLowerCase())) continue
      if (/\.tsbuildinfo$|\.log$/i.test(entry.name)) continue
      const file = ctx.fs.processPath(entry.target)
      if (!isAbsolute(file) || !inside(workspace, file)) throw new Error('Project source enumeration escaped the registered workspace.')
      if (entry.type === 'directory') queue.push({ target: entry.target, depth: depth + 1 })
      else if (entry.type === 'file') {
        if (sources.length >= 2000) throw new Error('Project source enumeration exceeds its file limit.')
        const stat = await ctx.fs.stat(entry.target, signal)
        if (stat?.type !== 'file' || typeof stat.version !== 'string') throw new Error('Project source changed while its metadata was being observed.')
        sources.push({ file: relative(workspace, file), target: entry.target.targetKey, version: stat.version })
      } else throw new Error('Project source contains an unsupported file entry.')
    }
  }
  return sources.sort((a, b) => a.file.localeCompare(b.file))
}

export async function inspectProjectCheckStatus(ctx, check, { agent, signal }) {
  if (!ctx.tools.get('read', agent)) return { id: check.id, kind: check.kind, status: 'unavailable', reason: 'Native read capability is unavailable.' }
  if (check.kind === 'command' && !ctx.tools.get('pwsh', agent) && !ctx.tools.get('bash', agent)) return { id: check.id, kind: check.kind, status: 'unavailable', reason: 'Native command capability is unavailable.' }
  try {
    if (check.kind === 'command') await readProjectCommandSnapshot(ctx, check, { agent, signal, callId: randomUUID() }, 1024 * 1024)
    else await readVerificationSnapshot(ctx, check, { agent, signal, callId: randomUUID() })
    return { id: check.id, kind: check.kind, status: 'ready', reason: 'Current registered inputs and native capabilities are available.' }
  } catch (error) { return { id: check.id, kind: check.kind, status: error instanceof ProjectCheckExpiredError ? 'expired' : 'unavailable', reason: error instanceof ProjectCheckExpiredError ? error.message : 'Current project inputs could not be safely observed.' } }
}

/** RFC 4180 style parsing, including escaped quotes, embedded newlines and BOM. */
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '')
  const rows = [], row = []
  let cell = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1 } else { quoted = false; closed = true } }
      else cell += char
    } else if (char === '"') {
      if (cell !== '' || closed) throw new Error('CSV quotes must begin a field.')
      quoted = true
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell); cell = ''; closed = false
      if (char !== ',') { rows.push(row.splice(0)); if (char === '\r' && text[i + 1] === '\n') i += 1 }
    } else { if (closed) throw new Error('CSV has data after a closing quote.'); cell += char }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.')
  if (cell !== '' || row.length || closed) { row.push(cell); rows.push(row.splice(0)) }
  if (!rows.length || !rows[0].length || rows[0].every(cell => cell.trim() === '')) throw new Error('CSV has no header.')
  if (rows.some(row => row.length !== rows[0].length)) throw new Error('CSV rows have inconsistent column counts.')
  return rows
}

export function validateArtifact(check, content) {
  try {
    if (check.format === 'json') JSON.parse(content.replace(/^\uFEFF/, ''))
    if (check.format === 'markdown') {
      if (content.trim() === '') return ['Markdown artifact is empty.']
      const missing = (check.requiredText ?? []).filter(text => !content.includes(text))
      if (missing.length) return missing.map(text => `Markdown is missing required text: ${text}`)
    }
    if (check.format === 'csv') {
      const rows = parseCsv(content), missing = (check.requiredColumns ?? []).filter(column => !rows[0].includes(column))
      if (missing.length) return missing.map(column => `CSV is missing a required column: ${column}`)
    }
    return []
  } catch (error) { return [check.format === 'csv' ? error.message : 'Artifact is not valid JSON.'] }
}
