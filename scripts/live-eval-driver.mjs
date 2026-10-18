import { readFileSync,writeFileSync,mkdirSync,existsSync,renameSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join,resolve,sep,basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID,createHash } from 'node:crypto'
import { subagentReceiptEvidence } from './eval-scoring.mjs'
export const name='next-live-evaluation'
export const inject=['sessionController','agents','commands','sessions','sessionProjections','tools','settings','systemPrompt']
const sha256=value=>createHash('sha256').update(value).digest('hex')
const messageText=event=>(event?.data?.message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n')
const finalText=events=>messageText(events.filter(event=>event.type==='assistant/message'&&!(event.data.message.content??[]).some(block=>block.type==='tool-call')).at(-1))
const parseArguments=event=>{try{return typeof event.data.arguments==='string'?JSON.parse(event.data.arguments):event.data.arguments??{}}catch{return{}}}
function runSumCases(source,cases) {
  try { return runInNewContext(source.replace(/\bexport\s+/g,'')+'; '+JSON.stringify(cases)+'.every(([values,want])=>sum(values)===want)',{}, {timeout:100,contextCodeGeneration:{strings:false,wasm:false}})===true }
  catch { return false }
}
export function apply(ctx) {
  const job=JSON.parse(readFileSync(process.env.DSH_NEXT_EVAL_JOB,'utf8'))
  const automation=job.comparison==='automatic-execution',guidance=['efficiency-guidance','prompt-compression'].includes(job.comparison),limitCny=Math.min(20,job.limitCny??20)
  const ledgerPath=job.budgetPath??join(job.output,'budget-ledger.json')
  const ledger=existsSync(ledgerPath)?JSON.parse(readFileSync(ledgerPath,'utf8')):{limitCny,spentCny:0,reservations:{},records:[],paused:false}
  const saveLedger=()=>{writeFileSync(ledgerPath+'.tmp',JSON.stringify(ledger,null,2));renameSync(ledgerPath+'.tmp',ledgerPath);writeFileSync(join(job.output,'budget-ledger.json'),JSON.stringify(ledger,null,2))}
  const outstanding=()=>Object.values(ledger.reservations).reduce((a,b)=>a+b,0)
  void Promise.resolve().then(async()=>{
    const meterModule=await import(pathToFileURL(join(job.package,'lib/meter.js')))
    const {createMeter,estimateCallReservation,canReserveBudget}=meterModule
    const {defineTool,assertSupportedJsonSchema}=await import(pathToFileURL(join(job.runtime,'@deepseek-ai/dsh-tools/lib/index.js')))
    for(const task of job.tasks)if(task.id==='auto-json')assertSupportedJsonSchema(JSON.parse(task.files['next-schema.json']))
    const peak=job.prices?.find(price=>price.provider===job.model.provider&&price.model===job.model.model)??{...job.model,input:2,cacheRead:0.04,cacheWrite:2,output:8}
    const results=[],pending=[],verificationRuns=[],fixtureSpecs=new Map(),modelRequests=[],disposedChildren=new Map()
    let currentCase=null,activeAgent=null,driverResetCallId=null
    const isDescendant=(candidate,root)=>{
      let session=candidate.session;const seen=new Set()
      while(session&&!seen.has(session.id)) {if(session.id===root.id)return true;seen.add(session.id);session=session.header.parentSession?ctx.sessions.get(session.header.parentSession):null}
      return false
    }
    const caseAgents=agent=>ctx.agents.list().filter(candidate=>isDescendant(candidate,agent))
    ctx.on('agent/disposed',({agent})=>{
      if(!activeAgent||agent.id===activeAgent.id||!isDescendant(agent,activeAgent))return
      const record={id:agent.id,parentSession:agent.session.header.parentSession,events:agent.session.snapshotEvents()}
      disposedChildren.set(agent.id,record)
      writeFileSync(join(job.output,`${currentCase}-child-${agent.id}-events.jsonl`),record.events.map(event=>JSON.stringify(event)).join('\n')+'\n')
    },{global:true})
    const drainCase=async agent=>{for(let pass=0;pass<3;pass++){await Promise.all(caseAgents(agent).map(candidate=>candidate.whenIdle()));await Promise.resolve()}}
    const cancelCase=agent=>{for(const candidate of caseAgents(agent))candidate.cancel({kind:'user'})}
    ctx.on('llm/stream',(options,next)=>{
      if(job.resumeOnly)throw new Error('Cold restore must not make model calls')
      if(ledger.paused)throw new Error('Evaluation paused: an earlier request has unknown cost')
      if(Date.now()>=Date.parse(job.pricing.expiresAt??'2026-10-19T00:00:00+08:00')){ledger.paused=true;saveLedger();throw new Error('Evaluation prices expired before dispatch')}
      if(options.provider!==job.model.provider||options.model!==job.model.model||options.reasoningEffort!==job.model.reasoningEffort) {ledger.paused=true;saveLedger();throw new Error('Unexpected model or reasoning route refused before dispatch')}
      const maxOutputTokens=options.maxTokens??393216
      const reservation=estimateCallReservation({inputTokens:1048576,maxOutputTokens,price:peak})
      if(!canReserveBudget({limitCny,spentCny:ledger.spentCny,reservedCny:outstanding()},reservation.costCny)){ledger.paused=true;saveLedger();throw new Error('Evaluation budget does not admit the next request')}
      const item={id:randomUUID(),caseId:currentCase,sessionId:options.sessionId,cost:reservation.costCny,settled:false}
      pending.push(item);ledger.reservations[item.id]=item.cost;saveLedger()
      modelRequests.push({caseId:currentCase,sessionId:options.sessionId,provider:options.provider,model:options.model,reasoningEffort:options.reasoningEffort,maxTokens:maxOutputTokens})
      // One meter per dispatch ties settlement to its exact reservation, even when child calls finish out of order.
      const meter=createMeter({prices:[peak],onRecord(record){
        item.settled=true;delete ledger.reservations[item.id]
        if(record.costCny===null){ledger.reservations[item.id]=item.cost;ledger.paused=true}
        else ledger.spentCny+=record.costCny
        ledger.records.push({...record,caseId:item.caseId,reservationId:item.id});saveLedger()
      }})
      return meter.wrap(options,next)
    },{global:true,prepend:true})
    ctx.on('agent/request',async(_payload,next)=>({...await next(),maxTokens:8192}),{global:true})
    ctx.tools.register(defineTool({name:'next_fixture_report',description:'Read a large fictional report; the answer code occurs at its end.',parameters:{},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},execute:()=>('Fictional quarterly record: unchanged background.\n'.repeat(240)+'FINAL_CODE=PLUGIN-926')}))
    ctx.tools.register(defineTool({name:'next_fixture_verify',description:'Read-only verification of fixture sum(values) using current immutable acceptance cases. Runs no shell. Returns the actual source hash, input hash, test suite version and pass result.',parameters:{},output:{schema:{type:'object',properties:{caseId:{type:'string'},sourceHash:{type:'string'},inputHash:{type:'string'},testSuiteVersion:{type:'string'},passed:{type:'boolean'},cases:{type:'number'}},additionalProperties:false},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:(_args,exec)=>{
      const directory=resolve(exec.agent?.session.header.cwd??'')
      const spec=fixtureSpecs.get(directory)
      if(!spec)throw new Error('No verification fixture exists in this session')
      const source=readFileSync(join(directory,'solution.mjs'),'utf8')
      const record={caseId:spec.caseId,sourceHash:sha256(source),inputHash:spec.inputHash,testSuiteVersion:spec.version,passed:runSumCases(source,spec.cases),cases:spec.cases.length}
      verificationRuns.push(record)
      return record
    }}))
    const allowed=new Set(['read','write','edit','web_search','web_fetch','web','subagent','subagent_fork','list_agents','wait','send_message','next_fixture_report','next_fixture_verify','next_verify','next_parallel','structured_output','mcp__nextfixture__sum','mcp__nextfixture__flaky'])
    ctx.on('tools/pre-execute',async(exec,next)=>{
      if(exec.name==='mcp__nextfixture__reset')return exec.callId===driverResetCallId&&exec.agent===undefined?next():{kind:'deny',reason:'Fixture reset is private to the evaluation driver.'}
      if(!allowed.has(exec.name))return {kind:'deny',reason:'Evaluation permits only fixture files, public web reads and local test tools.'}
      if(['read','write','edit'].includes(exec.name)) {
        const file=resolve(exec.agent?.session.header.cwd??job.workspace,exec.arguments.file_path??'')
        if(!file.startsWith(resolve(job.workspace)+sep))return {kind:'deny',reason:'Evaluation access is restricted to its fixture workspace.'}
        if(exec.name!=='read'&&['inputs.json','verification.json','next-schema.json'].includes(basename(file)))return {kind:'deny',reason:'Verification inputs and prior receipts are immutable evaluation fixtures.'}
      }
      return next()
    },{global:true,prepend:true})
    try {
      await ctx.get('loader')?.await()
      // This global MCP definition remains callable without an Agent only for the driver nonce.
      // Scoped restrictions remove it from model schemas for parents and all future children.
      ctx.on('agent/created',({agent})=>{agent.ctx.tools.restrict({deny:['mcp__nextfixture__reset']})},{global:true})
      if(job.resumeOnly) {
        const persisted=JSON.parse(readFileSync(join(job.output,'results.json'),'utf8')),checked=[]
        for(const item of persisted) {
          const handle=await ctx.agents.resume({resumeSessionId:item.sessionId})
          checked.push({id:item.id,enabled:item.enabled,guidanceEnabled:item.guidanceEnabled,repeat:item.repeat,sessionId:item.sessionId,restored:true})
          await handle.dispose()
        }
        writeFileSync(join(job.output,'cold-restore.json'),JSON.stringify({status:'Pass',checked},null,2));process.exit(0)
      }
      evaluation: for(let repetition=1;repetition<=(job.repeat??1);repetition++)for(const [taskIndex,task]of job.tasks.entries()) {
        const order=(taskIndex+repetition-1)%2===0?[false,true]:[true,false]
        for(const enabled of order) {
          if(ledger.paused||outstanding()>0){ledger.paused=true;break evaluation}
          currentCase=`${task.id}${(job.repeat??1)>1?`-r${repetition}`:''}-${enabled?'on':'off'}`
          const directory=join(job.workspace,currentCase);mkdirSync(directory,{recursive:true})
          for(const [file,content]of Object.entries(task.files??{}))writeFileSync(join(directory,file),content)
          let previousReceipt=null
          if(task.verification) {
            const spec=task.verification,source=readFileSync(join(directory,'solution.mjs'),'utf8')
            if(!runSumCases(source,spec.seedCases))throw new Error('Invalid seed verification fixture')
            previousReceipt={sourceHash:sha256(source),inputHash:sha256(JSON.stringify(spec.seedCases)),testSuiteVersion:spec.seedVersion,passed:true,cases:spec.seedCases}
            fixtureSpecs.set(resolve(directory),{...spec,caseId:currentCase,inputHash:sha256(JSON.stringify(spec.cases))})
            writeFileSync(join(directory,'verification.json'),JSON.stringify(previousReceipt,null,2))
            writeFileSync(join(directory,'inputs.json'),JSON.stringify({testSuiteVersion:spec.version,inputHash:sha256(JSON.stringify(spec.cases)),cases:spec.cases},null,2))
          }
          const created=await ctx.sessionController.create({cwd:directory}),agent=ctx.agents.get(created.sessionId);activeAgent=agent
          await ctx.sessionController.selectModel({sessionId:agent.id,...job.model})
          const signal=new AbortController().signal
          const nextEnabled=automation||guidance||enabled
          const command=await ctx.commands.execute(agent,`/next ${nextEnabled?'on':'off'}`,[],signal)
          if(!['success'].includes(command?.result?.kind??command?.kind)||ctx.sessionProjections.stateOf(agent.session,'next')?.active!==nextEnabled)throw new Error('NEXT state did not acknowledge the evaluation condition')
          const compression=job.comparison==='prompt-compression'
          const wantedPreferences={deduplicateReads:true,efficiencyGuidance:compression||(guidance&&enabled),methodGuidance:true,targetedVerification:true,benefitBasedParallelism:true,outputLanguage:'auto',responseStyle:'standard',...automation?{automationEnabled:enabled,automationVerification:true,automationParallelism:true,automationBudgetCny:3}:{}}
          await ctx.settings.update('dsh-next',wantedPreferences)
          const actual=ctx.settings.describe().find(item=>item.ns==='dsh-next')?.value
          const actualPreferences=Object.fromEntries(Object.keys(wantedPreferences).map(field=>[field,actual?.[field]]))
          if(Object.keys(wantedPreferences).some(field=>actualPreferences[field]!==wantedPreferences[field]))throw new Error('Evaluation preferences did not acknowledge the condition')
          if(compression)agent.ctx.systemPrompt.section({name:'next:efficiency',order:agent.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX')+20,text:job.guidanceVariants[enabled?'on':'off']})
          const assembly=await agent.ctx.systemPrompt.assemble({agent,scope:agent})
          const promptSections=assembly.sections.filter(section=>section.name==='next:efficiency'||section.name==='next:preferences').map(({name,text})=>({name,text}))
          const guidanceSections=promptSections.filter(section=>section.name==='next:efficiency'&&section.text.length>0)
          if(guidanceSections.length!==((compression||(guidance&&enabled))?1:0))throw new Error('Efficiency guidance was missing, duplicated or enabled in the control condition')
          if(compression&&guidanceSections[0].text!==job.guidanceVariants[enabled?'on':'off'])throw new Error('Prompt compression condition did not match the fixed text')
          if(agent.ctx.tools.schemas(agent).some(tool=>tool.name==='mcp__nextfixture__reset'))throw new Error('Private fixture reset leaked into the model tool schema')
          driverResetCallId=randomUUID()
          const reset=await ctx.tools.execute({name:'mcp__nextfixture__reset',callId:driverResetCallId,arguments:{},signal})
          driverResetCallId=null
          if(reset.isError)throw new Error('MCP fixture could not reset before the condition')
          const startRecord=ledger.records.length,started=Date.now()
          let error=null,timedOut=false
          const timer=setTimeout(()=>{timedOut=true;cancelCase(agent)},150000)
          try {
            await ctx.sessionController.prompt({sessionId:agent.id,requestId:randomUUID(),mode:'followup',clientTimeZone:'Asia/Shanghai',content:[{type:'text',text:`This is an isolated evaluation with fictional files. Use only native file tools for files under your current working directory; do not use a shell. Execute the stated task without questions.\n${task.prompt}`}]},signal)
            await drainCase(agent)
          }catch(e){error=String(e);cancelCase(agent);await drainCase(agent)}
          finally{clearTimeout(timer);if(timedOut&&error===null)error='Evaluation task timed out and was cancelled'}
          await ctx.sessions.flush(agent.session)
          const events=agent.session.snapshotEvents(),text=finalText(events),toolEvents=events.filter(event=>event.type==='tool/call')
          const toolResults=new Map(events.filter(event=>event.type==='tool/result'&&event.surfaceOp==='append').map(event=>[event.data.message.toolCallId,event]))
          const successfulCalls=toolEvents.filter(event=>toolResults.has(event.data.callId)&&toolResults.get(event.data.callId).data.message.isError!==true)
          const succeeded=name=>successfulCalls.filter(event=>event.data.name===name)
          let outcomeCorrect=task.expected?text.includes(task.expected):false,processCompliant=true,verificationComplete=null,verificationEvidence=null
          if(task.id==='qa')outcomeCorrect=text.trim()==='437'
          if(task.id==='code') {
            try {const code=readFileSync(join(directory,'solution.mjs'),'utf8').replace(/\bexport\s+/g,'');outcomeCorrect=runInNewContext(code+'; [[2,3,5],[0,0,0],[-4,7,3],[1.5,2.25,3.75],[1000000,1,1000001]].every(([a,b,want])=>add(a,b)===want)',{}, {timeout:100,contextCodeGeneration:{strings:false,wasm:false}})===true}catch{outcomeCorrect=false}
            processCompliant=succeeded('read').length>0
          }
          if(task.id==='long-file')processCompliant=succeeded('read').filter(event=>{const args=parseArguments(event);return basename(args.file_path??'')==='fixture.txt'&&args.offset===1&&args.limit===200}).length===2&&readFileSync(join(directory,'fixture.txt'),'utf8')===task.files['fixture.txt']
          if(task.id==='web')processCompliant=succeeded('web_search').length>0&&/https:\/\/(?:www\.)?iana\.org\/help\/example-domains\b/i.test(text)&&succeeded('web_search').some(event=>messageText(toolResults.get(event.data.callId)).includes('iana.org'))
          if(task.id==='mcp')processCompliant=succeeded('mcp__nextfixture__sum').some(event=>messageText(toolResults.get(event.data.callId)).trim()==='102')
          if(task.id==='plugin')processCompliant=succeeded('next_fixture_report').some(event=>messageText(toolResults.get(event.data.callId)).includes('PLUGIN-926'))
          if(task.id==='subagent') {
            const children=ctx.sessions.list().filter(session=>session.header.parentSession===agent.id)
            processCompliant=succeeded('subagent').length===1&&(Boolean(subagentReceiptEvidence(events))||children.some(session=>/\b323\b/.test(finalText(session.snapshotEvents()))&&session.snapshotEvents().some(event=>event.type==='turn/end'&&event.data.reason?.kind==='completed')))
          }
          if(task.id==='recovery') {
            const flaky=toolEvents.filter(event=>event.data.name==='mcp__nextfixture__flaky')
            processCompliant=flaky.length===2&&toolResults.get(flaky[0].data.callId)?.data.message.isError===true&&toolResults.get(flaky[1].data.callId)?.data.message.isError!==true&&messageText(toolResults.get(flaky[1].data.callId)).includes('RECOVERED-73')
          }
          const automationState=ctx.sessionProjections.stateOf(agent.session,'nextAutomation')
          if(task.id==='auto-json') {
            try{outcomeCorrect=JSON.parse(readFileSync(join(directory,'next-config.json'),'utf8')).count===2&&text.trim()==='COUNT=2'&&readFileSync(join(directory,'next-schema.json'),'utf8')===task.files['next-schema.json']}catch{outcomeCorrect=false}
            const verified=events.filter(event=>event.type==='plugin:next/verification').map(event=>event.data)
            const nativeView=value=>value.replaceAll('\r\n','\n').replace(/\n$/u,'')
            const passing=verified.some(record=>record.passed===true&&['executed','reused'].includes(record.status)&&record.source.sessionId===agent.id&&record.inputHash===sha256(nativeView(readFileSync(join(directory,'next-config.json'),'utf8')))&&record.schemaHash===sha256(nativeView(readFileSync(join(directory,'next-schema.json'),'utf8'))))
            processCompliant=succeeded('read').length>0&&passing
            verificationComplete=passing
          }
          if(task.id==='parallel-read') {
            const children=new Map([...disposedChildren.values()].filter(child=>child.parentSession===agent.id).map(child=>[child.id,child.events]))
            for(const session of ctx.sessions.list().filter(session=>session.header.parentSession===agent.id))children.set(session.id,session.snapshotEvents())
            const validChildReads=[...children.values()].map(events=>{
              const successfulReads=events.filter(event=>event.type==='tool/call'&&event.data.name==='read').map(call=>({args:parseArguments(call),result:events.find(event=>event.type==='tool/result'&&event.surfaceOp==='append'&&event.data.message.toolCallId===call.data.callId&&event.data.message.isError!==true)})).filter(item=>item.result)
              return {completed:events.some(event=>event.type==='turn/end'&&event.data.reason?.kind==='completed'),successfulReads}
            })
            processCompliant=children.size===2&&validChildReads.every(child=>child.completed)&&[['alpha.txt','ALPHA=187'],['beta.txt','BETA=266']].every(([file,expected])=>validChildReads.some(child=>child.successfulReads.some(({args,result})=>basename(args.file_path??'')===file&&messageText(result).includes(expected))))
            if(enabled)processCompliant=processCompliant&&succeeded('next_parallel').length===1&&Object.keys(automationState.budget.reservations).length===0&&automationState.budget.spentCny>0&&automationState.budget.spentCny<=3
          }
          if(task.verification) {
            const spec=fixtureSpecs.get(resolve(directory)),source=readFileSync(join(directory,'solution.mjs'),'utf8'),sourceHash=sha256(source)
            const freshPrevious=previousReceipt.sourceHash===sourceHash&&previousReceipt.inputHash===spec.inputHash&&previousReceipt.testSuiteVersion===spec.version&&previousReceipt.passed===true
            const actualRuns=verificationRuns.filter(record=>record.caseId===currentCase)
            const currentPassingRun=actualRuns.some(record=>record.passed&&record.sourceHash===sourceHash&&record.inputHash===spec.inputHash&&record.testSuiteVersion===spec.version)
            const inspectedPrevious=['solution.mjs','inputs.json','verification.json'].every(file=>succeeded('read').some(event=>basename(parseArguments(event).file_path??'')===file))
            outcomeCorrect=runSumCases(source,spec.cases)&&text.includes('VERIFIED')
            verificationComplete=task.id==='changed-verification'?currentPassingRun:currentPassingRun||(freshPrevious&&inspectedPrevious)
            processCompliant=verificationComplete
            verificationEvidence={sourceHash,inputHash:spec.inputHash,testSuiteVersion:spec.version,freshPrevious,currentPassingRun,inspectedPrevious,runs:actualRuns}
          }
          const calls=ledger.records.slice(startRecord).filter(record=>record.caseId===currentCase)
          const completed=events.filter(event=>event.type==='turn/end').at(-1)?.data.reason?.kind==='completed'
          const pass=error===null&&completed&&outcomeCorrect&&processCompliant
          const result={id:task.id,repeat:repetition,comparison:job.comparison??'legacy-next-switch',enabled:nextEnabled,...guidance?{guidanceEnabled:enabled}:{},condition:enabled?'on':'off',sessionId:agent.id,pass,completed,outcomeCorrect,processCompliant,verificationComplete,verificationEvidence,error,actualPreferences,promptSections,modelRequests:modelRequests.filter(request=>request.caseId===currentCase),elapsedMs:Date.now()-started,calls:calls.length,costCnyUpper:calls.some(call=>call.costCny===null)?null:calls.reduce((sum,call)=>sum+call.costCny,0),usageComplete:calls.length>0&&calls.every(call=>call.usageComplete),tokens:meterModule.summarizeRecords(calls).tokens,toolCalls:toolEvents.map(event=>event.data.name),fileMutations:toolEvents.filter(event=>['write','edit'].includes(event.data.name)).length,verificationRuns:verificationRuns.filter(record=>record.caseId===currentCase).length,failedVerificationRuns:verificationRuns.filter(record=>record.caseId===currentCase&&!record.passed).length,deduplicatedReads:ctx.sessionProjections.stateOf(agent.session,'nextMetrics')?.view.deduplicatedReads??0,text}
          if(automation){result.automationEnabled=enabled;result.automationState=automationState}
          results.push(result)
          writeFileSync(join(job.output,`${currentCase}-events.jsonl`),events.map(event=>JSON.stringify(event)).join('\n')+'\n')
          writeFileSync(join(job.output,'results.json'),JSON.stringify(results,null,2))
          console.log(JSON.stringify({type:'case',id:task.id,repeat:repetition,enabled:nextEnabled,...guidance?{guidanceEnabled:enabled}:{},pass,calls:result.calls,costCnyUpper:result.costCnyUpper,elapsedMs:result.elapsedMs}))
          if(ledger.paused||outstanding()>0||pending.some(item=>item.caseId===currentCase&&!item.settled)||ledger.spentCny+outstanding()>=limitCny){ledger.paused=true;break evaluation}
        }
      }
      saveLedger()
      writeFileSync(join(job.output,'driver-result.json'),JSON.stringify({status:ledger.paused?'Partial':'Complete',comparison:job.comparison??'legacy-next-switch',repeat:job.repeat??1,model:job.model,modelVersion:job.modelVersion,pricing:job.pricing,results,spentCnyUpper:ledger.spentCny,outstandingReservationsCny:outstanding(),limitCny,limitations:['Small paired samples are exploratory; compare cost and elapsed time only for conditions with equivalent successful acceptance.','Peak token prices are upper estimates, not provider invoices; cache and network variation are reported separately.','Verification receipts are controlled fixtures; this tests workflow guidance, not automatic evidence reuse.','All file mutations are restricted to isolated fixture workspaces; no production files were changed.']},null,2))
      process.exit(0)
    }catch(error){if(activeAgent){cancelCase(activeAgent);await drainCase(activeAgent)}saveLedger();writeFileSync(join(job.output,job.resumeOnly?'cold-restore.json':'driver-result.json'),JSON.stringify({status:'Fail',error:String(error),stack:error.stack,results,spentCnyUpper:ledger.spentCny,outstandingReservationsCny:outstanding()},null,2));process.exit(1)}
  }).catch(error=>{console.error('Evaluation initialization failed',error.message);process.exit(1)})
}
