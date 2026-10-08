import express, {type NextFunction,type Request,type Response} from 'express';
import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {ProviderError} from '../../../packages/asset-provider/src/index.js';
import {createWorkerService} from './service.js';
const lease=z.object({generation:z.number().int().positive(),expiresAt:z.string().datetime()});
const start=z.object({runId:z.string().uuid(),projectId:z.string().min(1),expectedRevision:z.number().int().nonnegative(),operationId:z.string().min(1),executionMode:z.literal('external-worker'),owner:z.string().min(1),candidateDirectory:z.string().min(1),lease,context:z.object({confirmedIntent:z.object({summary:z.string().min(1).max(12000),constraints:z.array(z.string().max(2000)).max(40),confirmedAt:z.string().datetime()}),codeRevision:z.string().min(1),allowedFiles:z.array(z.string()).min(1).max(30),scenarios:z.array(z.string()).max(100),selection:z.unknown().optional()}),budget:z.object({maxUsd:z.number().positive(),maxIterations:z.number().int().min(1).max(3)})});
export function createWorkerApp(service:Awaited<ReturnType<typeof createWorkerService>>,token:string,port:number) {
  if(token.length<32)throw new ProviderError('WORKER_TOKEN_REQUIRED','Worker token must have at least 32 characters.');
  const tokenHash=createHash('sha256').update(token).digest();
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'64kb'}));
  app.use((request,response,next)=>{try{
    const host=request.headers.host,expectedPort=port||request.socket.localPort;if(!host||![`127.0.0.1:${expectedPort}`,`localhost:${expectedPort}`,`[::1]:${expectedPort}`].includes(host)||request.headers.origin)throw new ProviderError('WORKER_ORIGIN_FORBIDDEN','Worker accepts authenticated loopback service calls only.');
    const supplied=request.headers.authorization?.startsWith('Bearer ')?request.headers.authorization.slice(7):'';
    if(supplied.length>128||!timingSafeEqual(createHash('sha256').update(supplied).digest(),tokenHash))throw new ProviderError('AUTH_REQUIRED','Worker authorization is required.');
    response.setHeader('Cache-Control','no-store');next();
  }catch(error){next(error);}});
  const route=(fn:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{void fn(req,res).catch(next);};
  app.get('/health',(_req,res)=>res.json({ready:true,provider:'codex-sdk',billing:'explicit-api-key',budgetPolicy:'estimated-preflight-ceiling',permissions:'candidate-only profile'}));
  app.post('/runs',route(async(req,res)=>res.json(await service.start(start.parse(req.body)))));
  app.get('/runs/:id',route(async(req,res)=>res.json(service.get(String(req.params.id)))));
  app.post('/runs/:id/heartbeat',route(async(req,res)=>res.json(await service.heartbeat(String(req.params.id),z.object({lease}).parse(req.body).lease))));
  app.post('/runs/:id/cancel',route(async(req,res)=>res.json(await service.cancel(String(req.params.id),z.object({generation:z.number().int().positive()}).parse(req.body).generation))));
  app.use((error:unknown,_request:Request,response:Response,_next:NextFunction)=>{const value=error as ProviderError;const invalid=error instanceof z.ZodError;const code=invalid?'INVALID_INPUT':value.code??'WORKER_ERROR';const status=code==='AUTH_REQUIRED'?401:code.includes('ORIGIN')?403:code==='RUN_NOT_FOUND'?404:code.includes('CONFLICT')?409:400;response.status(status).json({error:{code,message:invalid?'Worker request schema is invalid.':value.message??'Worker request failed.',retryable:false}});});
  return app;
}
