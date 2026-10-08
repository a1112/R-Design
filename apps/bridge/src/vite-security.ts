import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Vite's static/public middleware checks lexical paths. Validate canonical paths before it runs. */
export function fileBoundary(options:{root:string;allow:string[];privateRoots?:string[]}):Plugin {
  const canonical=(file:string)=>{try{return realpathSync(file);}catch{return path.resolve(file);}};
  const root=canonical(options.root);const allowed=options.allow.map(canonical);const privateRoots=(options.privateRoots??[]).map(canonical);
  function permitted(file:string) {
    const authorization=allowed.filter(directory=>file===directory||file.startsWith(directory+path.sep));if(!authorization.length)return false;
    if(privateRoots.some(directory=>file===directory||file.startsWith(directory+path.sep)))return false;
    if(/\.(pem|crt|key)$/i.test(file)||/^\.env(?:\.|$)/i.test(path.basename(file)))return false;
    // An explicitly authorized candidate may itself have .rdesign in an ancestor path.
    return authorization.some(directory=>!path.relative(directory,file).split(path.sep).some(part=>part==='.git'||part==='.rdesign'));
  }
  function check(file:string) {try{return permitted(realpathSync(file));}catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))return true;return false;}}
  return {name:'rdesign-canonical-file-boundary',enforce:'pre',
    configureServer(server){server.middlewares.use((request,response,next)=>{
      try {const pathname=decodeURIComponent(new URL(request.url??'/', 'http://rdesign.local').pathname);if(pathname.includes('\0'))throw new Error('Invalid path');
        if(pathname.startsWith('/@vite/')||pathname.startsWith('/@id/')||pathname==='/__vite_ping')return next();
        const file=pathname.startsWith('/@fs/')?path.resolve(pathname.slice(4)):path.resolve(root,'.'+pathname);
        if(!check(file)){response.statusCode=403;response.end('Resource is outside the authorized preview boundary');return;}
        const resolved=server.moduleGraph.urlToModuleMap.get(pathname)?.id;if(resolved&&path.isAbsolute(resolved.split('?')[0])&&!check(resolved.split('?')[0])){response.statusCode=403;response.end('Module is outside the authorized preview boundary');return;}
        next();
      }catch{response.statusCode=400;response.end('Invalid resource path');}
    });},
    load(id){const file=id.split('?')[0];if(!id.startsWith('\0')&&path.isAbsolute(file)&&!check(file))throw new Error('Module is outside the authorized preview boundary');return null;},
  };
}
