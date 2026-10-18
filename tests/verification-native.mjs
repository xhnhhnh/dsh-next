// Explicit, credential-free native alpha.5 guard regression. Run with the installed Electron node runtime.
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installVerification } from '../lib/verification.js'

const runtime = process.env.DSH_VERIFICATION_NATIVE_RUNTIME
if (!runtime) throw new Error('DSH_VERIFICATION_NATIVE_RUNTIME must identify the installed native runtime.')
const native = name => import(pathToFileURL(join(runtime, '@deepseek-ai', name, 'lib/index.js')))
const { Context } = await native('cordis')
const tools = await native('dsh-tools')
const fileTools = await native('dsh-tool-fs')
const ctx = new Context(), root = resolve('native-verification-fixture')
const input = join(root, 'input.json'), schema = join(root, 'schema.json')
const rows = new Map([[input, '{"count":2}'], [schema, '{"type":"object","properties":{"count":{"type":"integer"}},"required":["count"],"additionalProperties":false}']])
let reads = 0, deniedPath = null, bypass = false
ctx.provide('systemPrompt', { tools() {}, section() {}, getSectionOrder() { return 1 } })
ctx.provide('fs', {
  async resolve(path, { cwd = root } = {}) { return { targetKey: resolve(cwd, path), displayPath: resolve(cwd, path) } },
  processPath: target => target.targetKey,
  async stat(target) { return target.targetKey === root ? { type: 'directory', version: 'dir-v1' }
    : rows.has(target.targetKey) ? { type: 'file', version: 'file-v1', size: Buffer.byteLength(rows.get(target.targetKey)) } : undefined },
  async readText(target) { reads += 1; return rows.get(target.targetKey) },
})
ctx.provide('workingDirectory', { ensure: async () => root })
await ctx.plugin(tools.ToolRuntime, { mode: 'native' })
await ctx.plugin(fileTools, { read: true, readImage: false, write: false, edit: false })
const agent = { id: 'native-check', session: { id: 'native-check', header: { cwd: root } } }
const guardSeen = []
ctx.tools.guard(exec => {
  if (exec.name === 'read') {
    guardSeen.push(exec.arguments.file_path)
    if (exec.arguments.file_path === deniedPath) return 'Explicit read-path denial for native NEXT regression.'
  }
})
let controller
await ctx.plugin({ name: 'verification-under-test', inject: ['tools', 'fs', 'workingDirectory'], apply(own) {
  controller = installVerification(own, { defineTool: tools.defineTool, assertSupportedJsonSchema: tools.assertSupportedJsonSchema,
    validateJsonSchemaValue: tools.validateJsonSchemaValue, isEnabled: () => true, autoEnabled: () => true,
    getChecks: () => [{ id: 'config', workspace: root, kind: 'json-schema', file: 'input.json', schemaFile: 'schema.json' }],
  })
} })
let index = 0
const run = async () => {
  const result = await ctx.tools.execute({ name: 'next_verify', callId: `verification-${++index}`, arguments: { check_id: 'config' }, agent, signal: new AbortController().signal })
  assert.equal(result.isError, false)
  return result.value
}
assert.equal((await run()).status, 'executed')
assert.equal((await run()).status, 'reused')
for (const path of [input, schema]) {
  deniedPath = path
  const before = reads
  const value = await run()
  assert.equal(value.status, 'unknown'); assert.equal(value.passed, null)
  if (path === input && reads !== before) bypass = true
  assert.equal(bypass, false, 'a denied native input read must never execute the fs body')
  assert.ok(guardSeen.includes(path))
  deniedPath = null
  assert.equal((await run()).status, 'reused')
}
const redact = ctx.on('tools/post-execute', (exec, _result, next) => exec.name === 'read' && exec.arguments.file_path === input
  ? Promise.resolve({ kind: 'accept', content: [{ type: 'text', text: 'Redacted by current policy.' }] }) : next(), { global: true })
assert.equal((await run()).status, 'unknown', 'read presentation redaction must not be bypassed through the canonical value')
redact()
controller.dispose()
console.log(JSON.stringify({ status: 'Pass', nativeVersion: '0.2.1-alpha.5', checks: ['native-output-contract', 'native-input-read-guard', 'native-schema-read-guard', 'cached-receipt-reauthorization', 'denial-is-unknown', 'post-policy-redaction-is-unknown'], guardCalls: guardSeen.length, reads }))
await ctx.fiber.dispose()
