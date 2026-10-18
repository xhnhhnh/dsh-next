import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { resolve, dirname, basename } from 'node:path'
import { normalizeVerificationChecks, scanProjectChecks, readProjectCommandSnapshot, parseCsv, validateArtifact, ProjectCheckExpiredError } from '../lib/project-checks.js'
import { createVerificationCore, installVerification, runRegisteredCommand } from '../lib/verification.js'

const root = resolve('project-fixture'), digest = text => createHash('sha256').update(text).digest('hex')
const pkg = JSON.stringify({ scripts: { test: 'node --test', build: 'vite build', dev: 'vite', postinstall: 'malicious' } })
const command = { id: 'test', workspace: root, kind: 'command', command: "npm.cmd run 'test'", timeoutMs: 1000, bindings: [{ file: 'package.json', sha256: digest(pkg) }] }
const artifact = { id: 'csv', workspace: root, kind: 'artifact', file: 'report.csv', format: 'csv', requiredColumns: ['name', 'count'] }
const signal = () => new AbortController().signal
function host({ checks = [command], shell = async () => ({ cwd: root, kind: 'foreground', exitCode: 0, timedOut: false, aborted: false, signal: null }), enabled = true } = {}) {
  const handlers = new Map(), definitions = new Map(), executions = [], records = []
  const rows = new Map([[root, { type: 'directory', version: 'root' }], [resolve(root, 'package.json'), { type: 'file', version: '1', content: pkg }], [resolve(root, 'report.csv'), { type: 'file', version: '1', content: 'name,count\nAlice,2' }]])
  const agent = { id: 'agent-one', depth: 0, session: { id: 'session-one', header: { cwd: root } } }
  let active = enabled, denyRead, replaceShell = false
  const emit = async (name, ...args) => { for (const handler of [...(handlers.get(name) ?? [])]) await handler(...args) }
  const ctx = {
    on(name, fn, options = {}) { const list = handlers.get(name) ?? []; options.prepend ? list.unshift(fn) : list.push(fn); handlers.set(name, list); return () => list.splice(list.indexOf(fn), 1) },
    workingDirectory: { ensure: async current => current.session.header.cwd }, logger: { warn() {} },
    fs: { resolve: async (file, { cwd = root } = {}) => ({ targetKey: resolve(cwd, file) }), processPath: target => target.targetKey,
      stat: async target => { const row = rows.get(target.targetKey); return row && { type: row.type, version: row.version, size: Buffer.byteLength(row.content ?? '') } },
      listDir: async target => [...rows].filter(([path]) => path !== target.targetKey && dirname(path) === target.targetKey).map(([path, row]) => ({ name: basename(path), type: row.type, target: { targetKey: path }, version: row.version })) },
    tools: {
      get: name => definitions.get(name), register(value) { definitions.set(value.name, value); return () => definitions.delete(value.name) },
      async execute(input) {
        executions.push(input)
        const exec = { ...input, token: Symbol(input.callId) }, hooks = [...(handlers.get('tools/execute') ?? [])]
        const dispatch = async index => index < hooks.length ? hooks[index](exec, () => dispatch(index + 1))
          : { isError: false, value: await definitions.get(input.name).execute(input.arguments, exec) }
        let result
        if (input.name === 'read' && input.arguments.file_path === denyRead) result = { isError: true }
        else result = await dispatch(0)
        if (replaceShell && input.name === 'pwsh') result = { ...result, value: { ...result.value, exitCode: 0, injected: true } }
        await emit('tools/result', exec, result)
        return result
      },
    },
  }
  definitions.set('read', { async execute(args, exec) {
    const row = rows.get(args.file_path), text = row.content.replace(/\r\n/g, '\n').replace(/\n$/, ''), lines = row.content === '' ? [] : text.split('\n')
    await emit('fs/observed', { targetKey: args.file_path }, { kind: 'present', version: row.version }, exec)
    return { path: args.file_path, offset: args.offset, totalLines: lines.length, lines: lines.slice(args.offset - 1, args.offset - 1 + args.limit).map((text, index) => ({ number: args.offset + index, text })) }
  } })
  definitions.set('pwsh', { execute: shell }); definitions.set('job_kill', { execute: async args => ({ outcome: 'cancellation-requested', job: { id: args.job_id } }) })
  definitions.set('write', {}); definitions.set('edit', {})
  const controller = installVerification(ctx, { defineTool: value => value, createUserMessage: value => value, getChecks: () => checks,
    isEnabled: () => active, autoEnabled: () => true, onRecord: value => records.push(value) })
  const exec = () => ({ agent, callId: `call-${executions.length}`, token: Symbol(), signal: signal() })
  const run = (args = {}, current = agent) => ctx.tools.execute({ name: 'next_verify', callId: `verify-${executions.length}`, arguments: { check_id: checks[0].id, ...args }, agent: current, signal: signal() })
  return { ctx, agent, rows, definitions, executions, records, controller, run, exec, emit, setEnabled: value => { active = value }, denyRead: value => { denyRead = value }, replaceShell: () => { replaceShell = true },
    async mutate(file = 'src/App.jsx') {
      const exec = { agent, name: 'write', callId: 'edit', token: Symbol(), signal: signal() }, path = resolve(root, file)
      await emit('fs/observed', { targetKey: path }, { kind: 'present', version: 'new' }, exec)
      await emit('tools/result', exec, { value: { path } })
    },
    async step() {
      const hooks = [...(handlers.get('agent/pre-step') ?? [])]
      const dispatch = index => index < hooks.length ? hooks[index]({ agent, signal: signal() }, () => dispatch(index + 1)) : { kind: 'enter', messages: [] }
      return dispatch(0)
    },
  }
}

test('new registrations validate bounds, exact bindings, types and paths while preserving old JSON forms', () => {
  assert.equal(normalizeVerificationChecks([command, artifact, { id: 'old', workspace: root, kind: 'json-syntax', file: 'data.json' }]).length, 3)
  assert.equal(normalizeVerificationChecks([{ id: 'old', workspace: root, kind: 'json-syntax', file: 'data.json', bindings: [], requiredColumns: [], requiredText: [], format: undefined }]).length, 1)
  for (const check of [{ ...command, timeoutMs: 999 }, { ...command, timeoutMs: 120001 }, { ...command, bindings: [] },
    { ...command, bindings: [{ file: '../package.json', sha256: digest(pkg) }] }, { ...command, bindings: [{ file: 'package.json', sha256: 'invalid' }] },
    { ...artifact, format: 'docx' }, { ...artifact, file: '../report.csv' }, { ...artifact, requiredText: ['x'] }, { ...artifact, requiredColumns: [1] }]) assert.throws(() => normalizeVerificationChecks([check]))
})

test('project scan only proposes registered script names and obtains real bindings using native read dispatch', async () => {
  const h = host(); h.rows.set(resolve(root, 'pnpm-lock.yaml'), { type: 'file', version: '2', content: 'lockfileVersion: 9\r\n' })
  const scan = await scanProjectChecks(h.ctx, { agent: h.agent, workspace: root, signal: signal() })
  assert.deepEqual(scan.candidates.map(value => value.id), ['project-test', 'project-build'])
  assert.deepEqual(scan.bindings, [{ file: 'package.json', sha256: digest(pkg) }, { file: 'pnpm-lock.yaml', sha256: digest('lockfileVersion: 9') }])
  assert.match(scan.candidates[0].check.command, /pnpm/)
  assert.ok(h.executions.every(exec => exec.name === 'read'), 'scan never executes commands')
  assert.ok(normalizeVerificationChecks(scan.candidates.map(item => item.check)))
  h.denyRead(resolve(root, 'package.json'))
  await assert.rejects(scanProjectChecks(h.ctx, { agent: h.agent, workspace: root, signal: signal() }))
})

test('script changes and newly added or removed lock files expire command registration before execution', async () => {
  for (const change of [h => { h.rows.get(resolve(root, 'package.json')).content = pkg + ' ' },
    h => h.rows.set(resolve(root, 'package-lock.json'), { type: 'file', version: '2', content: '{}' })]) {
    const h = host(); change(h)
    assert.equal((await h.run()).value.status, 'expired')
    assert.equal(h.executions.filter(exec => exec.name === 'pwsh').length, 0)
    assert.equal((await h.controller.checkStatus(h.agent)).checks[0].status, 'expired')
  }
  const registered = { ...command, bindings: [...command.bindings, { file: 'package-lock.json', sha256: digest('{}') }] }, h = host({ checks: [registered] })
  await assert.rejects(readProjectCommandSnapshot(h.ctx, registered, h.exec(), 1024), ProjectCheckExpiredError)
})

test('commands execute every time, preserve native parent identity and collect real exit status', async () => {
  let calls = 0
  const h = host({ shell: async () => ({ cwd: root, exitCode: ++calls === 3 ? 2 : 0, timedOut: false, aborted: false, signal: null }) })
  assert.equal((await h.run()).value.status, 'executed')
  assert.equal((await h.run()).value.status, 'executed')
  assert.equal((await h.run()).value.status, 'failed')
  assert.equal(calls, 3)
  const shellExec = h.executions.find(exec => exec.name === 'pwsh')
  assert.ok(shellExec.parent); assert.equal(shellExec.arguments.workdir, root); assert.equal(shellExec.arguments.run_in_background, false)
  assert.equal(shellExec.arguments.sandbox_permissions, undefined)
})

test('running jobs, interruption, policy denial and output replacement are never passing receipts', async () => {
  const promoted = host({ shell: async () => ({ cwd: root, kind: 'promoted', jobId: 'pwsh-owned' }) })
  assert.equal((await promoted.run()).value.status, 'unknown')
  assert.equal(promoted.executions.find(exec => exec.name === 'job_kill').arguments.job_id, 'pwsh-owned')
  for (const value of [{ exitCode: 0, timedOut: true }, { exitCode: 0, aborted: true }, { exitCode: null }, { exitCode: 0, sandbox: { denied: true } }]) {
    const h = host({ shell: async () => ({ cwd: root, ...value }) }); assert.equal((await h.run()).value.passed, null)
  }
  const replaced = host(); replaced.replaceShell(); assert.equal((await replaced.run()).value.status, 'unknown')
  const replacedHandle = host({ shell: async () => ({ cwd: root, kind: 'promoted', jobId: 'original-job' }) })
  replacedHandle.ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    return exec.name === 'pwsh' ? { ...result, value: { ...result.value, jobId: 'unrelated-job' } } : result
  }, { prepend: true })
  assert.equal((await replacedHandle.run()).value.status, 'unknown')
  assert.equal(replacedHandle.executions.find(exec => exec.name === 'job_kill').arguments.job_id, 'original-job', 'cleanup uses the owned dispatch handle rather than a replaced final handle')
})

test('command deadline aborts the owned native execution and cancellation starts no execution', async () => {
  let wasAborted = false
  const h = host({ shell: (_args, exec) => new Promise((resolve, reject) => exec.signal.addEventListener('abort', () => { wasAborted = true; reject(exec.signal.reason) }, { once: true })) })
  assert.equal((await h.run()).value.status, 'unknown'); assert.equal(wasAborted, true)
  const controller = new AbortController(); controller.abort()
  const before = h.executions.length
  await assert.rejects(runRegisteredCommand(h.ctx, command, { ...h.exec(), signal: controller.signal }))
  assert.equal(h.executions.length, before)
})

test('commands are unavailable when NEXT is off, tool missing, read denied or called by child agents', async () => {
  const h = host(); h.setEnabled(false); assert.equal((await h.run()).value.status, 'unknown'); h.setEnabled(true)
  assert.equal((await h.run({}, { ...h.agent, depth: 1 })).value.status, 'unknown')
  h.denyRead(resolve(root, 'package.json')); assert.equal((await h.run()).value.status, 'unknown'); h.denyRead(null)
  h.definitions.delete('pwsh'); assert.equal((await h.run()).value.status, 'unknown')
  assert.equal((await h.controller.checkStatus(h.agent)).checks[0].status, 'unavailable')
})

test('unknown or oversized source metadata scope stops command execution instead of claiming full coverage', async () => {
  const missing = host(); delete missing.ctx.fs.listDir
  assert.equal((await missing.run()).value.status, 'unknown')
  assert.equal(missing.executions.filter(exec => exec.name === 'pwsh').length, 0)
  const large = host()
  for (let index = 0; index < 2001; index += 1) large.rows.set(resolve(root, `source-${index}.js`), { type: 'file', version: 'one', content: 'x' })
  assert.equal((await large.run()).value.status, 'unknown')
  assert.equal(large.executions.filter(exec => exec.name === 'pwsh').length, 0)
})

test('mutations during a command expire its result instead of publishing a stale pass', async () => {
  let h
  h = host({ shell: async () => { await h.mutate(); return { cwd: root, exitCode: 0 } } })
  const result = await h.run()
  assert.equal(result.value.status, 'expired'); assert.equal(result.value.passed, null)
  let external
  external = host({ shell: async () => { external.rows.get(resolve(root, 'report.csv')).version = 'changed-externally'; return { cwd: root, exitCode: 0 } } })
  assert.equal((await external.run()).value.status, 'expired', 'external source version changes are observed without a native edit event')
  let build
  build = host({ shell: async () => { build.rows.get(resolve(root, 'dist/generated.js')).version = 'generated'; return { cwd: root, exitCode: 0 } } })
  build.rows.set(resolve(root, 'dist'), { type: 'directory', version: 'dist' }); build.rows.set(resolve(root, 'dist/generated.js'), { type: 'file', version: 'old', content: 'output' })
  assert.equal((await build.run()).value.status, 'executed', 'conventional build outputs do not invalidate source scope')
})

test('continuous edits coalesce to one workspace command and one notice, with no self-triggering loop', async () => {
  const h = host(); await h.mutate(); await h.mutate('src/style.css')
  const step = await h.step()
  assert.equal(h.executions.filter(exec => exec.name === 'pwsh').length, 1)
  assert.equal(step.messages.length, 1); assert.match(step.messages[0].content[0].text, /Unchanged accepted artifact/)
  await h.step(); assert.equal(h.executions.filter(exec => exec.name === 'pwsh').length, 1)
  await h.emit('tools/result', { name: 'pwsh', agent: h.agent, callId: 'external-shell' }, { value: { exitCode: 0 } })
  assert.equal(h.controller.reports(h.agent)[0].status, 'expired')
  await h.step(); assert.equal(h.executions.filter(exec => exec.name === 'pwsh').length, 1)
})

test('CSV validates quoted cells, multiline escaped quotes, BOM, trailing newline and inconsistent widths', () => {
  assert.deepEqual(parseCsv('\uFEFFname,note\r\n"A, B","line 1\nline ""2"""\r\n'), [['name', 'note'], ['A, B', 'line 1\nline "2"']])
  for (const text of ['', 'a,b\n1', 'a,b\n1,2,3', 'a\n"unclosed', 'a\n"x"tail', 'a\nx"y']) assert.throws(() => parseCsv(text))
  assert.deepEqual(validateArtifact(artifact, 'name,count\nAlice,2'), [])
  assert.match(validateArtifact(artifact, 'name,other\nAlice,2')[0], /column/)
})

test('artifact JSON/Markdown validate actual content, artifact receipts obey policy and input identity', async () => {
  assert.equal(validateArtifact({ format: 'json' }, '{').length, 1)
  assert.deepEqual(validateArtifact({ format: 'json' }, '\uFEFF{"ok":true}'), [])
  assert.equal(validateArtifact({ format: 'markdown', requiredText: ['# Result'] }, 'other').length, 1)
  assert.equal(validateArtifact({ format: 'markdown' }, ' \n').length, 1)
  const h = host({ checks: [artifact] })
  assert.equal((await h.run()).value.status, 'executed'); assert.equal((await h.run()).value.status, 'reused')
  h.rows.get(resolve(root, 'report.csv')).content = 'name,count\nAlice'
  assert.equal((await h.run()).value.status, 'failed')
  h.denyRead(resolve(root, 'report.csv')); assert.equal((await h.run()).value.status, 'unknown')
})

test('artifact validator settings participate in receipt fingerprint, and artifact scheduling is file-specific', async () => {
  const checks = [{ ...artifact }], h = host({ checks })
  assert.equal((await h.run()).value.passed, true)
  checks[0] = { ...artifact, requiredColumns: ['missing'] }
  assert.equal((await h.run()).value.status, 'failed')
  const count = h.records.length
  await h.mutate('other.csv'); await h.step(); assert.equal(h.records.length, count)
  await h.mutate('report.csv'); await h.step(); assert.equal(h.records.length, count + 1)
})

test('new controller never restores command evidence as cached execution', async () => {
  let runs = 0
  const options = { isEnabled: () => true, getChecks: () => [command], readSnapshot: async () => ({ workspace: root, file: root, target: root, version: 'one', content: 'bound' }), runCommand: async () => { runs += 1; return { passed: true, detail: 'exit code 0' } } }
  const agent = { session: { id: 'same' } }
  for (let i = 0; i < 2; i += 1) {
    const core = createVerificationCore(options), exec = { agent, callId: String(i), token: Symbol(), signal: signal() }
    const value = await core.verify({ check_id: 'test' }, exec); core.settle(exec, { value })
    assert.equal(value.status, 'executed')
  }
  assert.equal(runs, 2)
})
