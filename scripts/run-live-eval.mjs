import {spawn} from 'node:child_process'
import {mkdirSync,cpSync,symlinkSync,readFileSync,writeFileSync,existsSync,openSync,closeSync,unlinkSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {randomUUID,createHash} from 'node:crypto'
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),work=resolve(repo,'..')
const desktop=join(process.env.LOCALAPPDATA,'Programs/DeepSeek Harness'),runtime=join(desktop,'resources/app.asar/dsh/node_modules')
const executable=join(desktop,'DeepSeek Harness.exe'),cli=join(runtime,'@deepseek-ai/dsh-desktop-host/lib/cli.js')
const run=process.argv.includes('--run'),automation=process.argv.includes('--automation'),compression=process.argv.includes('--compression'),guidance=compression||process.argv.includes('--guidance'),selected=process.argv.find(a=>a.startsWith('--tasks='))?.slice(8).split(',')
const repeat=Number(process.argv.find(a=>a.startsWith('--repeat='))?.slice(9)??1)
if(!Number.isSafeInteger(repeat)||repeat<1||repeat>10)throw new Error('--repeat must be an integer from 1 to 10')
const output=join(work,'live-eval',new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8))
mkdirSync(output,{recursive:true})
const home=join(output,'dsh-home'),workspace=join(output,'workspace'),snapshot=join(output,'next-package')
for(const p of[home,workspace,snapshot])mkdirSync(p,{recursive:true})
for(const file of['package.json','lib'])cpSync(join(repo,file),join(snapshot,file),{recursive:true})
mkdirSync(join(snapshot,'node_modules'),{recursive:true});symlinkSync(join(repo,'node_modules/zod'),join(snapshot,'node_modules/zod'),'junction')
const nextUrl=pathToFileURL(join(snapshot,'lib/index.js')).href
const model={provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max'}
const prices=[{provider:model.provider,model:model.model,input:2,cacheRead:0.04,cacheWrite:2,output:8}]
for(const name of['live-eval-driver.mjs','eval-auth.mjs','eval-mcp.mjs','eval-scoring.mjs'])cpSync(join(repo,'scripts',name),join(output,name))
const tasks=[
 {id:'qa',prompt:'No tools are needed. What is 19 * 23? Reply only with the integer.',expected:'437'},
 {id:'code',files:{'solution.mjs':'export function add(a,b) { return a-b; }\n'},prompt:'Read solution.mjs, fix add(a,b) so it returns the sum of both numbers. Use native file tools. Do not use shell. Keep the export.',expected:null},
 {id:'long-file',files:{'fixture.txt':Array.from({length:150},(_,i)=>`Record ${i+1}: ${'fixture background '.repeat(8)}`).join('\n')+'\nFINAL_CODE=LONG-418\n'},prompt:'For this deliberate read-repeat compatibility test, call native read on fixture.txt twice with exactly offset=1 and limit=200, leaving it unchanged. After both calls, reply with FINAL_CODE from the file.',expected:'LONG-418'},
 {id:'web',prompt:'Use web_search to look up the official IANA Example Domains page and report the page title with its source URL. This is a public read-only check. Do not write files.',expected:'Example Domains'},
 {id:'mcp',prompt:'Use mcp__nextfixture__sum to compute 73 plus 29. Do not calculate without calling the MCP tool. Reply with the returned result.',expected:'102'},
 {id:'subagent',prompt:'Delegate computing 17 * 19 to exactly one in-process subagent, obtain its result, and reply with the result. Do not use shell or external agent providers.',expected:'323'},
 {id:'plugin',prompt:'Call next_fixture_report and report the FINAL_CODE at its end.',expected:'PLUGIN-926'},
 {id:'recovery',prompt:'Call the read-only mcp__nextfixture__flaky fixture. If it reports temporary unavailability, retry once and return the successful code.',expected:'RECOVERED-73'},
 ...automation?[
 {id:'auto-json',files:{'next-config.json':'{"count":"wrong"}\n','next-schema.json':JSON.stringify({type:'object',properties:{count:{type:'integer'}},required:['count'],additionalProperties:false})},prompt:'Read next-config.json and next-schema.json. Change count to 2 using native file tools. Confirm the final configuration meets the schema using the available read-only checking tools. Reply with COUNT=2 only after completion.',expected:'COUNT=2'},
 {id:'parallel-read',files:{'alpha.txt':'ALPHA=187\n','beta.txt':'BETA=266\n'},prompt:'Obtain two independent read-only inspections of alpha.txt and beta.txt from native in-process child agents, then report TOTAL=453. If next_parallel is available, use it for exactly two independent tasks; otherwise use the native subagent tool. Children must read their respective files. Do not edit files or use shell.',expected:'TOTAL=453'},
 ]:[],
 ...guidance?[
  {id:'fresh-verification',files:{'solution.mjs':'export function sum(values) { return values.reduce((total,n)=>total+Math.abs(n),0); }\n'},verification:{seedVersion:'positive-v1',version:'positive-v1',seedCases:[[[1,2,3],6],[[0,4],4],[[],0]],cases:[[[1,2,3],6],[[0,4],4],[[],0]]},prompt:'Ensure sum(values) in solution.mjs passes the current acceptance cases in inputs.json. Inspect the current source and the previous trusted fixture verification receipt in verification.json. You may reuse that receipt only if its source, input cases, and test suite version still match. The read-only next_fixture_verify tool can run the current acceptance cases. Preserve inputs.json and verification.json. Fix solution.mjs only if necessary. Reply VERIFIED only when current acceptance is satisfied.',expected:'VERIFIED'},
  {id:'changed-verification',files:{'solution.mjs':'export function sum(values) { return values.reduce((total,n)=>total+Math.abs(n),0); }\n'},verification:{seedVersion:'positive-v1',version:'signed-v2',seedCases:[[[1,2,3],6],[[0,4],4],[[],0]],cases:[[[1,2,3],6],[[-3,1],-2],[[-4,-2],-6],[[1.5,-0.25],1.25],[[],0]]},prompt:'Ensure sum(values) in solution.mjs passes the current acceptance cases in inputs.json. The previous trusted fixture verification receipt in verification.json is from before the input and test-suite change. Inspect the affected behavior, fix solution.mjs as needed, and run next_fixture_verify on the final source against the current acceptance cases. Preserve inputs.json and verification.json. Reply VERIFIED only when current acceptance is satisfied by an actual passing verification of the final source.',expected:'VERIFIED'},
 ]:[],
].filter(t=>!selected||selected.includes(t.id))
if(!tasks.length)throw new Error('No evaluation tasks selected')
const job={schemaVersion:2,comparison:guidance?'efficiency-guidance':'legacy-next-switch',repeat,output,workspace,runtime,package:snapshot,model,modelVersion:'DeepSeek-V4.1-Flash-1017',prices,tasks,limitCny:20,budgetPath:join(work,'live-eval-budget.json'),pricing:{source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',verifiedAt:'2026-10-18',expiresAt:'2026-10-19T00:00:00+08:00',mode:'Peak CNY token rates as conservative upper estimates, not an invoice. Harness Search/Fetch are free before 2026-11-01.'}}
if(automation)job.comparison='automatic-execution'
const verificationChecks=automation?Array.from({length:repeat},(_,index)=>[false,true].map(enabled=>({id:'json-config-r'+(index+1)+'-'+(enabled?'on':'off'),workspace:join(workspace,`auto-json${repeat>1?`-r${index+1}`:''}-${enabled?'on':'off'}`),kind:'json-schema',file:'next-config.json',schemaFile:'next-schema.json'}))).flat():[]
writeFileSync(join(snapshot,'cordis.patch.yml'),JSON.stringify([{insert:[{id:'dsh-next',name:nextUrl,config:{deduplicateReads:true,efficiencyGuidance:false,prices,verificationChecks,automationPricesValidUntil:job.pricing.expiresAt}}]}]))
if(compression){
 const baselinePath=process.argv.find(a=>a.startsWith('--baseline='))?.slice(11)
 if(!baselinePath)throw new Error('--compression requires --baseline=<preferences.js path>')
 const baseline=await import(pathToFileURL(resolve(baselinePath)).href)
 const candidate=await import(pathToFileURL(join(repo,'lib/preferences.js')).href)
 job.comparison='prompt-compression';job.guidanceVariants={off:baseline.executionGuidance({efficiencyGuidance:true}),on:candidate.executionGuidance({efficiencyGuidance:true})}
 job.promptDigests=Object.fromEntries(Object.entries(job.guidanceVariants).map(([id,text])=>[id,{chars:text.length,sha256:createHash('sha256').update(text).digest('hex')}]))
}
writeFileSync(join(output,'job.json'),JSON.stringify(job,null,2))
const env={...process.env,DSH_HOME:home,ELECTRON_RUN_AS_NODE:'1',DSH_EVAL_RUNTIME:runtime,DSH_NEXT_EVAL_JOB:join(output,'job.json')}
delete env.DSH_PERMISSION_MODE
const launch=(args,phase,timeoutMs=60000)=>new Promise((resolve,reject)=>{
 const p=spawn(executable,['--expose-internals',cli,'--profile','next-eval',...args],{cwd:workspace,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
 let stdout='',stderr='';p.stdout.on('data',d=>{stdout+=d;if(phase==='host')process.stdout.write(d)});p.stderr.on('data',d=>stderr+=d)
 const timer=setTimeout(()=>p.kill(),timeoutMs)
 p.on('error',reject);p.on('close',code=>{clearTimeout(timer);writeFileSync(join(output,phase+'-stdout.log'),stdout);writeFileSync(join(output,phase+'-stderr.log'),stderr);resolve(code)})
})
console.log(JSON.stringify({type:run?'run':'prepared',output,limitCny:20,comparison:job.comparison,repeat,model,tasks:tasks.map(t=>t.id)}))
if(!run)process.exit(0)
if(Date.now()>=Date.parse(job.pricing.expiresAt))throw new Error('Evaluation prices have expired; verify official prices before paid execution.')
const lockPath=join(work,'live-eval-budget.lock'),lock=openSync(lockPath,'wx')
let hostActive=false
process.on('exit',()=>{closeSync(lock);if(!hostActive)unlinkSync(lockPath)})
if(await launch(['--from-default-profile','web','--dump-config'],'initialize')!==0)throw new Error('Profile initialization failed')
const profile=join(home,'profiles/next-eval'),manifest=JSON.parse(readFileSync(join(profile,'package.json')))
manifest.dependencies??={};manifest.dependencies['@local/dsh-next']='file:'+snapshot.replaceAll('\\','/');manifest.dsh.profile.bundles.push('@local/dsh-next')
writeFileSync(join(profile,'package.json'),JSON.stringify(manifest,null,2));mkdirSync(join(profile,'node_modules/@local'),{recursive:true});symlinkSync(snapshot,join(profile,'node_modules/@local/dsh-next'),'junction')
const overlay=[
 {id:'credentials',disabled:true},
 {insert:[{id:'eval-credentials',name:pathToFileURL(join(output,'eval-auth.mjs')).href,config:{path:join(process.env.USERPROFILE,'.dsh/.credentials.yaml'),watch:false}}]},
 {id:'agent-default-model',config:model},
 {id:'approval',config:{policy:'never'}},
 {id:'permission',config:{defaultPreset:'workspace-write',presets:{'workspace-write':{sandbox:'workspace-write',approval:'never'}}}},
 {id:'session-title-llm',disabled:true},{id:'hmr',disabled:true},{id:'web-runtime',config:{openBrowser:false,printUrl:false}},
 {insert:[{id:'next-evaluation-mcp',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'nextfixture',transport:'stdio',command:process.execPath,args:[join(output,'eval-mcp.mjs')],failOnStartupError:true}}]},
 {insert:[{id:'next-evaluation-driver',name:pathToFileURL(join(output,'live-eval-driver.mjs')).href}]},
]
writeFileSync(join(output,'overlay.yml'),JSON.stringify(overlay,null,2))
hostActive=true
const code=await launch(['--patch',join(output,'overlay.yml'),'--no-open','--port','0'],'host',1800000)
hostActive=false
const report=existsSync(join(output,'driver-result.json'))?JSON.parse(readFileSync(join(output,'driver-result.json'))):{status:'Fail',error:'No driver result'}
if(code===0&&report.status==='Complete') {
 job.resumeOnly=true;writeFileSync(join(output,'job.json'),JSON.stringify(job,null,2))
 hostActive=true
 await launch(['--patch',join(output,'overlay.yml'),'--no-open','--port','0'],'cold-restore',120000)
 hostActive=false
 report.coldRestore=JSON.parse(readFileSync(join(output,'cold-restore.json'))).status
}
console.log(JSON.stringify({type:'finished',output,code,status:report.status,spentCnyUpper:report.spentCnyUpper,error:report.error}))
process.exitCode=code??1
