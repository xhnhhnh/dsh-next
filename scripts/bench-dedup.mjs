// Local deterministic microbenchmark. No Host, production profile, credentials or model is loaded.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'

const args = {}
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index]
  if (!['--baseline', '--out'].includes(flag) || !process.argv[index + 1]) throw new Error('Usage: node scripts/bench-dedup.mjs --baseline <dedup.js> [--out <report.json>]')
  args[flag.slice(2)] = resolve(process.argv[++index])
}
if (!args.baseline) throw new Error('--baseline must identify an immutable pre-change dedup module')
const current = fileURLToPath(new URL('../lib/dedup.js', import.meta.url))
const nativeClone = globalThis.structuredClone, nativeStringify = JSON.stringify
const sha256 = value => createHash('sha256').update(value).digest('hex')
const counters = () => ({ eventAt: 0, deriveMessage: 0, clones: 0, clonedBodyChars: 0, serializations: 0, serializedChars: 0, positionLookups: 0, replacements: 0 })
const bodyChars = value => {
  const content = Array.isArray(value) ? value : value?.message?.content
  return Array.isArray(content) ? content.reduce((sum, block) => sum + (typeof block?.text === 'string' ? block.text.length : 0), 0) : 0
}

async function fixture(module, { nodes = 128, enabled = true, captures = true } = {}) {
  const handlers = new Map(), definition = {}, events = [], positions = []
  let counts = counters()
  positions.indexOf = function (...values) { counts.positionLookups++; return Array.prototype.indexOf.apply(this, values) }
  positions.includes = function (...values) { counts.positionLookups++; return Array.prototype.includes.apply(this, values) }
  const session = {
    id: 'dedup-benchmark', header: {}, surface: { nodes: positions },
    eventAt(seq) { counts.eventAt++; return events[seq] },
    deriveEventMessage(event) { counts.deriveMessage++; return event.data.message },
    append(type, data, options = {}) {
      const event = { seq: events.length, type, data: nativeClone(data), ...nativeClone(options) }
      if (options.surfaceOp?.op === 'replace') {
        const position = positions.indexOf(options.surfaceOp.startSeq)
        assert.ok(position >= 0)
        positions[position] = event.seq
        counts.replacements++
      } else positions.push(event.seq)
      events.push(event)
      return event
    },
  }
  const agent = { session }, path = 'C:\\next-benchmark\\fixture.txt'
  const ctx = {
    on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); return () => {} },
    tools: { get: () => definition },
    fs: { processPath: () => path, resolve: async () => ({ targetKey: path }), stat: async () => ({ type: 'file', version: 'v1' }) },
  }
  const controller = module.installDedup(ctx, { isEnabled: () => enabled })
  const content = [{ type: 'text', text: 'x'.repeat(16384) }]
  for (let index = 0; index < nodes; index++) {
    const callId = `read-${index}`
    if (captures) {
      const exec = { name: 'read', callId, token: Symbol(callId), agent, arguments: { file_path: path }, signal: new AbortController().signal }
      const result = { value: { path, offset: 1, totalLines: 1, lines: [{ number: 1, text: content[0].text }] }, content: nativeClone(content) }
      const returned = await handlers.get('tools/execute')[0](exec, async () => {
        for (const handler of handlers.get('fs/observed')) handler({ targetKey: path }, { kind: 'present', version: 'v1' }, exec)
        return result
      })
      for (const handler of handlers.get('tools/result')) handler(exec, returned)
    }
    session.append('tool/result', { message: { id: callId, source: { kind: 'tool', callId, name: captures ? 'read' : 'unknown-mcp' }, content } })
  }
  return {
    controller, agent,
    reset: () => { counts = counters() }, counts: () => counts,
    prepare: options => controller.prepareSession(agent, options),
    transcript: () => positions.map(seq => events[seq].data.message.content),
    removeSource: () => positions.shift(),
  }
}

function measure(f, operation, repeats) {
  f.reset()
  globalThis.structuredClone = (value, ...rest) => {
    f.counts().clones++; f.counts().clonedBodyChars += bodyChars(value)
    return nativeClone(value, ...rest)
  }
  JSON.stringify = (...values) => {
    const serialized = nativeStringify(...values)
    f.counts().serializations++; f.counts().serializedChars += serialized?.length ?? 0
    return serialized
  }
  let elapsedMs
  try {
    const started = performance.now()
    for (let index = 0; index < repeats; index++) operation()
    elapsedMs = performance.now() - started
  } finally { globalThis.structuredClone = nativeClone; JSON.stringify = nativeStringify }
  return { repeats, perOperationMs: elapsedMs / repeats, perOperation: Object.fromEntries(Object.entries(f.counts()).map(([key, value]) => [key, value / repeats])), transcriptHash: sha256(nativeStringify(f.transcript())) }
}

async function suite(path) {
  const module = await import(pathToFileURL(path).href), scenarios = {}
  for (const nodes of [100, 500, 1000]) {
    const f = await fixture(module, { nodes, enabled: false, captures: false })
    for (let warm = 0; warm < 5; warm++) f.prepare()
    scenarios[`unknown-off-${nodes}`] = measure(f, () => f.prepare(), 30)
  }
  {
    const f = await fixture(module, { nodes: 1000, captures: false })
    for (let warm = 0; warm < 5; warm++) f.prepare()
    scenarios['unknown-on-1000'] = measure(f, () => f.prepare(), 30)
  }
  {
    const f = await fixture(module)
    assert.equal(f.prepare().shortened, 127)
    for (let warm = 0; warm < 3; warm++) f.prepare()
    scenarios['valid-references-128'] = measure(f, () => f.prepare(), 30)
  }
  {
    const f = await fixture(module)
    assert.equal(f.prepare().shortened, 127)
    scenarios['restore-and-shorten-128'] = measure(f, () => {
      assert.equal(f.prepare({ restoreAll: true }).restored, 127)
      assert.equal(f.prepare().shortened, 127)
    }, 10)
  }
  {
    const f = await fixture(module)
    assert.equal(f.prepare().shortened, 127)
    f.removeSource()
    scenarios['missing-source-restore-128'] = measure(f, () => { assert.equal(f.prepare({ restoreAll: true }).restored, 127) }, 1)
  }
  return { path, sha256: sha256(readFileSync(path)), scenarios }
}

const before = await suite(args.baseline), after = await suite(current)
const comparisons = Object.fromEntries(Object.entries(before.scenarios).map(([name, result]) => {
  assert.equal(after.scenarios[name].transcriptHash, result.transcriptHash, `${name}: optimized and baseline model surfaces differ`)
  return [name, { equivalentSurface: true, timingChangePercent: (after.scenarios[name].perOperationMs / result.perOperationMs - 1) * 100 }]
}))
assert.equal(after.scenarios['unknown-off-1000'].perOperation.clonedBodyChars, 0)
assert.equal(after.scenarios['unknown-off-1000'].perOperation.eventAt, 1000)
const report = { schemaVersion: 1, capturedAt: new Date().toISOString(), runtime: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model }, scope: 'In-process synthetic 16 KiB tool bodies; timing includes operation instrumentation, not end-to-end agent latency.', before, after, comparisons }
if (args.out) writeFileSync(args.out, `${nativeStringify(report, null, 2)}\n`)
console.log(nativeStringify({ report: args.out ?? null, comparisons, operationExample: { before: before.scenarios['unknown-off-1000'], after: after.scenarios['unknown-off-1000'] } }, null, 2))
