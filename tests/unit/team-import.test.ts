import { describe, expect, it } from 'vitest';
import { parseEngineeringEvidence } from '../../apps/workbench-web/src/team/import';

const image='data:image/png;base64,iVBORw0KGgo=';
const frame=(id:string)=>({id,kind:'snapshot',status:'frozen',image,width:1200,height:800,timestamp:'2026-10-14T00:00:00Z',codeRevision:'source-hash',nodes:[{runtimeNodeId:'runtime-button',sourceNodeId:'button',text:'开始',tag:'button',bounds:{x:20,y:30,w:100,h:40}}]});
describe('team engineering evidence import',()=>{
  it('extracts frozen snapshots and candidate evidence from a portable project without executable source',()=>{
    const designs=parseEngineeringEvidence({schemaVersion:1,manifest:{name:'产品设计'},sourceFiles:[{path:'src/main.tsx',content:'SECRET executable source'}],document:{schemaVersion:1,project:{name:'产品设计',snapshots:[frame('baseline')]},changes:[{id:'change-one',intent:'调整按钮',createdAt:'2026-10-14',candidateFrame:{...frame('candidate'),kind:'candidate'},patches:[{file:'src/main.tsx',before:'old',after:'new'}],evidence:[{name:'实际构建',passed:true,detail:'构建通过'}]}]}});
    expect(designs).toHaveLength(2);
    expect(designs[0].layers[0]).toEqual({id:'runtime-button',name:'开始',bounds:{x:20,y:30,w:100,h:40}});
    expect(designs[1].title).toBe('调整按钮');
    expect(designs[1].diff).toContain('src/main.tsx');
    expect(designs[1].evidence[0].passed).toBe(true);
    expect(JSON.stringify(designs)).not.toContain('SECRET executable source');
  });
  it('supports a document export and keeps all snapshots available for selection',()=>{
    const designs=parseEngineeringEvidence({schemaVersion:1,project:{name:'首页',snapshots:[frame('one'),frame('two')]},changes:[]});
    expect(designs.map(d=>d.id)).toEqual(['one','two']);
  });
  it('rejects unsupported schemas, live frames and documents with no screenshot',()=>{
    expect(()=>parseEngineeringEvidence({schemaVersion:3})).toThrow(/格式/);
    expect(()=>parseEngineeringEvidence({schemaVersion:1,project:{snapshots:[]},changes:[]})).toThrow(/截图/);
    expect(()=>parseEngineeringEvidence({schemaVersion:1,project:{snapshots:[{...frame('live'),kind:'live',status:'live'}]},changes:[]})).toThrow(/截图/);
  });
  it('drops invalid layer geometry and refuses active image content',()=>{
    const designs=parseEngineeringEvidence({schemaVersion:1,project:{snapshots:[{...frame('one'),nodes:[{runtimeNodeId:'bad',bounds:{x:0,y:0,w:-1,h:10}},{runtimeNodeId:'ok',tag:'div',bounds:{x:0,y:0,w:10,h:10}}]}]},changes:[]});
    expect(designs[0].layers.map(l=>l.id)).toEqual(['ok']);
    expect(()=>parseEngineeringEvidence({schemaVersion:1,project:{snapshots:[{...frame('svg'),image:'data:image/svg+xml;base64,abcd'}]},changes:[]})).toThrow(/截图/);
  });
});
