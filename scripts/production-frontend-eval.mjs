import {spawn} from 'node:child_process'
import {cpSync,mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,symlinkSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {resolve,join,dirname,relative,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {randomUUID,randomInt} from 'node:crypto'
import {MODEL,PRICING,PROMPT,FUNCTIONAL_RUBRIC,REVIEW_RUBRIC,hash} from './production-frontend-eval-core.mjs'
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=resolve(repo,'..')
const arg=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1)
const mode=arg('--run')?'run':arg('--preflight')?'preflight':'prepare'
const output=resolve(arg('--run')??arg('--preflight')??arg('--out')??join(work,'production-frontend-eval',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)))
const rel=relative(work,output)
if(!rel||rel.startsWith('..'+sep)||rel==='..')throw new Error('Output must be inside work/')
const desktop=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness'),runtime=join(desktop,'resources/app.asar/dsh/node_modules'),executable=join(desktop,'DeepSeek Harness.exe')
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n')
if(mode==='prepare'){
 if(existsSync(output))throw new Error('Prepare requires a fresh output directory')
 const store=resolve(process.env.NEXT_EVAL_PNPM_STORE??join(repo,'node_modules/.pnpm'))
 const packagePath=(prefix,name)=>{const entry=readdirSync(store).find(item=>item.startsWith(prefix));if(!entry)throw new Error('Missing offline '+name);return join(store,entry,'node_modules',name)}
 const dependencies={react:packagePath('react@18.3.1','react'),'react-dom':packagePath('react-dom@18.3.1_','react-dom'),vite:packagePath('vite@6.','vite')}
 const versions=Object.fromEntries(Object.entries(dependencies).map(([name,path])=>[name,JSON.parse(readFileSync(join(path,'package.json'),'utf8')).version]))
 mkdirSync(join(output,'private'),{recursive:true});mkdirSync(join(output,'public'),{recursive:true})
 const template={
  'package.json':JSON.stringify({name:'task-dashboard',version:'1.0.0',private:true,type:'module',scripts:{build:'node node_modules/vite/bin/vite.js build'},dependencies:{react:versions.react,'react-dom':versions['react-dom']},devDependencies:{vite:versions.vite}},null,2)+'\n',
  'package-lock.json':JSON.stringify({name:'task-dashboard',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'task-dashboard',version:'1.0.0',dependencies:{react:versions.react,'react-dom':versions['react-dom']},devDependencies:{vite:versions.vite}}}},null,2)+'\n',
  'index.html':'<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>个人任务看板</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n',
  'src/main.jsx':"import React from 'react'\nimport {createRoot} from 'react-dom/client'\ncreateRoot(document.getElementById('root')).render(React.createElement('main',null,'空白模板'))\n"
 }
 const projects=['A','B'].map(label=>({label,directory:join(output,'projects',label)}))
 for(const {directory} of projects){mkdirSync(join(directory,'src'),{recursive:true});for(const [path,content]of Object.entries(template))writeFileSync(join(directory,path),content);mkdirSync(join(directory,'node_modules'),{recursive:true});for(const [name,path]of Object.entries(dependencies))symlinkSync(path,join(directory,'node_modules',name),'junction')}
 const snapshot=join(output,'next-package');mkdirSync(snapshot,{recursive:true});for(const name of['package.json','lib'])cpSync(join(repo,name),join(snapshot,name),{recursive:true});mkdirSync(join(snapshot,'node_modules'),{recursive:true});symlinkSync(join(repo,'node_modules/zod'),join(snapshot,'node_modules/zod'),'junction')
 const nextUrl=pathToFileURL(join(snapshot,'lib/index.js')).href,prices=[{provider:MODEL.provider,model:MODEL.model,...Object.fromEntries(['input','cacheRead','cacheWrite','output'].map(key=>[key,PRICING[key]]))}]
 writeFileSync(join(snapshot,'cordis.patch.yml'),JSON.stringify([{insert:[{id:'dsh-next',name:nextUrl,config:{deduplicateReads:true,efficiencyGuidance:true,methodGuidance:true,targetedVerification:true,benefitBasedParallelism:true,automationEnabled:true,automationVerification:true,automationParallelism:true,prices,automationPricesValidUntil:PRICING.expiresAt}}]}]))
 const scripts=['production-frontend-eval-driver.mjs','production-frontend-eval-core.mjs','eval-auth.mjs'];for(const name of scripts)cpSync(join(repo,'scripts',name),join(output,name))
 const onLabel=randomInt(2)===0?'A':'B'
 const job={schemaVersion:1,runId:randomUUID(),output,runtime,package:snapshot,nextUrl,projects,conditions:projects.map(project=>({...project,enabled:project.label===onLabel})),model:MODEL,prices,pricing:PRICING,prompt:PROMPT,limitCny:10,cumulativeLimitCny:30,budgetPath:join(work,'live-eval-budget.json'),maxOutputTokens:8192,maxCaseMs:900000,maxCallsPerCase:80,versions,preparedAt:new Date().toISOString(),templateHashes:Object.fromEntries(Object.entries(template).map(([path,content])=>[path,hash(content)])),pluginHashes:Object.fromEntries(readdirSync(join(snapshot,'lib')).filter(name=>name.endsWith('.js')).map(name=>[name,hash(readFileSync(join(snapshot,'lib',name)))]))}
 json(join(output,'private/job.json'),job)
 json(join(output,'public/manifest.json'),{schemaVersion:1,projects,model:MODEL,prompt:PROMPT,promptHash:hash(PROMPT),templateHashes:job.templateHashes,versions,scoring:{functional:FUNCTIONAL_RUBRIC,review:REVIEW_RUBRIC},viewports:[{width:1440,height:900},{width:390,height:844}],policy:'Blind A/B: condition identity withheld until scoring is sealed. Never edit generated source after delivery for initial scores.'})
 console.log(JSON.stringify({status:'Prepared',output,paidCalls:0,productionLedgerChanged:false,versions,promptHash:hash(PROMPT)}));process.exit(0)
}
const job=JSON.parse(readFileSync(join(output,'private/job.json'),'utf8'))
if(mode==='run'&&!arg('--authorization'))throw new Error('Paid execution requires --authorization=<root approved audit JSON>')
if(mode==='run'&&existsSync(join(output,'private/run-budget.json')))throw new Error('This run has already started; no automatic retry')
const home=join(output,'dsh-home'),workspace=join(output,'projects');mkdirSync(home,{recursive:true})
const env={...process.env,DSH_HOME:home,ELECTRON_RUN_AS_NODE:'1',DSH_EVAL_RUNTIME:runtime,DSH_NEXT_PRODUCTION_EVAL_JOB:join(output,'private/job.json'),DSH_NEXT_PRODUCTION_EVAL_MODE:mode,NODE_OPTIONS:'--max-http-header-size=65536'}
delete env.DSH_PERMISSION_MODE
if(mode==='run')env.DSH_NEXT_PRODUCTION_EVAL_AUTH=resolve(arg('--authorization'))
const launch=(args,phase,timeoutMs)=>new Promise((complete,reject)=>{
 const p=spawn(executable,['--expose-internals',join(runtime,'@deepseek-ai/dsh-desktop-host/lib/cli.js'),'--profile','next-production-eval',...args],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
 let stdout='',stderr='';p.stdout.on('data',data=>{stdout+=data;const lines=String(data).split('\n');for(const line of lines)if(line.startsWith('{"type":"production-eval'))process.stdout.write(line+'\n')});p.stderr.on('data',data=>stderr+=data)
 json(join(output,'private/'+phase+'-process.json'),{pid:p.pid,startedAt:new Date().toISOString(),phase,temporaryHeaderLimitBytes:65536})
 const timer=setTimeout(()=>p.kill(),timeoutMs)
 p.once('error',reject);p.once('close',(code,signal)=>{clearTimeout(timer);writeFileSync(join(output,'private',phase+'-stdout.log'),stdout);writeFileSync(join(output,'private',phase+'-stderr.log'),stderr);complete({code,signal})})
})
if(!existsSync(join(home,'profiles/next-production-eval/package.json'))){const initialized=await launch(['--from-default-profile','web','--dump-config'],'initialize',60000);if(initialized.code!==0)throw new Error('Isolated native profile initialization failed');const profile=join(home,'profiles/next-production-eval'),path=join(profile,'package.json'),manifest=JSON.parse(readFileSync(path,'utf8'));manifest.dependencies??={};manifest.dependencies['@local/dsh-next']='file:'+job.package.replaceAll('\\','/');manifest.dsh.profile.bundles.push('@local/dsh-next');json(path,manifest);mkdirSync(join(profile,'node_modules/@local'),{recursive:true});symlinkSync(job.package,join(profile,'node_modules/@local/dsh-next'),'junction')}
const overlay=[{id:'credentials',disabled:true},{insert:[{id:'eval-credentials',name:pathToFileURL(join(output,'eval-auth.mjs')).href,config:{path:join(process.env.USERPROFILE,'.dsh/.credentials.yaml'),watch:false}}]},{id:'agent-default-model',config:MODEL},{id:'approval',config:{policy:'never'}},{id:'permission',config:{defaultPreset:'frontend-fixed-build',presets:{'frontend-fixed-build':{sandbox:'danger-full-access',approval:'never'}}}},{id:'session-title-llm',disabled:true},{id:'hmr',disabled:true},{id:'web-runtime',config:{openBrowser:false,printUrl:false}},{id:'llm-deepseek-account',config:{retryPolicy:{mode:'normal',maxRetries:0}}},{id:'tool-pwsh',config:{enableRunInBackground:false,promoteOnTimeout:false}},{insert:[{id:'production-frontend-evaluation-driver',name:pathToFileURL(join(output,'production-frontend-eval-driver.mjs')).href}]}]
json(join(output,'private/overlay.yml'),overlay)
let lock,lockPath
try{if(mode==='run'){lockPath=join(work,'live-eval-budget.lock');lock=openSync(lockPath,'wx')}
 const result=await launch(['--patch',join(output,'private/overlay.yml'),'--no-open','--port','0'],mode,mode==='run'?2100000:120000)
 console.log(JSON.stringify({status:result.code===0?'Finished':'Fail',mode,output,...result}));process.exitCode=result.code??1
}finally{if(lock!==undefined){closeSync(lock);unlinkSync(lockPath)}}
