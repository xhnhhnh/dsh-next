import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

const requestSchema=z.object({sessionId:z.string().min(1).max(256).optional(),workspace:z.string().min(1).max(4096).optional()}).strict()
export const productionRemoteContribution={package:'@local/dsh-next',descriptors:['inspect','scan'].map(method=>({
  id:`@local/dsh-next#nextProduction/${method}`,service:'nextProduction',namespace:'nextProduction',method,invocation:{kind:'direct'},
  parameters:[{name:'request',wire:'request',source:'json',acceptsUndefined:true,codec:{mode:'src-json'}}],result:{mode:'src-json'},
}))}

/** Uses the Host Gateway and its resource/connection policies; no extra HTTP endpoint. */
export function installProductionRemote(ctx,{inspect,scan}){
  class ProductionService extends TypertRemoteService{
    constructor(owner){super(owner,'nextProduction',{namespace:'nextProduction'})}
    async inspect(request={}){return inspect(requestSchema.parse(request))}
    async scan(request={}){return scan(requestSchema.parse(request))}
  }
  const service=new ProductionService(ctx)
  ctx.effect(()=>ctx.typert.remote.register(productionRemoteContribution),'next.production.remote()')
  return service
}
