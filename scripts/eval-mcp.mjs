// Local, deterministic read-only MCP fixture. It has no external credentials or network.
import { createInterface } from 'node:readline'
let failures=0
for await (const line of createInterface({input:process.stdin})) {
  let message
  try { message=JSON.parse(line) } catch { continue }
  if(message.id===undefined) continue
  let result
  if(message.method==='initialize') result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'next-evaluation-fixture',version:'1.0.0'}}
  else if(message.method==='ping') result={}
  else if(message.method==='tools/list') result={tools:[
    {name:'sum',description:'Add two fixture numbers.',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b']},annotations:{readOnlyHint:true}},
    {name:'flaky',description:'Read a deterministic fixture; first read fails, next returns RECOVERED-73.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true}},
    {name:'reset',description:'Private evaluation-driver fixture reset. Never model callable.',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:false}},
  ]}
  else if(message.method==='tools/call') {
    if(message.params.name==='sum') result={content:[{type:'text',text:String(message.params.arguments.a+message.params.arguments.b)}]}
    else if(message.params.name==='reset') { failures=0;result={content:[{type:'text',text:'Fixture reset.'}]} }
    else if(message.params.name==='flaky') result=++failures%2===1?{isError:true,content:[{type:'text',text:'Fixture temporarily unavailable. A read-only retry is safe.'}]}:{content:[{type:'text',text:'RECOVERED-73'}]}
    else result={isError:true,content:[{type:'text',text:'Unknown fixture tool.'}]}
  } else { process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}})+'\n');continue }
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n')
}
