import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentStore, DomainError } from '../../packages/document-core/src/index';
const directories:string[]=[];afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function store() {const directory=await mkdtemp(path.join(os.tmpdir(),'rd-store-'));directories.push(directory);return new DocumentStore(directory).load('code-v1');}
describe('durable versioned writes',()=>{
  it('serializes two clients at the same revision and preserves duplicate results across restart',async()=>{const db=await store();const envelope={projectId:db.project.id,expectedRevision:1,operationId:'operation-alpha'};let executions=0;const result=await db.write(envelope,'same',()=>{executions++;db.project.name='accepted';return {ok:true};});expect(db.project.revision).toBe(2);expect(await db.write(envelope,'same',()=>{executions++;return {ok:false};})).toEqual(result);expect(executions).toBe(1);const reopened=await new DocumentStore(db.directory).load('code-v1');expect(await reopened.write(envelope,'same',()=>{throw new Error('must not execute');})).toEqual(result);await expect(reopened.write({...envelope,operationId:'operation-bravo'},'new',()=>{})).rejects.toMatchObject({code:'REVISION_CONFLICT'});await expect(reopened.write(envelope,'different',()=>{})).rejects.toMatchObject({code:'OPERATION_COLLISION'});});
  it('rejects one of simultaneous conflicting client operations',async()=>{const db=await store();const base={projectId:db.project.id,expectedRevision:1};const settled=await Promise.allSettled([db.write({...base,operationId:'operation-alpha'},'a',()=>1),db.write({...base,operationId:'operation-bravo'},'b',()=>2)]);expect(settled.filter(s=>s.status==='fulfilled')).toHaveLength(1);expect(db.project.revision).toBe(2);});
  it('rolls document mutation back when validation fails',async()=>{const db=await store();await expect(db.write({projectId:db.project.id,expectedRevision:1,operationId:'operation-alpha'},'a',()=>{db.project.name='lost';throw new DomainError('INVALID','invalid',400);})).rejects.toMatchObject({code:'INVALID'});expect(db.project.name).not.toBe('lost');expect(db.project.revision).toBe(1);});
});
it('keeps completed side effects fenced after receipt save failure and never repeats them on retry',async()=>{
  const db=await store();const originalSave=db.save.bind(db);let saves=0,delivered=0;db.save=async()=>{saves++;if(saves===2)throw Object.assign(new Error('disk full'),{code:'ENOSPC'});await originalSave();};const envelope={projectId:db.project.id,expectedRevision:1,operationId:'operation-alpha'};
  await expect(db.write(envelope,'same',()=>{delivered++;return {delivered:true};})).rejects.toMatchObject({code:'STORE_SAVE_FAILED'});expect(delivered).toBe(1);expect(db.project.revision).toBe(2);expect(db.health.writable).toBe(false);
  const interrupted=await new DocumentStore(db.directory).load('code-v1');await expect(interrupted.write(envelope,'same',()=>{delivered++;})).rejects.toMatchObject({code:'OPERATION_OUTCOME_UNKNOWN'});expect(delivered).toBe(1);
  expect(await db.write(envelope,'same',()=>{delivered++;return {delivered:false};})).toEqual({delivered:true});expect(delivered).toBe(1);expect(db.health.writable).toBe(true);
  const reopened=await new DocumentStore(db.directory).load('code-v1');expect(await reopened.write(envelope,'same',()=>{delivered++;return null;})).toEqual({delivered:true});expect(delivered).toBe(1);
});
it('refuses new mutations while completed receipts cannot be flushed',async()=>{
  const db=await store();const originalSave=db.save.bind(db);let saves=0,delivered=0;db.save=async()=>{saves++;if(saves>=2)throw new Error('unavailable');await originalSave();};const base={projectId:db.project.id,expectedRevision:1};await expect(db.write({...base,operationId:'operation-alpha'},'one',()=>{delivered++;})).rejects.toMatchObject({code:'STORE_SAVE_FAILED'});await expect(db.write({...base,expectedRevision:2,operationId:'operation-bravo'},'two',()=>{delivered++;})).rejects.toMatchObject({code:'STORE_SAVE_FAILED'});expect(delivered).toBe(1);
});
