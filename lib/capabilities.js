import { z } from 'zod'

export const CAPABILITIES_RECORD = 'plugin:next/capabilities'
const item=z.object({status:z.enum(['ready','off','blocked','unknown']),reason:z.string()}).strict()
const statuses=z.object({optimization:item,verification:item,retrieval:item,parallel:item}).strict()
const route=z.object({provider:z.string(),model:z.string()}).nullable()
const check=z.object({id:z.string(),kind:z.string(),status:z.string(),reason:z.string()}).strict()
export const capabilitySnapshotSchema=z.object({sessionId:z.string(),workspace:z.string(),route,capabilities:statuses,checks:z.array(check),updatedAt:z.number()}).strict()
const empty=()=>({status:'unknown',reason:'Open a project conversation to inspect capabilities.'})
export const capabilitiesProjection={
  key:'nextCapabilities',stateVersion:1,
  stateSchema:capabilitySnapshotSchema.extend({inheritedUntil:z.number()}).strict(),
  init:(header={},inheritedUntil=0)=>({sessionId:header.id??'',workspace:header.cwd??'',route:null,capabilities:{optimization:empty(),verification:empty(),retrieval:empty(),parallel:empty()},checks:[],updatedAt:0,inheritedUntil}),
  apply(state,event){
    if(event.type!==CAPABILITIES_RECORD||event.ignorable!==true||event.seq<state.inheritedUntil)return state
    const parsed=capabilitySnapshotSchema.safeParse(event.data)
    return parsed.success?{...parsed.data,inheritedUntil:state.inheritedUntil}:state
  },
  wire:{viewSchema:capabilitySnapshotSchema,view:({inheritedUntil,...view})=>view},
}

/** Metadata-only admission; it never reserves budget or starts an Agent/model call. */
export function parallelReadiness({enabled,preferences,route,prices,validUntil,budget,toolsAvailable,depth=0,now=Date.now(),modelInfo}){
  if(!enabled)return {status:'off',reason:'NEXT is off for this conversation.'}
  if(!preferences.automationEnabled||!preferences.automationParallelism)return {status:'off',reason:'Automatic read-only subagents are disabled in this model policy.'}
  if(depth>0)return {status:'blocked',reason:'NEXT read-only subagents do not delegate recursively.'}
  if(!toolsAvailable)return {status:'blocked',reason:'The native in-process subagent provider or read capability is unavailable.'}
  if(!route?.provider||!route?.model)return {status:'unknown',reason:'The selected model route is unknown.'}
  const matched=Array.isArray(prices)?prices.filter(price=>price.provider===route.provider&&price.model===route.model):[]
  const expiry=Date.parse(validUntil)
  if(matched.length!==1||!Number.isFinite(expiry)||expiry<=now)return {status:'blocked',reason:'One confirmed price and a future price expiry are required for this exact provider/model.'}
  if(['input','cacheRead','cacheWrite','output'].some(key=>matched[0][key]===''||!Number.isFinite(Number(matched[0][key]))||Number(matched[0][key])<0))return {status:'blocked',reason:'The configured model price is invalid.'}
  if(!budget)return {status:'unknown',reason:'The complete root conversation budget is unavailable.'}
  const reservations=Object.values(budget.reservations??{})
  if(reservations.some(value=>value.unknown||value.reason))return {status:'blocked',reason:'A previous automatic request has unknown consumption; its full reservation is retained.'}
  const available=Math.min(3,preferences.automationBudgetCny,budget.limitCny??3)-Number(budget.spentCny??0)-reservations.reduce((sum,value)=>sum+Number(value.amountCny??0),0)
  if(!Number.isFinite(available)||available<=0)return {status:'blocked',reason:'The root conversation automatic subagent budget is exhausted or reserved.'}
  if(!modelInfo)return {status:'unknown',reason:'The selected model context and output bounds have not been confirmed.'}
  const input=modelInfo.context?.contextWindow,output=Math.min(8192,modelInfo.defaultMaxTokens??8192)
  if(!Number.isSafeInteger(input)||input<=0||!Number.isSafeInteger(output)||output<=0)return {status:'blocked',reason:'The selected model context or output bound is unavailable.'}
  const maximum=input*Math.max(Number(matched[0].input),Number(matched[0].cacheRead),Number(matched[0].cacheWrite))/1e6+output*Number(matched[0].output)/1e6
  if(maximum>available)return {status:'blocked',reason:'The remaining budget cannot reserve the next request upper bound.'}
  return {status:'ready',reason:'Native read-only search and subagents are available within the root conversation budget.'}
}
