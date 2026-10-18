// Isolated rendered UI QA: real React and Chromium, mocked Host settings only.
// No accounts, production profiles, model providers, or external HTTP are used.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const work = resolve(repo, '..')
const options = { dependencies: [] }
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index]
  if (argument === '--help') options.help = true
  else if (['--deps', '--out', '--browser'].includes(argument)) {
    const value = process.argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
    if (argument === '--deps') options.dependencies.push(resolve(value))
    else options[argument.slice(2)] = resolve(value)
  } else throw new Error(`Unknown argument ${argument}`)
}
if (options.help) {
  console.log('node scripts/check-responsive.mjs [--deps <existing-node_modules>] [--out <new-path-under-work>] [--browser <existing-chromium-executable>]')
  process.exit(0)
}

const dependencyRoots = [...options.dependencies, process.env.NEXT_UI_NODE_MODULES,
  join(repo, 'node_modules'), join(process.env.USERPROFILE ?? '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')].filter(Boolean)
function installedPackage(name) {
  for (const root of dependencyRoots) {
    const direct = join(root, name)
    if (existsSync(join(direct, 'package.json'))) return direct
    const pnpm = join(root, '.pnpm')
    if (!existsSync(pnpm)) continue
    const prefix = `${name.replaceAll('/', '+')}@`
    for (const entry of readdirSync(pnpm).filter(entry => entry.startsWith(prefix)).sort().reverse()) {
      const candidate = join(pnpm, entry, 'node_modules', name)
      if (existsSync(join(candidate, 'package.json'))) return candidate
    }
  }
  throw new Error(`An existing ${name} package was not found. Supply --deps; this runner never installs dependencies.`)
}
const playwrightPath = installedPackage('playwright')
const reactPath = installedPackage('react')
const reactDomPath = installedPackage('react-dom')
const load = createRequire(join(playwrightPath, 'package.json'))
const { chromium } = load(playwrightPath)
const dependencies = Object.fromEntries([['playwright', playwrightPath], ['react', reactPath], ['react-dom', reactDomPath]]
  .map(([name, path]) => [name, { path, version: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version }]))
const output = resolve(options.out ?? join(work, 'ui-responsive', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`))
const outputRelative = relative(work, output)
if (!outputRelative || outputRelative === '..' || outputRelative.startsWith(`..${sep}`) || outputRelative.startsWith(sep)) throw new Error('Output must be strictly inside work/')
if (existsSync(output)) throw new Error('Output must be a fresh directory')
mkdirSync(output, { recursive: true })
const json = (name, value) => writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`)
const source = readFileSync(join(repo, 'src/client.js'), 'utf8')
writeFileSync(join(output, 'client.snapshot.js'), source)
const sourceSha256 = createHash('sha256').update(source).digest('hex')

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEXT isolated settings QA</title>
<style>*{box-sizing:border-box}html,body{margin:0;min-width:0;background:#202329;color:#eef0f4;font:14px/1.5 system-ui,sans-serif}main{width:100%;max-width:696px;margin:0 auto;padding:20px 28px}button,input,select{font:inherit}:root{--dsw-alias-bg-secondary:#303134;--dsw-alias-border-l2:#46494e;--dsw-alias-label-primary:#eef0f4;--dsw-alias-label-tertiary:#aeb3bd}@media(max-width:480px){main{padding:16px}}</style>
</head><body><main id="app"></main><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/jsx-runtime.js"></script><script src="/bootstrap.js"></script><script src="/client.js"></script></body></html>`
const bootstrap = `(() => {
  const React = window.React, ReactDOM = window.ReactDOM;
  const defaults = {outputLanguage:'auto',responseStyle:'standard',deduplicateReads:true,efficiencyGuidance:false,methodGuidance:true,targetedVerification:true,benefitBasedParallelism:true,expandTokenDetails:false,automationEnabled:true,automationVerification:true,automationParallelism:true,automationBudgetCny:3};
  const preserved = {prices:[{provider:'fictional-provider',model:'manual',input:'1',cacheRead:'0.02',cacheWrite:'1',output:'4'}],automationPricesValidUntil:'2099-01-01T00:00:00.000Z',verificationChecks:[{id:'fictional-json',workspace:'C:/fictional-project',kind:'json-syntax',file:'settings.json'}]};
  let snapshot = {status:'ready',value:{...defaults,...preserved},writable:true}, language='zh', dictionary, section, nextWrite='success';
  const catalog={ok:true,value:{groups:[{id:'provider-a',name:'Provider A',models:[{id:'shared-model',name:'Shared model with a long descriptive display name'},{id:'model-a',name:'Model A'}]},{id:'provider-b',name:'Provider B',models:[{id:'shared-model',name:'Shared model with a long descriptive display name'}]},{id:'deepseek-account',name:'DeepSeek Account',models:[{id:'deepseek-flash',name:'DeepSeek Flash'},{id:'deepseek-pro',name:'DeepSeek Pro'}]},{id:'deepseek-official',name:'DeepSeek API',models:[{id:'deepseek-flash',name:'DeepSeek Flash'},{id:'deepseek-pro',name:'DeepSeek Pro'}]}],failures:[]}};
  const listeners=new Set(), writes=[], commands=[], catalogCalls=[], productionCalls=[], scanCalls=[], mountCalls=[], disposers=[];
  const publish=()=>{for(const listener of listeners)listener()};
  async function commit(write, apply){writes.push(write);const outcome=nextWrite;nextWrite='success';await new Promise(resolve=>setTimeout(resolve,180));if(outcome==='reject')return false;if(outcome==='throw')throw new Error('Synthetic save failure');snapshot={...snapshot,value:apply(snapshot.value)};publish();return true;}
  const form={getSnapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},set:(field,value)=>commit({field,value},current=>({...current,[field]:value})),mutate:ops=>commit({ops},current=>{const next={...current};for(const op of ops){if(op.path.length!==1)throw new Error('Unexpected nested operation');if(op.op==='set'){next[op.path[0]]=op.value;continue}if(op.op!=='unset'||!Object.hasOwn(defaults,op.path[0]))throw new Error('Unexpected reset operation');next[op.path[0]]=defaults[op.path[0]]}return next})};
  const runtime=window.__nextJsxRuntime;
  const primitives={IconDatabaseOutlineRegular:()=>React.createElement('svg',{'aria-hidden':true}),useAnchoredPosition:()=>null,useDismissOnOutsidePointer:()=>{}};
  const nextProduction={async inspect(request){productionCalls.push(request);return{ok:true,value:{sessionId:'fixture-session',workspace:'C:/fictional-project',route:{provider:'deepseek-account',model:'deepseek-flash'},capabilities:{optimization:{status:'off',reason:'NEXT is off in this conversation'},verification:{status:'ready',reason:'Registered checks available'},retrieval:{status:'ready',reason:'Native read, glob and grep available'},parallel:{status:'blocked',reason:'Current route price is unknown'}},checks:snapshot.value.verificationChecks.map(check=>({id:check.id,kind:check.kind,status:'ready',reason:'Registration matches observed project inputs'}))}}},async scan(request){scanCalls.push(request);return{ok:true,value:{workspace:request.workspace,candidates:[{id:'npm-test',label:'Test project',check:{id:'npm-test',workspace:request.workspace,kind:'command',command:'npm run test -- --runInBand',timeoutMs:120000,bindings:[{file:'package.json',sha256:'a'.repeat(64)},{file:'package-lock.json',sha256:'b'.repeat(64)}]}}]}}}};
  const root=ReactDOM.createRoot(document.getElementById('app'));
  function mount(){const injected=section.options.inject();const {hooks,...props}=injected;const settings=hooks.nextSettings;const t=(key,parameters={})=>{const value=dictionary[language][key];if(typeof value!=='string')throw new Error('Missing translation: '+key);return value.replace(/\\{(\\w+)\\}/g,(_,name)=>String(parameters[name]))};const componentProps={...props,t,useNextSettings:selector=>selector(React.useSyncExternalStore(settings.subscribe,settings.getSnapshot,settings.getSnapshot))};Object.defineProperty(componentProps,'inputActions',{get(){throw new Error('Settings accessed composer draft')}});root.render(React.createElement(section.component,componentProps));document.documentElement.lang=language;}
  window.__nextUi={writes,commands,catalogCalls,productionCalls,scanCalls,mountCalls,getSnapshot:()=>JSON.parse(JSON.stringify(snapshot)),failNext(mode='reject'){nextWrite=mode},setLanguage(value){language=value;mount()},unmount(){root.unmount();for(const dispose of disposers.reverse())dispose()}};
  window.__ModuleLoader__={load({id,factory}){if(id!=='@local/dsh-next')throw new Error('Wrong plugin');const plugin=factory(name=>{if(name==='react')return React;if(name==='react/jsx-runtime')return runtime;if(name==='react-dom')return ReactDOM;if(name==='@deepseek-ai/dsh-client-ui-primitives')return primitives;throw new Error('Unexpected module: '+name)});plugin.apply({effect(action){const dispose=action();if(typeof dispose==='function')disposers.push(dispose);else if(dispose?.then)dispose.then(value=>{if(typeof value==='function')disposers.push(value)})},locale:{register(namespace,entries){if(namespace!=='dsh-next')throw new Error('Wrong locale');dictionary=entries;return()=>{}}},configForms:{get(namespace){if(namespace!=='dsh-next')throw new Error('Wrong settings namespace');return form}},remote:{$mount(contribution){mountCalls.push(contribution);return()=>{}},nextProduction,commands:{execute(...args){commands.push(args);throw new Error('Settings must not send chat commands')}},session:{async modelCatalog(...args){catalogCalls.push(args);return catalog}}},slots:{inject(name,action){if(name==='settings.section'){const dispose=action();if(dispose)disposers.push(dispose)}return()=>{}},register(options,component){if(options.name==='settings.section')section={options,component};return()=>{}}}});if(!section)throw new Error('No settings section');mount();}};
})();`
writeFileSync(join(output, 'harness.html'), html)
writeFileSync(join(output, 'bootstrap.js'), bootstrap)
const assets = new Map([
  ['/', ['text/html; charset=utf-8', Buffer.from(html)]],
  ['/bootstrap.js', ['text/javascript; charset=utf-8', Buffer.from(bootstrap)]],
  ['/client.js', ['text/javascript; charset=utf-8', Buffer.from(source)]],
  ['/react.js', ['text/javascript; charset=utf-8', readFileSync(join(reactPath, 'umd/react.development.js'))]],
  ['/react-dom.js', ['text/javascript; charset=utf-8', readFileSync(join(reactDomPath, 'umd/react-dom.development.js'))]],
  ['/jsx-runtime.js', ['text/javascript; charset=utf-8', Buffer.from(`(() => { const exports = {}; const process = {env:{NODE_ENV:'development'}}; const require = name => {if(name==='react')return window.React;throw new Error('Unexpected JSX dependency')};\n${readFileSync(join(reactPath, 'cjs/react-jsx-runtime.development.js'), 'utf8')}\nwindow.__nextJsxRuntime=exports; })();`)]],
])
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return }
  const asset = assets.get(request.url)
  if (!asset) { response.writeHead(404); response.end(); return }
  response.writeHead(200, { 'content-type': asset[0], 'cache-control': 'no-store' })
  response.end(asset[1])
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
const address = `http://127.0.0.1:${server.address().port}`
const matrix = []
for (const width of [320, 480, 1280]) for (const textScale of [1, 2]) for (const language of ['zh', 'en']) matrix.push({ width, height: 900, textScale, language })
const checks = [], screenshots = [], errors = []
let browser
function record(name, pass, detail = {}) {
  const item = { name, status: pass ? 'Pass' : 'Fail', ...detail }
  checks.push(item)
  if (!pass) throw new Error(`Check failed: ${name}`)
}
async function screenshot(page, stem, state) {
  const name = `${stem}-${state}.png`
  await page.screenshot({ path: join(output, name), fullPage: true })
  screenshots.push(name)
  if (stem === '320-en-text200' && state === 'budget-failed') {
    await page.locator('[data-next-setting="automationBudgetCny"]').scrollIntoViewIfNeeded()
    const viewportName = `${stem}-${state}-viewport.png`
    await page.screenshot({ path: join(output, viewportName), fullPage: false })
    screenshots.push(viewportName)
  }
}
async function layout(page, stem, state, minimumControls = 10) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const selector = '.dsh-next-settings, .dsh-next-settings__field, .dsh-next-settings__row, .dsh-next-settings__copy, .dsh-next-settings__help, .dsh-next-settings select, .dsh-next-settings input, .dsh-next-settings button, .dsh-next-settings textarea, .dsh-next-settings__status, .dsh-next-settings__models, .dsh-next-settings__tags li, .dsh-next-settings__tags li>span, .dsh-next-settings__source, .dsh-next-settings__check, .dsh-next-settings__production-grid, .dsh-next-settings__production-label'
    const overflow = [...document.querySelectorAll(selector)].filter(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.width > 0 && (bounds.left < -1 || bounds.right > width + 1)
    }).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 70) }))
    const controls = [...document.querySelectorAll('[data-next-setting]')].map(element => {
      const help = document.getElementById(element.getAttribute('aria-describedby'))
      const bounds = element.getBoundingClientRect()
      return { field: element.dataset.nextSetting, label: element.getAttribute('aria-label'), help: Boolean(help?.textContent?.trim()), width: bounds.width, height: bounds.height }
    })
    const canvas = document.createElement('canvas').getContext('2d')
    const optionReadability = [...document.querySelectorAll('.dsh-next-settings select[data-next-setting]')].flatMap(element => {
      const style = getComputedStyle(element)
      canvas.font = style.font
      const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24
      return [...element.options].map(option => ({ field: element.dataset.nextSetting, option: option.value, label: option.text,
        textWidth: canvas.measureText(option.text).width, availableWidth: available }))
    })
    return { viewportWidth: width, documentWidth: document.documentElement.scrollWidth, overflow, controls, optionReadability }
  })
  record(`${stem}:${state}:no-horizontal-overflow`, result.documentWidth <= result.viewportWidth + 1 && result.overflow.length === 0, result)
  record(`${stem}:${state}:accessible-controls`, result.controls.length >= minimumControls && result.controls.every(control => control.label && control.help && control.width > 0 && control.height > 0))
  const clipped = result.optionReadability.filter(option => option.textWidth > option.availableWidth + 1)
  checks.push({ name: `${stem}:${state}:all-select-options-readable`, status: clipped.length === 0 ? 'Pass' : 'Fail', clipped })
}
try {
  browser = await chromium.launch({ headless: true, ...(options.browser ? { executablePath: options.browser } : {}) })
  for (const item of matrix) {
    const caseStart = checks.length
    const stem = `${item.width}-${item.language}-text${item.textScale * 100}`
    const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, locale: item.language === 'zh' ? 'zh-CN' : 'en-US' })
    await context.route('**/*', route => new URL(route.request().url()).origin === address ? route.continue() : route.abort('blockedbyclient'))
    const page = await context.newPage()
    page.on('pageerror', error => errors.push({ case: stem, type: 'pageerror', message: error.message }))
    page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') errors.push({ case: stem, type: message.type(), message: message.text() }) })
    await page.goto(address)
    await page.locator('.dsh-next-settings h2').waitFor({ state: 'visible' })
    await page.evaluate(language => window.__nextUi.setLanguage(language), item.language)
    await page.getByRole('heading', { name: item.language === 'zh' ? 'NEXT 设置' : 'NEXT settings', exact: true }).waitFor()
    await page.locator('[data-next-action="defaults"]').click()
    if (item.textScale === 2) {
      // Text-only enlargement, including newly appearing feedback: no OS or browser setting changes.
      const rules = await page.evaluate(() => {
        const selectors = ['.dsh-next-settings', '.dsh-next-settings h2', '.dsh-next-settings h3', '.dsh-next-settings__scope', '.dsh-next-settings__intro', '.dsh-next-settings__copy', '.dsh-next-settings__help', '.dsh-next-settings__registration h3', '.dsh-next-settings__footer', '.dsh-next-settings__status', '.dsh-next-settings select', '.dsh-next-settings button', '.dsh-next-settings__models small', '.dsh-next-settings__source', '.dsh-next-settings__tags button', '.dsh-next-settings__source button', '.dsh-next-settings__production-label', '.dsh-next-settings__capabilities', '.dsh-next-settings__check pre']
        return selectors.map(selector => {
          const element = document.querySelector(selector)
          const size = element ? parseFloat(getComputedStyle(element).fontSize) : ['.dsh-next-settings__production-label', '.dsh-next-settings__capabilities'].includes(selector) ? 13 : ['.dsh-next-settings__status', '.dsh-next-settings__models small', '.dsh-next-settings__source', '.dsh-next-settings__tags button', '.dsh-next-settings__source button', '.dsh-next-settings__check pre'].includes(selector) ? 12 : null
          return size ? `${selector}{font-size:${size * 2}px!important}` : ''
        }).join('\n')
      })
      await page.addStyleTag({ content: rules })
    }
    record(`${stem}:page-identity`, page.url() === `${address}/` && await page.title() === 'NEXT isolated settings QA')
    record(`${stem}:nonblank-and-no-framework-overlay`, await page.locator('[data-next-setting]').count() === 12 && await page.locator('nextjs-portal, vite-error-overlay, #webpack-dev-server-client-overlay').count() === 0)
    await layout(page, stem, 'ready')
    await screenshot(page, stem, 'ready')
    const languageControl = page.locator('[data-next-setting="outputLanguage"]')
    await languageControl.focus()
    record(`${stem}:select-focus`, await languageControl.evaluate(element => element === document.activeElement))
    await languageControl.selectOption('en')
    await page.waitForFunction(() => document.querySelector('[data-next-setting="outputLanguage"]').disabled)
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.outputLanguage === 'en')
    await page.locator('[data-next-feedback="outputLanguage"]').getByText(item.language === 'zh' ? '已保存' : 'Saved', { exact: true }).waitFor()
    record(`${stem}:save-success`, await languageControl.inputValue() === 'en')
    await page.evaluate(() => window.__nextUi.failNext())
    const dedup = page.locator('[data-next-setting="deduplicateReads"]')
    await dedup.click()
    const failedFeedback = page.locator('[data-next-feedback="deduplicateReads"]')
    await failedFeedback.getByRole('button', { name: item.language === 'zh' ? '重试' : 'Retry', exact: true }).waitFor()
    record(`${stem}:save-failure-preserves-value`, await dedup.isChecked() && await failedFeedback.getAttribute('role') === 'alert')
    await layout(page, stem, 'failed')
    await screenshot(page, stem, 'failed')
    const retry = failedFeedback.getByRole('button', { name: item.language === 'zh' ? '重试' : 'Retry', exact: true })
    await retry.focus()
    record(`${stem}:retry-focus`, await retry.evaluate(element => element === document.activeElement))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.deduplicateReads === false)
    await failedFeedback.getByText(item.language === 'zh' ? '已保存' : 'Saved', { exact: true }).waitFor()
    record(`${stem}:retry-success`, !await dedup.isChecked())
    await layout(page, stem, 'retry-saved')
    await screenshot(page, stem, 'retry-saved')
    const parallelism = page.locator('[data-next-setting="automationParallelism"]')
    const budget = page.locator('[data-next-setting="automationBudgetCny"]')
    record(`${stem}:automatic-subagents-independent-of-guidance`, await parallelism.isEnabled() && await parallelism.isChecked()
      && await budget.isEnabled() && await budget.inputValue() === '3' && !await page.locator('[data-next-setting="efficiencyGuidance"]').isChecked())
    await budget.focus()
    record(`${stem}:budget-select-focus`, await budget.evaluate(element => element === document.activeElement))
    await budget.selectOption('2')
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.automationBudgetCny === 2 && !document.querySelector('[data-next-setting="automationBudgetCny"]').disabled)
    record(`${stem}:budget-saves-number`, await budget.inputValue() === '2' && await page.evaluate(() => typeof window.__nextUi.getSnapshot().value.automationBudgetCny === 'number'
      && window.__nextUi.writes.at(-1).field === 'automationBudgetCny' && window.__nextUi.writes.at(-1).value === 2))
    await page.evaluate(() => window.__nextUi.failNext())
    await budget.selectOption('1')
    const budgetFeedback = page.locator('[data-next-feedback="automationBudgetCny"]')
    const budgetRetry = budgetFeedback.getByRole('button', { name: item.language === 'zh' ? '重试' : 'Retry', exact: true })
    await budgetRetry.waitFor()
    record(`${stem}:budget-failure-preserves-value`, await budget.inputValue() === '2' && await budgetFeedback.getAttribute('role') === 'alert')
    await layout(page, stem, 'budget-failed')
    await screenshot(page, stem, 'budget-failed')
    await budgetRetry.click()
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.automationBudgetCny === 1 && !document.querySelector('[data-next-setting="automationBudgetCny"]').disabled)
    record(`${stem}:budget-retry-saves-number`, await budget.inputValue() === '1' && await page.evaluate(() => window.__nextUi.writes.at(-1).value === 1))
    const automation = page.locator('[data-next-setting="automationEnabled"]')
    await automation.focus()
    record(`${stem}:checkbox-focus`, await automation.evaluate(element => element === document.activeElement))
    await page.keyboard.press('Space')
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.automationEnabled === false)
    record(`${stem}:checkbox-keyboard-and-dependency`, !await automation.isChecked() && await page.locator('[data-next-setting="automationVerification"]').isDisabled()
      && await parallelism.isDisabled() && await parallelism.isChecked() && await budget.isDisabled() && await budget.inputValue() === '1')
    await page.getByRole('button', { name: item.language === 'zh' ? '恢复默认设置' : 'Reset to defaults', exact: true }).click()
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.outputLanguage === 'auto' && window.__nextUi.getSnapshot().value.automationEnabled === true
      && window.__nextUi.getSnapshot().value.automationParallelism === true && window.__nextUi.getSnapshot().value.automationBudgetCny === 3)
    const preserved = await page.evaluate(() => ({ snapshot: window.__nextUi.getSnapshot(), commands: window.__nextUi.commands }))
    record(`${stem}:reset-preserves-host-fields-and-no-chat`, preserved.snapshot.value.prices.length === 1 && preserved.snapshot.value.verificationChecks.length === 1
      && preserved.snapshot.value.automationPricesValidUntil === '2099-01-01T00:00:00.000Z' && preserved.commands.length === 0)
    if (item.width === 320 && item.language === 'en' && item.textScale === 2) {
      await page.locator('[data-next-feedback="resetSettings"]').waitFor({ state: 'hidden', timeout: 6000 })
      record(`${stem}:success-feedback-clears`, true)
      for (const field of ['outputLanguage', 'responseStyle', 'automationBudgetCny']) {
        const control = page.locator(`[data-next-setting="${field}"]`)
        const choices = await control.locator('option').evaluateAll(options => options.map(option => option.value))
        for (const choice of choices) {
          await control.selectOption(choice)
          await page.waitForFunction(({ field, choice }) => window.__nextUi.getSnapshot().value[field] === (field === 'automationBudgetCny' ? Number(choice) : choice)
            && !document.querySelector(`[data-next-setting="${field}"]`).disabled, { field, choice })
          record(`${stem}:select-${field}-${choice}`, await control.inputValue() === choice)
        }
      }
    }
    const inheritedBeforeModelTests = await page.evaluate(() => ({ outputLanguage: window.__nextUi.getSnapshot().value.outputLanguage,
      responseStyle: window.__nextUi.getSnapshot().value.responseStyle }))
    await page.locator('[data-next-action="models"]').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-next-model]').length === 5)
    record(`${stem}:model-catalog-keeps-third-party-routes-and-merges-official-pairs`, await page.locator('[data-next-model]').count() === 5
      && await page.evaluate(() => new Set([...document.querySelectorAll('[data-next-model]')].map(element => element.dataset.nextModel)).size === 5))
    await layout(page, stem, 'models', 0)
    await screenshot(page, stem, 'models')
    await page.locator('[data-next-model]').filter({ hasText: 'Provider A · shared-model' }).click()
    const addTag = page.locator('[data-next-add-tag]')
    await addTag.selectOption('economy')
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.modelProfiles?.some(profile => profile.provider === 'provider-a' && profile.tags.includes('economy')))
    record(`${stem}:economy-tag-applies-declared-strategy`, await page.locator('[data-next-setting="responseStyle"]').inputValue() === 'concise'
      && await page.locator('[data-next-setting="efficiencyGuidance"]').isChecked() && !await page.locator('[data-next-setting="automationParallelism"]').isChecked())
    await addTag.selectOption('detailed')
    await page.waitForFunction(() => document.querySelector('[data-next-setting="responseStyle"]').value === 'detailed')
    await page.locator('[data-next-tag-up="detailed"]').click()
    await page.waitForFunction(() => document.querySelector('[data-next-setting="responseStyle"]').value === 'concise')
    record(`${stem}:tag-order-is-observable`, await page.locator('[data-next-setting="responseStyle"]').inputValue() === 'concise')
    await page.locator('[data-next-setting="responseStyle"]').selectOption('standard')
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.modelProfiles.some(profile => profile.provider === 'provider-a' && profile.overrides.responseStyle === 'standard'))
    await page.locator('[data-next-clear="responseStyle"]').click()
    await page.waitForFunction(() => document.querySelector('[data-next-setting="responseStyle"]').value === 'concise')
    record(`${stem}:override-clear-restores-tag`, await page.locator('[data-next-setting="responseStyle"]').inputValue() === 'concise')
    await layout(page, stem, 'model-tags')
    await screenshot(page, stem, 'model-tags')
    const longTag = '标签' + 'VeryLongUnbrokenModelOptimizationTag'.repeat(2).slice(0, 60)
    await page.locator('[data-next-tag-name]').fill(longTag)
    await page.locator('[data-next-action="create-tag"]').click()
    await page.waitForFunction(() => document.querySelector('[data-next-page="tag"]') !== null)
    const custom = await page.evaluate(() => window.__nextUi.getSnapshot().value.optimizationTags.at(-1))
    record(`${stem}:custom-tag-created-and-assigned-atomically`, custom.name === longTag && Object.keys(custom.preferences).length === 0
      && await page.evaluate(id => { const write = window.__nextUi.writes.at(-1); return write.ops?.length === 2
        && window.__nextUi.getSnapshot().value.modelProfiles.find(profile => profile.provider === 'provider-a').tags.includes(id) }, custom.id))
    await layout(page, stem, 'custom-tag-policy')
    await screenshot(page, stem, 'custom-tag-policy')
    await page.locator('[data-next-setting="outputLanguage"]').selectOption('ja')
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.optimizationTags.at(-1).preferences.outputLanguage === 'ja')
    await page.locator('[data-next-action="back-model"]').click()
    record(`${stem}:custom-tag-policy-applies-to-model`, await page.locator('[data-next-setting="outputLanguage"]').inputValue() === 'ja')
    await layout(page, stem, 'long-model-tag')
    await screenshot(page, stem, 'long-model-tag')
    await page.locator('[data-next-action="models"]').click()
    await page.locator('[data-next-model]').filter({ hasText: 'Provider B · shared-model' }).click()
    record(`${stem}:same-named-model-under-other-provider-is-isolated`, await page.locator('[data-next-setting="outputLanguage"]').inputValue() === inheritedBeforeModelTests.outputLanguage
      && await page.locator('[data-next-setting="responseStyle"]').inputValue() === inheritedBeforeModelTests.responseStyle)
    const unrelatedProfilesBeforeOfficial = await page.evaluate(() => JSON.stringify(window.__nextUi.getSnapshot().value.modelProfiles ?? []))
    await page.locator('[data-next-action="models"]').click()
    const officialFlash = page.locator('[data-next-official-model]').filter({ hasText: 'DeepSeek Flash' })
    const officialPro = page.locator('[data-next-official-model]').filter({ hasText: 'DeepSeek Pro' })
    record(`${stem}:official-models-have-one-entry-each`, await officialFlash.count() === 1 && await officialPro.count() === 1
      && await officialFlash.getAttribute('data-next-model') === JSON.stringify(['deepseek-account', 'deepseek-flash'])
      && await officialPro.getAttribute('data-next-model') === JSON.stringify(['deepseek-account', 'deepseek-pro']))
    await officialFlash.click()
    await layout(page, stem, 'official-model')
    let officialWriteStart = await page.evaluate(() => window.__nextUi.writes.length)
    await page.locator('[data-next-add-tag]').selectOption('economy')
    await page.waitForFunction(() => {
      const profiles = window.__nextUi.getSnapshot().value.modelProfiles ?? []
      return ['deepseek-account', 'deepseek-official'].every(provider => profiles.some(profile => profile.provider === provider && profile.model === 'deepseek-flash' && profile.tags.includes('economy')))
    })
    record(`${stem}:official-add-tag-saves-both-routes-in-one-write`, await page.evaluate(start => {
      const writes = window.__nextUi.writes.slice(start), profiles = window.__nextUi.getSnapshot().value.modelProfiles
      const pair = profiles.filter(profile => profile.model === 'deepseek-flash')
      return writes.length === 1 && writes[0].field === 'modelProfiles' && pair.length === 2
        && JSON.stringify(pair[0].tags) === JSON.stringify(pair[1].tags) && JSON.stringify(pair[0].overrides) === JSON.stringify(pair[1].overrides)
        && !profiles.some(profile => profile.model === 'deepseek-pro')
    }, officialWriteStart))
    officialWriteStart = await page.evaluate(() => window.__nextUi.writes.length)
    await page.locator('[data-next-setting="outputLanguage"]').selectOption('en')
    await page.waitForFunction(() => ['deepseek-account', 'deepseek-official'].every(provider => window.__nextUi.getSnapshot().value.modelProfiles.some(profile => profile.provider === provider && profile.model === 'deepseek-flash' && profile.overrides.outputLanguage === 'en')))
    record(`${stem}:official-language-override-saves-both-routes-in-one-write`, await page.evaluate(start => {
      const writes = window.__nextUi.writes.slice(start)
      return writes.length === 1 && writes[0].field === 'modelProfiles' && writes[0].value.filter(profile => profile.model === 'deepseek-flash').every(profile => profile.tags.includes('economy') && profile.overrides.outputLanguage === 'en')
    }, officialWriteStart))
    await screenshot(page, stem, 'official-model-shared')
    const officialBeforeFailure = await page.evaluate(() => JSON.stringify(window.__nextUi.getSnapshot().value.modelProfiles))
    await page.evaluate(() => window.__nextUi.failNext())
    await page.locator('[data-next-setting="outputLanguage"]').selectOption('ko')
    const officialFailure = page.locator('[data-next-feedback="outputLanguage"]')
    await officialFailure.getByRole('button', { name: item.language === 'zh' ? '重试' : 'Retry', exact: true }).waitFor()
    record(`${stem}:official-save-failure-keeps-both-routes`, await page.evaluate(before => JSON.stringify(window.__nextUi.getSnapshot().value.modelProfiles) === before, officialBeforeFailure)
      && await page.locator('[data-next-setting="outputLanguage"]').inputValue() === 'en')
    officialWriteStart = await page.evaluate(() => window.__nextUi.writes.length)
    await officialFailure.getByRole('button', { name: item.language === 'zh' ? '重试' : 'Retry', exact: true }).click()
    await page.waitForFunction(() => ['deepseek-account', 'deepseek-official'].every(provider => window.__nextUi.getSnapshot().value.modelProfiles.some(profile => profile.provider === provider && profile.model === 'deepseek-flash' && profile.overrides.outputLanguage === 'ko')))
    record(`${stem}:official-retry-saves-both-routes-once`, await page.evaluate(start => window.__nextUi.writes.length === start + 1, officialWriteStart))
    await page.locator('[data-next-clear="outputLanguage"]').click()
    await page.waitForFunction(() => {
      const pair = window.__nextUi.getSnapshot().value.modelProfiles.filter(profile => profile.model === 'deepseek-flash')
      return pair.length === 2 && pair.every(profile => !Object.hasOwn(profile.overrides, 'outputLanguage') && profile.tags.includes('economy'))
    })
    record(`${stem}:official-clear-override-restores-inheritance-for-both`, await page.locator('[data-next-setting="outputLanguage"]').inputValue() === inheritedBeforeModelTests.outputLanguage)
    await page.locator('[data-next-action="reset"]').click()
    await page.waitForFunction(() => !window.__nextUi.getSnapshot().value.modelProfiles.some(profile => ['deepseek-account', 'deepseek-official'].includes(profile.provider)))
    record(`${stem}:official-reset-clears-both-and-preserves-other-models`, await page.evaluate(before => JSON.stringify(window.__nextUi.getSnapshot().value.modelProfiles) === before, unrelatedProfilesBeforeOfficial))
    await layout(page, stem, 'official-reset')
    record(`${stem}:model-settings-send-no-chat`, await page.evaluate(() => window.__nextUi.commands.length === 0))
    await page.locator('[data-next-action="models"]').click()
    await page.locator('[data-next-action="production"]').click()
    const productionField = field => page.locator(`[data-next-production-field="${field}"]`)
    await page.waitForFunction(() => document.querySelector('[data-next-production-field="workspace"]').value === 'C:/fictional-project')
    record(`${stem}:production-native-rpc-and-capability-reasons`, await page.locator('[data-next-capability]').count() === 4
      && await page.locator('[data-next-capability="parallel"]').textContent().then(text => text.includes('Current route price is unknown'))
      && await page.evaluate(() => window.__nextUi.mountCalls.length === 1 && window.__nextUi.productionCalls.length === 1))
    await layout(page, stem, 'production-ready', 0)
    await screenshot(page, stem, 'production-ready')
    const writesBeforeScan = await page.evaluate(() => window.__nextUi.writes.length)
    await page.locator('[data-next-action="scan-checks"]').click()
    const registerCommand = page.locator('[data-next-register-check="npm-test"]')
    await registerCommand.waitFor()
    record(`${stem}:scan-is-read-only-and-displays-exact-command`, await page.evaluate(start => window.__nextUi.writes.length === start && window.__nextUi.scanCalls.length === 1, writesBeforeScan)
      && (await page.locator('[data-next-check]').filter({ has: registerCommand }).textContent()).includes('npm run test -- --runInBand'))
    await registerCommand.click()
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.verificationChecks.length === 2 && !document.querySelector('[data-next-register-check]').disabled)
    await registerCommand.click()
    await page.waitForFunction(() => !document.querySelector('[data-next-register-check]').disabled)
    record(`${stem}:registration-is-idempotent-and-preserves-host-bindings`, await page.evaluate(() => {
      const checks=window.__nextUi.getSnapshot().value.verificationChecks
      return checks.length===2 && checks[0].id==='fictional-json' && checks[1].bindings[0].sha256==='a'.repeat(64)
    }))
    await productionField('artifact-id').fill('tasks-report')
    await productionField('artifact-file').fill('reports/tasks.csv')
    await productionField('artifact-format').selectOption('csv')
    await productionField('artifact-columns').fill('name, status')
    await productionField('artifact-text').fill('completed')
    await page.evaluate(() => window.__nextUi.failNext())
    await page.locator('[data-next-action="register-artifact"]').click()
    const checkRetry = page.locator('[data-next-retry="verificationChecks"]')
    await checkRetry.waitFor()
    record(`${stem}:artifact-failure-preserves-registrations`, await page.evaluate(() => window.__nextUi.getSnapshot().value.verificationChecks.length === 2))
    await layout(page, stem, 'production-check-failed', 0)
    await screenshot(page, stem, 'production-check-failed')
    await checkRetry.click()
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.verificationChecks.length === 3 && !document.querySelector('[data-next-action="register-artifact"]').disabled)
    record(`${stem}:artifact-retry-persists-columns-and-required-text`, await page.evaluate(() => {
      const check=window.__nextUi.getSnapshot().value.verificationChecks.find(check=>check.id==='tasks-report')
      return check.kind==='artifact' && check.format==='csv' && JSON.stringify(check.requiredColumns)==='["name","status"]' && check.requiredText[0]==='completed'
    }))
    await page.locator('[data-next-price-route]').selectOption(JSON.stringify(['deepseek-account','deepseek-flash']))
    const writesBeforeInvalidPrice = await page.evaluate(() => window.__nextUi.writes.length)
    await page.locator('[data-next-action="save-price"]').click()
    await page.locator('[data-next-production-error]').waitFor()
    record(`${stem}:unknown-price-never-saved-as-zero`, await page.evaluate(start => window.__nextUi.writes.length === start, writesBeforeInvalidPrice))
    for (const field of ['input','cacheRead','cacheWrite','output']) await productionField(`price-${field}`).fill('1.25')
    await productionField('price-expiry').fill('2099-02-30T00:00:00Z')
    await page.locator('[data-next-action="save-price"]').click()
    record(`${stem}:invalid-calendar-expiry-rejected`, await page.evaluate(start => window.__nextUi.writes.length === start, writesBeforeInvalidPrice))
    await productionField('price-expiry').fill('2099-01-01T00:00:00Z')
    await page.evaluate(() => window.__nextUi.failNext())
    await page.locator('[data-next-action="save-price"]').click()
    const priceRetry = page.locator('[data-next-retry="prices"]')
    await priceRetry.waitFor()
    record(`${stem}:price-rejection-keeps-expiry-and-other-routes`, await page.evaluate(() => window.__nextUi.getSnapshot().value.prices.length===1
      && window.__nextUi.getSnapshot().value.automationPricesValidUntil==='2099-01-01T00:00:00.000Z'))
    await layout(page, stem, 'production-price-failed', 0)
    await screenshot(page, stem, 'production-price-failed')
    await priceRetry.click()
    await page.waitForFunction(() => window.__nextUi.getSnapshot().value.prices.length === 2 && !document.querySelector('[data-next-action="save-price"]').disabled)
    record(`${stem}:price-retry-is-one-atomic-route-specific-mutation`, await page.evaluate(() => {
      const {prices,automationPricesValidUntil}=window.__nextUi.getSnapshot().value
      return prices.length===2 && prices[0].provider==='fictional-provider' && prices[1].provider==='deepseek-account' && prices[1].input==='1.25'
        && !prices.some(price=>price.provider==='deepseek-official') && window.__nextUi.writes.at(-1).ops.length===2 && automationPricesValidUntil==='2099-01-01T00:00:00Z'
    }))
    await layout(page, stem, 'production-saved', 0)
    await screenshot(page, stem, 'production-saved')
    record(`${stem}:production-uses-no-chat-or-model-calls`, await page.evaluate(() => window.__nextUi.commands.length===0))
    await context.close()
    console.log(JSON.stringify({ type: 'responsive-case', ...item, status: checks.slice(caseStart).some(check => check.status === 'Fail') ? 'Fail' : 'Pass' }))
  }
  record('console-health', errors.length === 0, { errors })
} catch (error) {
  errors.push({ type: 'runner', message: error.message, stack: error.stack })
  console.error(JSON.stringify({ type: 'responsive-failure', message: error.message, output }))
  process.exitCode = 1
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  const result = { schemaVersion: 1, status: process.exitCode === 1 || errors.length > 0 || checks.some(check => check.status === 'Fail') ? 'Fail' : 'Pass', output, sourceSha256,
    browserPath: 'Playwright', fallbackReason: 'Browser plugin not available', url: address, dependencies, matrix, checks, errors, screenshots,
    scope: 'Actual src/client.js settings component mounted by React; Host settings/form and registration mocked. No production app, credentials, paid API or model.',
    textScaling: 'Test-only CSS doubles measured font sizes; browser viewport and OS display settings remain unchanged.',
    limitations: ['This harness validates rendered settings and interaction behavior, not native Loader activation or Host persistence.', 'Native icons and unused conversation primitives are mocked; the settings controls, CSS and React state are real.'] }
  json('result.json', result)
  if (result.status === 'Fail') process.exitCode = 1
  console.log(JSON.stringify({ type: 'responsive-complete', status: result.status, checks: checks.length, screenshots: screenshots.length, output }))
}
