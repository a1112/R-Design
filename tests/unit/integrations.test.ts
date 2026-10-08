import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBridgeClient, createRDesignMcpServer } from '../../packages/mcp-server/src/server.js';
import { createAssetProvider } from '../../packages/asset-provider/src/index.js';
import { createAgentProvider, type AgentStartRequest } from '../../packages/agent-provider/src/index.js';
const dirs: string[]=[];
const directory=async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'rdesign-provider-'));dirs.push(dir);return dir;};
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})));});
const generation={projectId:'p1',expectedRevision:1,operationId:'asset-op',prompt:'A quiet abstract blue background',budgetUsd:0.1,externalGenerationApproved:true as const};
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const asset={id:'a1',name:'Test asset',kind:'generated' as const,mime:'image/png',hash:'h1',url:'data:image/png;base64,'+png.toString('base64'),createdAt:new Date().toISOString(),provenance:{provider:'openai'}};
const assetEnv={OPENAI_API_KEY:'test-secret',RDESIGN_IMAGE_MODEL:'configured-test-model',RDESIGN_IMAGE_COST_CEILING_USD:'0.05'};
describe('explicit external provider boundaries',()=>{
  it('reports unavailable without credentials and rejects a budget before a provider call',async()=>{
    const fetcher=vi.fn();const dir=await directory();
    const unavailable=createAssetProvider({directory:dir,storeAsset:async()=>asset,env:{},fetch:fetcher});
    await expect(unavailable.generate(generation)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    const configured=createAssetProvider({directory:dir,storeAsset:async()=>asset,env:assetEnv,fetch:fetcher});
    await expect(configured.generate({...generation,budgetUsd:0.01})).rejects.toMatchObject({code:'BUDGET_EXCEEDED'});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('persists successful asset identity across restart and rejects changed operation replay',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{status:200}));
    const storeAsset=vi.fn(async()=>asset);const dir=await directory();
    const create=()=>createAssetProvider({directory:dir,storeAsset,env:assetEnv,fetch:fetcher});
    expect(await create().generate(generation)).toEqual(asset);
    expect(await create().generate({...generation,expectedRevision:2})).toEqual(asset);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(storeAsset).toHaveBeenCalledTimes(1);
    await expect(create().generate({...generation,prompt:'different prompt'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    const sent=JSON.parse((fetcher.mock.calls[0] as unknown as [unknown,RequestInit])[1].body as string);
    expect(sent.n).toBe(1);expect(sent.quality).toBe('low');
  });
  it('does not automatically replay interrupted image calls',async()=>{
    const fetcher=vi.fn(async()=>{throw new Error('connection closed');});const dir=await directory();
    const create=()=>createAssetProvider({directory:dir,storeAsset:async()=>asset,env:assetEnv,fetch:fetcher});
    await expect(create().generate(generation)).rejects.toMatchObject({code:'GENERATION_OUTCOME_UNKNOWN'});
    await expect(create().generate(generation)).rejects.toMatchObject({code:'GENERATION_REQUIRES_RECONCILIATION'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicate executors and fences cancellation with a lease generation',async()=>{
    const fetcher=vi.fn(async(input:URL|RequestInfo)=>new Response(JSON.stringify(String(input).endsWith('/cancel')?{status:'cancelled'}:{id:'worker1',status:'running'}),{status:200}));
    const provider=createAgentProvider({directory:await directory(),env:{RDESIGN_AGENT_WORKER_URL:'https://worker.example',RDESIGN_AGENT_WORKER_TOKEN:'worker-secret'},fetch:fetcher});
    const input:AgentStartRequest={projectId:'p1',expectedRevision:1,operationId:'run-op',owner:'desktop',executionMode:'external-worker',context:{confirmedIntent:{summary:'Increase button radius',constraints:['Only button'],confirmedAt:new Date().toISOString()},codeRevision:'base1',allowedFiles:['src/App.tsx'],scenarios:['overview']},budget:{maxUsd:1,maxIterations:2},candidateDirectory:'/controlled/candidate'};
    const run=await provider.start(input);expect(run.status).toBe('running');
    expect((await provider.start({...input,expectedRevision:2})).id).toBe(run.id);expect((await provider.list())[0]).toMatchObject({id:run.id,status:'running'});expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(provider.start({...input,operationId:'another-op'})).rejects.toMatchObject({code:'EXECUTOR_CONFLICT'});
    await expect(provider.start({...input,context:{...input.context,allowedFiles:['../secret']}})).rejects.toMatchObject({code:'INVALID_FILE_SCOPE'});
    const cancelled=await provider.cancel(run.id);expect(cancelled.status).toBe('cancelled');expect(cancelled.lease.generation).toBe(2);
  });
});
describe('MCP stdio contract over in-memory transports',()=>{
  it('launches the actual stdio server process and lists its tools',async()=>{
    const client=new Client({name:'stdio-probe',version:'1.0'});
    const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('node_modules/tsx/dist/cli.mjs'),path.resolve('packages/mcp-server/src/index.ts')],stderr:'pipe'});
    try {await client.connect(transport);expect((await client.listTools()).tools.map(t=>t.name)).toContain('rd_apply_change');}finally{await client.close();}
  });
  it('lists all eleven tools, keeps tokens out of results, and returns structured stale-target errors',async()=>{
    const snapshot={project:{id:'p1',name:'Test',revision:1,codeRevision:'base1',annotations:[],scenarios:[],assets:[],snapshots:[],designFrames:[]},frame:{id:'f1',runtimeSessionId:'s1',epoch:1,surfaceId:'surface1',codeRevision:'base1',treeRevision:1,viewportRevision:1,geometryRevision:1,width:1024,height:768,status:'live',nodes:[{runtimeNodeId:'n1',instanceKey:'i1',tag:'button',role:'button',text:'Start',bounds:{x:0,y:0,w:100,h:20},styles:{}}]},changes:[],capabilities:{capture:true,source:false},providerStatus:{agent:'unavailable',assets:'unavailable'},devices:[]};
    const fetcher=vi.fn(async(input:URL|RequestInfo,init?:RequestInit)=>{expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-root-token');return new Response(JSON.stringify(snapshot),{status:200});});
    const bridge=createBridgeClient({url:'http://127.0.0.1:4310',token:'test-root-token',fetch:fetcher});
    const server=createRDesignMcpServer(bridge),client=new Client({name:'test-client',version:'1.0'});const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport),client.connect(clientTransport)]);
    try {
      const tools=await client.listTools();expect(tools.tools).toHaveLength(11);
      const context=await client.callTool({name:'rd_get_context',arguments:{nodeId:'n1'}});expect(JSON.stringify(context)).not.toContain('test-root-token');
      const stale=await client.callTool({name:'rd_inspect_element',arguments:{nodeId:'n1',version:{...snapshot.frame,treeRevision:2}}});
      expect(stale.isError).toBe(true);expect(stale.structuredContent).toMatchObject({error:{code:'STALE_TARGET',retryable:false}});
      const rendered=await client.callTool({name:'rd_render_workspace',arguments:{reviewMode:true}});expect(rendered.structuredContent).toMatchObject({hostCapabilities:{embeddedUI:'unverified'}});expect(JSON.stringify(rendered)).not.toContain('test-root-token');
    } finally { await client.close();await server.close(); }
  });
});
