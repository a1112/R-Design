import { readFile, realpath, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@babel/parser';
import * as t from '@babel/types';
import type { SourceBinding } from '../../protocol/src/index.js';
import { digest, DomainError } from '../../document-core/src/index.js';
export const STYLE_PROPERTIES = ['fontSize','fontWeight','borderRadius','gap','padding','paddingTop','paddingBottom','paddingLeft','paddingRight','margin','background','backgroundColor','color','gridTemplateColumns','height','minHeight','width','maxWidth','letterSpacing','lineHeight','borderColor','borderWidth','display','alignItems','justifyContent'];
export interface SourceEntry { binding: SourceBinding; element: t.JSXElement; source: string; }
export interface Mutation { property: string; before: string | number | null; after: string | number | null }
export async function safePath(root: string, relative: string) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..') || relative.includes('\0')) throw new DomainError('PATH_FORBIDDEN','路径必须位于授权根目录',403);
  const absolute = path.resolve(root,relative); const actualRoot = await realpath(root);
  const actual = await realpath(absolute); if (actual !== actualRoot && !actual.startsWith(actualRoot+path.sep)) throw new DomainError('PATH_FORBIDDEN','符号链接越出授权目录',403);
  return actual;
}
export async function trackedFiles(root: string): Promise<string[]> {
  const result:string[]=[];
  async function visit(directory:string) { for (const name of await readdir(path.join(root,directory))) { if (name === 'node_modules' || name.startsWith('.')) continue; const rel=path.join(directory,name); const stat=await lstat(path.join(root,rel)); if (stat.isSymbolicLink()) continue; if (stat.isDirectory()) await visit(rel); else result.push(rel); } }
  await visit('src'); for(const directory of ['assets','public']) {try {const stat=await lstat(path.join(root,directory));if(stat.isDirectory()&&!stat.isSymbolicLink())await visit(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  for(const name of ['index.html','package.json','vite.config.ts','tsconfig.json']) { try { const stat=await lstat(path.join(root,name));if(stat.isFile()&&!stat.isSymbolicLink())result.push(name); } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;} } return result.map(file=>file.split(path.sep).join('/')).sort();
}
export async function sourceFiles(root:string) {return (await trackedFiles(root)).filter(file=>file.startsWith('src/')&&/\.[jt]sx?$/.test(file));}
function walk(node: unknown, visitor: (element:t.JSXElement)=>void) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) {node.forEach(n=>walk(n,visitor));return;} if ((node as any).type === 'JSXElement') visitor(node as t.JSXElement); for(const [key,value] of Object.entries(node)) if (!['loc','start','end','extra'].includes(key)) walk(value,visitor); }
function identity(element:t.JSXElement) { const attribute=element.openingElement.attributes.find(a=>t.isJSXAttribute(a)&&t.isJSXIdentifier(a.name,{name:'data-rdesign-id'})); return t.isJSXAttribute(attribute)&&t.isStringLiteral(attribute.value)?attribute.value.value:null; }
function style(element:t.JSXElement) { const attribute=element.openingElement.attributes.find(a=>t.isJSXAttribute(a)&&t.isJSXIdentifier(a.name,{name:'style'})); return t.isJSXAttribute(attribute)&&t.isJSXExpressionContainer(attribute.value)&&t.isObjectExpression(attribute.value.expression)?attribute.value.expression:null; }
function literal(node: t.Node | null | undefined):string|number|null { return t.isStringLiteral(node)||t.isNumericLiteral(node)?node.value:null; }
function content(element:t.JSXElement) { const children=element.children.filter(child=>!t.isJSXText(child)||child.value.trim()); if(children.length!==1) return null; const child=children[0]; if(t.isJSXText(child)) return {node:child,value:child.value.trim()}; if(t.isJSXExpressionContainer(child)&&t.isStringLiteral(child.expression)) return {node:child,value:child.expression.value}; return null; }
function objectProperty(object:t.ObjectExpression, property:string) { return object.properties.find(p=>t.isObjectProperty(p)&&!p.computed&&(t.isIdentifier(p.key,{name:property})||t.isStringLiteral(p.key,{value:property}))) as t.ObjectProperty|undefined; }
export async function indexSources(root:string) {
  const map=new Map<string,SourceEntry[]>();
  for(const file of await sourceFiles(root)) { const source=await readFile(await safePath(root,file),'utf8'); const ast=parse(source,{sourceType:'module',plugins:['jsx','typescript']}); walk(ast,element=>{ const explicit=identity(element);const tag=element.openingElement.name;const id=explicit??(t.isJSXIdentifier(tag)&&/^[a-z]/.test(tag.name)?'source-'+digest(`${file.replaceAll('\\','/')}:${element.openingElement.start}:${tag.name}`).slice(0,16):null);if(!id||!/^[-A-Za-z0-9_:]{1,128}$/.test(id))return;const object=style(element); const properties=object&&!object.properties.some(p=>t.isSpreadElement(p))?STYLE_PROPERTIES.filter(property=>{const p=objectProperty(object,property);return !p || literal(p.value)!==null;}):[];if(content(element))properties.unshift('text'); const entry={source,element,binding:{sourceNodeId:id,file,line:element.loc?.start.line??1,column:element.loc?.start.column??0,fileHash:digest(source),reliability:'exact' as const,scope:'instance' as const,editableProperties:properties}};map.set(id,[...(map.get(id)??[]),entry]); }); }
  for(const entries of map.values())if(entries.length!==1)for(const entry of entries)entry.binding.reliability='ambiguous'; return map;
}
export async function codeHash(root:string) { const files=await trackedFiles(root); return digest((await Promise.all(files.map(async f=>`${f}:${digest(await readFile(await safePath(root,f)))}`))).join('\n')); }
function validateValue(property:string,value:string|number|null) { if(value===null)return;if(property==='text') {if(typeof value!=='string'||value.length>1000)throw new DomainError('INVALID_PROPERTY','文字必须是最多 1000 个字符的字符串',400);return;}if(!STYLE_PROPERTIES.includes(property))throw new DomainError('PROPERTY_FORBIDDEN',`不允许修改 ${property}`,400);if(typeof value==='number') {if(!Number.isFinite(value)||Math.abs(value)>5000)throw new DomainError('INVALID_PROPERTY','无效数值',400);} else if(value.length>200||/[;{}<>]/.test(value)||/url\s*\(|expression|javascript:/i.test(value))throw new DomainError('INVALID_PROPERTY','样式值超出安全属性范围',400); }
export function transform(entry:SourceEntry, requested:Record<string,string|number|null>, expected?:Record<string,string|number|null>) {
  const edits:Array<{start:number;end:number;value:string}>=[];const mutations:Mutation[]=[]; const object=style(entry.element);let additions='';
  for(const [property,value] of Object.entries(requested)) { validateValue(property,value);if(!entry.binding.editableProperties.includes(property))throw new DomainError('PROPERTY_READ_ONLY',`${property} 是动态或未映射属性`,400);
    let before:string|number|null=null;
    if(property==='text') {const current=content(entry.element);if(!current)throw new DomainError('TEXT_DYNAMIC','动态文本不可直接改写',400);before=current.value;if(expected&&expected[property]!==before)throw new DomainError('REVERT_CONFLICT','目标文字已被后续修改');if(value===null)throw new DomainError('INVALID_PROPERTY','不能删除文字',400);edits.push({start:current.node.start!,end:current.node.end!,value:`{${JSON.stringify(value)}}`});}
    else {if(!object)throw new DomainError('STYLE_DYNAMIC','样式不是可编辑内联对象',400);const p=objectProperty(object,property);before=p?literal(p.value):null;if(p&&before===null)throw new DomainError('STYLE_DYNAMIC','样式由动态表达式控制',400);if(expected&&expected[property]!==before)throw new DomainError('REVERT_CONFLICT',`${property} 已被后续修改`);if(value===null&&p) {const start=p.start!,end=p.end!;let removalEnd=end;while(/\s/.test(entry.source[removalEnd]??''))removalEnd++;if(entry.source[removalEnd]===',')removalEnd++;else{let prev=start-1;while(prev>=0&&/\s/.test(entry.source[prev]))prev--;if(entry.source[prev]===','){edits.push({start:prev,end,value:''});mutations.push({property,before,after:value});continue;}}edits.push({start,end:removalEnd,value:''});}else if(p)edits.push({start:p.value.start!,end:p.value.end!,value:JSON.stringify(value)});else if(value!==null)additions+=`${JSON.stringify(property)}: ${JSON.stringify(value)}, `;}
    mutations.push({property,before,after:value});
  }
  if(additions)edits.push({start:object!.start!+1,end:object!.start!+1,value:additions});let after=entry.source;for(const edit of edits.sort((a,b)=>b.start-a.start))after=after.slice(0,edit.start)+edit.value+after.slice(edit.end);parse(after,{sourceType:'module',plugins:['jsx','typescript']});return {after,mutations};
}
