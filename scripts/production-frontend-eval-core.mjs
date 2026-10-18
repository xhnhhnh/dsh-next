import {createHash} from 'node:crypto'

export const hash=value=>createHash('sha256').update(value).digest('hex')
export const nativeText=value=>String(value).replaceAll('\r\n','\n').replace(/\n$/u,'')
export const MODEL=Object.freeze({provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'max'})
export const PRICING=Object.freeze({source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/?tab=case-studies',modelSource:'https://api-docs.deepseek.com/zh-cn/updates/',verifiedAt:'2026-10-18',expiresAt:'2026-10-19T00:00:00+08:00',input:2,cacheRead:0.04,cacheWrite:2,output:8,units:'CNY per million tokens',interpretation:'Conservative peak token rates; not an invoice. Model alias is rolling, not immutable weights.'})
export const FUNCTIONAL_RUBRIC=Object.freeze({startup:6,create:8,validation:6,edit:8,delete:6,metadata:6,filters:8,persistence:8,empty:4})
export const REVIEW_RUBRIC=Object.freeze({visual:{hierarchy:5,layout:5,consistency:5,responsive:5},accessibility:{labels:3,keyboard:3,contrast:2,feedback:2},maintainability:{structure:3,state:3,robustness:2,clarity:2}})
export const PROMPT=`Build a complete React + Vite personal task dashboard in this existing workspace. Work without questions. The blank template and pinned offline dependencies are already prepared. Use the native file tools to implement it. You may run ONLY the exact command npm run build through pwsh in this workspace, or the registered build check through next_verify when available. No installs, network, other folders, background processes, or changes to package.json/package-lock.json/node_modules. Do not create or modify any build configuration file (Vite/PostCSS/Tailwind/Rollup/Webpack/Babel configs, .babelrc, or .npmrc); the default Vite configuration is sufficient.

Required: add, edit and delete tasks; title, status (todo/doing/done) and priority (low/medium/high); combined search/status/priority filtering; localStorage persistence under next-productivity-tasks-v1; reject blank/whitespace titles and provide visible accessible feedback; show empty results clearly; polished responsive desktop/mobile layout. Start with no saved tasks. Use Chinese interface text. Aim for a useful polished productivity tool, with meaningful information hierarchy and good keyboard operation. No backend or external assets.

For repeatable independent acceptance, include these data-testid attributes with real semantic controls: task-form (always visible form), task-title (title input), task-status and task-priority (native selects using the values above), task-submit (submit button), task-search (search input), status-filter and priority-filter (native selects, with all for no restriction), task-error (visible validation message with role=alert), task-empty (visible empty-state), task-row (each task container), task-row-title, task-row-status, task-row-priority (its text fields), task-edit and task-delete (buttons in each row). Editing loads the selected task into the same form. Deletion may use a native confirm dialog. Add visible labels, accessible button names and keyboard focus styles. Preserve these contracts; you choose the visual design and component structure freely.

Implement fully, build and fix any build failure before finishing. If a registered automatic build has already passed for the final unchanged files, its actual result is sufficient; otherwise run the build. Report actual checks and any limitations briefly. Do not claim browser tests you did not execute.`

export function authorizeRun(ledger,{runId,at,priorHostsEnded,transportPreflight,authorization}) {
  if(!runId||!authorization||priorHostsEnded!==true||transportPreflight!==true)throw new Error('Explicit authorization, ended prior hosts and a successful read-only transport preflight are required')
  if(ledger.limitCny!==20&&ledger.limitCny!==30)throw new Error('Unexpected historical budget limit')
  const next=structuredClone(ledger),legacyReservations=structuredClone(next.reservations)
  next.limitCny=30
  next.authorizations??=[]
  if(next.authorizations.some(item=>item.runId===runId))throw new Error('Run authorization already exists')
  const prior=next.authorizations.find(item=>item.experiment==='next-production-0.8.0-frontend')
  if(prior&&ledger.paused)throw new Error('A paused request from this experiment cannot be resumed by preparing another run')
  const experimentBaselineSpentCny=prior?.experimentBaselineSpentCny??ledger.spentCny
  const experimentLegacyReservations=prior?.experimentLegacyReservations??legacyReservations
  next.authorizations.push({runId,at,authorization,experiment:'next-production-0.8.0-frontend',additionalLimitCny:10,experimentBaselineSpentCny,experimentLegacyReservations,previousLimitCny:ledger.limitCny,previousPaused:ledger.paused,priorHostsEnded,transportPreflight,legacyReservationsRetained:true})
  next.paused=false
  return {ledger:next,run:{runId,limitCny:10,baselineSpentCny:ledger.spentCny,experimentBaselineSpentCny,legacyReservations:experimentLegacyReservations,spentCny:0,reservations:{},paused:false,records:[]}}
}

export function admission({ledger,run,reservation,now,expiresAt}) {
  if(ledger.paused||run.paused)return {allowed:false,reason:'paused'}
  if(!Number.isFinite(Date.parse(expiresAt))||now>=Date.parse(expiresAt))return {allowed:false,reason:'price-expired'}
  if(!Number.isFinite(reservation)||reservation<0)return {allowed:false,reason:'invalid-reservation'}
  const sum=values=>Object.values(values).reduce((a,b)=>a+b,0)
  const experimentSpent=ledger.spentCny-run.experimentBaselineSpentCny
  const experimentReservations=Object.fromEntries(Object.entries(ledger.reservations).filter(([id])=>run.legacyReservations[id]===undefined))
  if(experimentSpent+sum(experimentReservations)+reservation>10+1e-12)return {allowed:false,reason:'run-budget'}
  if(ledger.spentCny+sum(ledger.reservations)+reservation>30+1e-12)return {allowed:false,reason:'cumulative-budget'}
  return {allowed:true}
}

export function reserveRequest(ledger,run,{id,costCny}) {
  if(ledger.reservations[id]!==undefined||run.reservations[id]!==undefined)throw new Error('Duplicate reservation')
  ledger.reservations[id]=costCny;run.reservations[id]=costCny
}
export function settleRequest(ledger,run,record) {
  if(run.records.some(item=>item.reservationId===record.reservationId))return false
  const id=record.reservationId
  if(run.reservations[id]===undefined||ledger.reservations[id]===undefined)throw new Error('Unknown reservation settlement')
  if(record.costCny===null){ledger.paused=true;run.paused=true}
  else {
    if(!Number.isFinite(record.costCny)||record.costCny<0||record.costCny>run.reservations[id]+1e-12)throw new Error('Settlement exceeded conservative reservation')
    delete ledger.reservations[id];delete run.reservations[id]
    ledger.spentCny+=record.costCny;run.spentCny+=record.costCny
  }
  ledger.records.push(record);run.records.push(record)
  return true
}
export function scoreFunctional(observations) {
  const items=Object.entries(FUNCTIONAL_RUBRIC).map(([id,points])=>({id,points,passed:observations[id]===true,earned:observations[id]===true?points:0}))
  return {items,earned:items.reduce((a,b)=>a+b.earned,0),possible:60}
}
