import {expect,it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createRDesignMcpServer,createBridgeClient} from '../src/server.js';
it('renders scoped project routes, lists without opening, and explicitly opens using the catalog envelope',async()=>{
  const active={project:{id:'project-a',revision:3},capabilities:{capture:true}};
  const catalog={revision:8,activeProjectId:'project-a',projects:[{id:'project-a',name:'A'},{id:'project-b',name:'B'}],canManage:true};
  const calls:Array<{path:string;method:string;body?:unknown}>=[];
  const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(String(input));calls.push({path:url.pathname,method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):undefined});if(url.pathname==='/api/projects/project-b/open')return new Response(JSON.stringify({...active,project:{id:'project-b',revision:1}}));return new Response(JSON.stringify(url.pathname==='/api/projects'?catalog:active));};
  const server=createRDesignMcpServer(createBridgeClient({url:'http://127.0.0.1:4310',token:'configured-token',fetch:fetcher})),client=new Client({name:'project-test',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(st),client.connect(ct)]);
  try{const rendered=await client.callTool({name:'rd_render_workspace',arguments:{selectedNodeId:'node-1',reviewMode:true}});const url=new URL((rendered.structuredContent as {url:string}).url);expect(url.pathname).toBe('/project/project-a');expect(url.searchParams.get('selected')).toBe('node-1');expect(url.searchParams.get('review')).toBe('1');expect(url.searchParams.has('token')).toBe(false);const list=await client.callTool({name:'rd_list_projects',arguments:{}});expect(list.structuredContent).toMatchObject({revision:8,activeProjectId:'project-a'});expect(calls.every(call=>call.method==='GET')).toBe(true);await client.callTool({name:'rd_open_project',arguments:{projectId:'project-b',expectedRevision:8,operationId:'open-b'}});expect(calls.at(-1)).toEqual({path:'/api/projects/project-b/open',method:'POST',body:{expectedRevision:8,operationId:'open-b'}});}finally{await client.close();await server.close();}
});
it('preserves project-scope 403 instead of retrying with local bootstrap authorization',async()=>{
  const calls:string[]=[];const fetcher=async(input:RequestInfo|URL)=>{calls.push(String(input));return new Response(JSON.stringify({error:{code:'PROJECT_SCOPE',message:'This device is paired to another project.',retryable:false}}),{status:403});};
  const server=createRDesignMcpServer(createBridgeClient({url:'http://127.0.0.1:4310',token:'paired-device-token',fetch:fetcher})),client=new Client({name:'scope-test',version:'1'});const [ct,st]=InMemoryTransport.createLinkedPair();await Promise.all([server.connect(st),client.connect(ct)]);
  try{const rendered=await client.callTool({name:'rd_render_workspace',arguments:{}});expect(rendered.isError).toBe(true);expect(rendered.structuredContent).toMatchObject({error:{code:'PROJECT_SCOPE',retryable:false}});expect(calls).toHaveLength(1);expect(calls[0]).not.toContain('bootstrap');}finally{await client.close();await server.close();}
});
