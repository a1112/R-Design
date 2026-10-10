import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {ProviderError} from '../../../packages/asset-provider/src/index.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID=/^project_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const CHANGE_ID=/^change_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const within=(root:string,target:string)=>{const relative=path.relative(root,target);return !!relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
async function ownedRoot(directory:string){await mkdir(directory,{recursive:true});const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ProviderError('CANDIDATE_PATH','Configured worker roots must be directories, not symlinks.');return realpath(directory);}
async function regularJSON(file:string,maxBytes:number){
  try{
    if(await realpath(file)!==file)throw new ProviderError('PROJECT_REGISTRATION','Project registration must have a canonical path without symlinks.');
    const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const stat=await handle.stat();if(!stat.isFile()||stat.size>maxBytes)throw new ProviderError('PROJECT_REGISTRATION','Project registration must be a bounded regular file.');return JSON.parse(await handle.readFile('utf8')) as Record<string,unknown>;}finally{await handle.close();}
  }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('PROJECT_REGISTRATION','Project registration is missing or invalid.');}
}
interface ProjectRegistration {id:string;schemaVersion?:number;kind?:string;archived?:boolean;source?:{kind?:string;directory?:string}}
export async function createCandidateScope(legacyRoot:string,projectsRoot:string){
  const legacyPath=path.resolve(legacyRoot),projectsPath=path.resolve(projectsRoot);
  const legacy=await ownedRoot(legacyPath),projects=await ownedRoot(projectsPath);
  if(legacy===projects||within(legacy,projects)||within(projects,legacy))throw new ProviderError('CANDIDATE_ROOT_OVERLAP','Legacy candidates and registered projects need separate roots.');
  const relativeParts=(rootPath:string,canonical:string,candidate:string)=>{const boundary=within(rootPath,candidate)?rootPath:within(canonical,candidate)?canonical:null;return boundary?{boundary,parts:path.relative(boundary,candidate).split(path.sep)}:null;};
  const directoriesWithoutLinks=async(boundary:string,parts:string[])=>{let current=boundary;for(const part of parts){current=path.join(current,part);const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())throw new ProviderError('SYMLINK_FORBIDDEN','Worker candidate ancestors must be ordinary directories.');}};
  return async(projectId:string,candidateDirectory:string)=>{
    if(!path.isAbsolute(candidateDirectory)||path.resolve(candidateDirectory)!==candidateDirectory)throw new ProviderError('CANDIDATE_PATH','Candidate paths must be normalized absolute directories.');
    const legacyParts=relativeParts(legacyPath,legacy,candidateDirectory);
    if(legacyParts){
      const document=await regularJSON(path.join(path.dirname(legacy),'project.json'),32*1024*1024);
      const identity=document.project as {id?:unknown}|undefined;
      if(document.schemaVersion!==1||!identity||typeof identity!=='object'||Array.isArray(identity)||typeof identity.id!=='string'||!PROJECT_ID.test(identity.id))throw new ProviderError('PROJECT_REGISTRATION','Legacy candidate root needs a valid project document identity.');
      if(identity.id!==projectId)throw new ProviderError('PROJECT_SCOPE','Requested project does not own this legacy candidate root.');
      await directoriesWithoutLinks(legacyParts.boundary,legacyParts.parts);
      const candidate=await realpath(candidateDirectory);
      if(!within(legacy,candidate))throw new ProviderError('CANDIDATE_PATH','Candidate escaped its legacy root.');
      return candidate;
    }
    const ownedParts=relativeParts(projectsPath,projects,candidateDirectory);
    const match=PROJECT_ID.exec(projectId);
    if(!ownedParts||!match||ownedParts.parts.length!==4||!UUID.test(ownedParts.parts[0])||ownedParts.parts[0]!==match[1]||ownedParts.parts[1]!=='.rdesign'||ownedParts.parts[2]!=='candidates'||!CHANGE_ID.test(ownedParts.parts[3]))throw new ProviderError('CANDIDATE_PATH','Owned candidates must match the requested project and exact .rdesign/candidates/change UUID layout.');
    await directoriesWithoutLinks(ownedParts.boundary,ownedParts.parts);
    const projectDirectory=await realpath(path.join(ownedParts.boundary,ownedParts.parts[0]));
    const manifest=await regularJSON(path.join(projectDirectory,'rdesign.project.json'),4*1024*1024) as unknown as ProjectRegistration;
    const catalog=await regularJSON(path.join(path.dirname(projects),'workspace.json'),16*1024*1024);
    const registered=Array.isArray(catalog.projects)?(catalog.projects as ProjectRegistration[]).find(entry=>entry.id===projectId):undefined;
    const valid=(entry:ProjectRegistration|undefined)=>entry?.id===projectId&&entry.schemaVersion===1&&entry.kind==='owned'&&entry.source?.kind==='owned'&&entry.source.directory==='source'&&entry.archived!==true;
    if(catalog.schemaVersion!==1||!valid(manifest)||!valid(registered))throw new ProviderError('PROJECT_REGISTRATION','The candidate project is not a registered active owned project.');
    const candidate=await realpath(candidateDirectory),project=await realpath(projectDirectory);
    if(!within(projects,candidate)||!within(projects,project)||candidate!==path.join(project,'.rdesign','candidates',ownedParts.parts[3]))throw new ProviderError('CANDIDATE_PATH','Candidate canonical path is outside its registered project.');
    return candidate;
  };
}
