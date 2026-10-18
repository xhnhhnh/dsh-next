// Runs only local commands and native filesystem tools. No credentials or model adapter are loaded.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = resolve(repo, '..');
const parsed = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (key === '--help') parsed.help = true;
  else if (key === '--adaptive') parsed.adaptive = true;
  else if (key === '--automation') parsed.automation = true;
  else if (key === '--parallel') { parsed.parallel = true; parsed.automation = true; }
  else if (key === '--switches') { parsed.switches = true; parsed.parallel = true; parsed.automation = true; }
  else if (key === '--model-policies') parsed.modelPolicies = true;
  else if (key === '--production') parsed.production = true;
  else if (['--desktop', '--out', '--timeout-ms'].includes(key)) {
    const value = process.argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    parsed[key.slice(2)] = value;
  } else throw new Error(`Unknown option ${key}`);
}
if (parsed.help) {
  console.log('node scripts/run-native-smoke.mjs [--desktop <installed-app-dir>] [--out <new-directory-under-work>] [--timeout-ms 90000]');
  process.exit(0);
}
const desktop = resolve(parsed.desktop ?? join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness'));
const executable = join(desktop, 'DeepSeek Harness.exe');
const runtime = join(desktop, 'resources/app.asar/dsh/node_modules');
const cli = join(runtime, '@deepseek-ai/dsh-desktop-host/lib/cli.js');
const output = resolve(parsed.out ?? join(work, 'native-smoke', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`));
const rel = relative(work, output);
if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || resolve(work, rel) !== output) throw new Error('Output must be a new directory strictly inside work/');
if (existsSync(output)) throw new Error('Output directory already exists; use a fresh directory');
if (!existsSync(executable)) throw new Error(`Installed desktop executable not found: ${executable}`);
const timeoutMs = Number(parsed['timeout-ms'] ?? 90000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('timeout-ms must be 1000..300000');
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
mkdirSync(output, { recursive: true });
const home = join(output, 'dsh-home');
const workspace = join(output, 'workspace');
const snapshot = join(output, 'next-package');
const driver = join(output, 'native-smoke.mjs');
for (const path of [home, workspace, snapshot]) mkdirSync(path, { recursive: true });
for (const name of ['package.json', 'lib']) cpSync(join(repo, name), join(snapshot, name), { recursive: true });
cpSync(join(repo, 'scripts/native-smoke.mjs'), driver);
if(parsed.automation) cpSync(join(repo,'scripts/native-automation-smoke.mjs'),join(output,'native-automation-smoke.mjs'));
if(parsed.parallel) cpSync(join(repo,'scripts/native-parallel-smoke.mjs'),join(output,'native-parallel-smoke.mjs'));
if(parsed.switches) cpSync(join(repo,'scripts/native-switch-smoke.mjs'),join(output,'native-switch-smoke.mjs'));
if(parsed.modelPolicies) cpSync(join(repo,'scripts/native-model-policy-smoke.mjs'),join(output,'native-model-policy-smoke.mjs'));
if(parsed.production) cpSync(join(repo,'scripts/native-production-smoke.mjs'),join(output,'native-production-smoke.mjs'));
mkdirSync(join(snapshot, 'node_modules'), { recursive: true });
// Only dependency code is shared; this never copies or opens the production credentials/profile state.
symlinkSync(join(repo, 'node_modules/zod'), join(snapshot, 'node_modules/zod'), process.platform === 'win32' ? 'junction' : 'dir');
const nextUrl = pathToFileURL(join(snapshot, 'lib/index.js')).href;
writeFileSync(join(snapshot, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'dsh-next', name: nextUrl, config: { deduplicateReads: true, prices: [],
  ...parsed.automation?{verificationChecks:[{id:'json-config',workspace,kind:'json-schema',file:'next-config.json',schemaFile:'next-schema.json'}]}:{},
  ...parsed.parallel?{prices:[{provider:'deepseek-official',model:'deepseek-flash',input:0.1,cacheRead:0.1,cacheWrite:0.1,output:0.1}],automationPricesValidUntil:new Date(Date.now()+3600000).toISOString()}:{} } }] }], null, 2));
const manifest = JSON.parse(readFileSync(join(snapshot, 'package.json'), 'utf8'));
manifest.dsh.bundle.patch = './cordis.patch.yml';
json(join(snapshot, 'package.json'), manifest);
const fixture = Array.from({ length: 120 }, (_, index) => `Line ${index + 1}: local native read fixture ${'abcdefgh '.repeat(8)}`).join('\n') + '\n';
writeFileSync(join(workspace, 'fixture.txt'), fixture);
const hashes = {};
for (const name of readdirSync(join(snapshot,'lib')).filter(name=>name.endsWith('.js')).sort()) hashes[`lib/${name}`] = createHash('sha256').update(readFileSync(join(snapshot,'lib',name))).digest('hex');
const job = { schemaVersion: 1, output, workspace, runtime, nextUrl, fixture, hashes, adaptive:parsed.adaptive===true, automation:parsed.automation===true, parallel:parsed.parallel===true, switches:parsed.switches===true, modelPolicies:parsed.modelPolicies===true, production:parsed.production===true, startedAt: new Date().toISOString() };
json(join(output, 'job.json'), job);
const env = {};
for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'PUBLIC', 'ProgramFiles', 'PROCESSOR_ARCHITECTURE']) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
Object.assign(env, { DSH_HOME: home, ELECTRON_RUN_AS_NODE: '1', DSH_NEXT_SMOKE_JOB: join(output, 'job.json') });

async function child(args, phase, limit = timeoutMs) {
  return new Promise((complete, reject) => {
    const child = spawn(executable, ['--expose-internals', cli, '--profile', 'next-smoke', ...args], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-2000000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000000); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, limit);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      writeFileSync(join(output, `${phase}-stdout.log`), stdout);
      writeFileSync(join(output, `${phase}-stderr.log`), stderr);
      complete({ code, signal, timedOut });
    });
  });
}

console.log(JSON.stringify({ type: 'start', output, isolatedHome: home, modelCallsAllowed: false }));
let result;
try {
  const initialized = await child(['--from-default-profile', 'web', '--dump-config'], 'initialize', 60000);
  json(join(output, 'initialize.json'), initialized);
  if (initialized.code !== 0 || initialized.timedOut) throw new Error('Native profile initialization failed; inspect initialize-stderr.log');
  const profile = join(home, 'profiles/next-smoke');
  const path = join(profile, 'package.json');
  const profileManifest = JSON.parse(readFileSync(path, 'utf8'));
  profileManifest.dependencies ??= {};
  profileManifest.dependencies['@local/dsh-next'] = `file:${snapshot.replaceAll('\\', '/')}`;
  profileManifest.dsh.profile.bundles.push('@local/dsh-next');
  if(parsed.adaptive) {
    const adaptive=resolve(process.env.NEXT_ADAPTIVE_PACKAGE??join(process.env.USERPROFILE??process.env.HOME??'','.dsh/profiles/desktop/node_modules/@local/dsh-adaptive-mode'));
    profileManifest.dependencies['@local/dsh-adaptive-mode']='file:'+adaptive;
    profileManifest.dsh.profile.bundles.push('@local/dsh-adaptive-mode');
  }
  json(path, profileManifest);
  mkdirSync(join(profile, 'node_modules/@local'), { recursive: true });
  symlinkSync(snapshot, join(profile, 'node_modules/@local/dsh-next'), process.platform === 'win32' ? 'junction' : 'dir');
  if(parsed.adaptive) symlinkSync(resolve(process.env.NEXT_ADAPTIVE_PACKAGE??join(process.env.USERPROFILE??process.env.HOME??'','.dsh/profiles/desktop/node_modules/@local/dsh-adaptive-mode')),join(profile,'node_modules/@local/dsh-adaptive-mode'),'junction');
  const overlay = [
    { id: 'session-title-llm', disabled: true },
    { id: 'hmr', disabled: true },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false } },
    // Test fixture only: avoid Windows sandbox driver initialization for isolated local tool calls.
    { id: 'sandbox-policy', config: { mode: 'danger-full-access', workspaceRoot: workspace } },
    { id: 'approval', config: { policy: 'never' } },
    { id: 'permission', config: { defaultPreset: 'danger-full-access' } },
    { insert: [{ id: 'next-native-smoke', name: pathToFileURL(driver).href }] },
  ];
  const overlayPath = join(output, 'overlay.yml');
  json(overlayPath, overlay);
  const launched = await child(['--patch', overlayPath, '--no-open', '--port', '0'], 'host');
  const driverPath = join(output, 'driver-result.json');
  const report = existsSync(driverPath) ? JSON.parse(readFileSync(driverPath, 'utf8')) : null;
  if(launched.code===0&&report?.status==='Pass') {
    json(join(output,'first-driver-result.json'),report);
    job.resumeOnly=true;job.sessionId=report.sessionId;
    const savedProjection=JSON.parse(readFileSync(join(output,'projection.json'),'utf8'));
    job.expectedCalls=savedProjection.nextMetrics.calls;
    if(parsed.parallel)job.expectedBudget=JSON.parse(readFileSync(join(output,'parallel-native.json'),'utf8')).budget;
    json(join(output,'job.json'),job);
    const restarted=await child(['--patch',overlayPath,'--no-open','--port','0'],'restart');
    json(join(output,'restart.json'),restarted);
    const resumed=JSON.parse(readFileSync(driverPath,'utf8'));
    report.restart=resumed;
    if(restarted.code!==0||resumed.status!=='Pass')report.status='Fail';
  }
  result = { schemaVersion: 1, status: launched.code === 0 && !launched.timedOut && report?.status === 'Pass' ? 'Pass' : 'Fail',
    output, launch: launched, driver: report, isolation: { home, workspace, credentialsCopied: false, productionProfileModified: false },
    warnings: ['Sandbox policy is disabled only in this isolated local tool fixture; this does not validate production sandbox enforcement.'] };
} catch (error) {
  result = { schemaVersion: 1, status: 'Fail', output, error: String(error) };
}
json(join(output, 'result.json'), result);
console.log(JSON.stringify({ type: 'complete', status: result.status, output, error: result.error }));
process.exitCode = result.status === 'Pass' ? 0 : 1;
