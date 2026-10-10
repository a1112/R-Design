import { createReadStream, readFileSync, realpathSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

export const PDF5_RESOURCE_PREFIX = '/__rdesign_resources/pdfjs-v5/';
const folders = ['cmaps', 'standard_fonts', 'wasm'] as const;
const resourceName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** Vendor resources only: fixed installed PDF5 profile, never project paths or arbitrary PDFs. */
export function pdf5Resources(projectRoot: string, repoRoot: string): Plugin {
  const project = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  if (project.dependencies?.['pdfjs-dist-v5'] !== '5.7.284') return { name: 'rdesign-pdf5-resources-inactive' };
  const metadata = createRequire(path.join(repoRoot, 'package.json')).resolve('pdfjs-dist-v5/package.json');
  if (JSON.parse(readFileSync(metadata, 'utf8')).version !== '5.7.284') throw new Error('PDF5 resource profile version mismatch');
  const root = realpathSync(path.dirname(metadata));
  const directories = Object.fromEntries(folders.map(folder => [folder, realpathSync(path.join(root, folder))]));
  for (const directory of Object.values(directories)) if (!directory.startsWith(root + path.sep)) throw new Error('PDF5 resource directory escaped its installed profile');
  return {
    name: 'rdesign-pinned-pdf5-resources',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname: string;
        try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://rdesign.local').pathname); } catch { return next(); }
        if (!pathname.startsWith(PDF5_RESOURCE_PREFIX)) return next();
        const parts = pathname.slice(PDF5_RESOURCE_PREFIX.length).split('/');
        if (!['GET', 'HEAD'].includes(request.method ?? '') || parts.length !== 2 || !folders.includes(parts[0] as any) || !resourceName.test(parts[1])) {
          response.statusCode = 403; response.end('Invalid PDF5 resource'); return;
        }
        try {
          const directory = directories[parts[0]], file = realpathSync(path.join(directory, parts[1]));
          if (!file.startsWith(directory + path.sep)) { response.statusCode = 403; response.end('PDF5 resource escaped its profile'); return; }
          response.setHeader('Content-Type', /\.(?:js|mjs)$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          if (request.method === 'HEAD') { response.end(); return; }
          const stream = createReadStream(file); stream.on('error', () => { response.statusCode = 404; response.end('PDF5 resource unavailable'); }); stream.pipe(response);
        } catch { response.statusCode = 404; response.end('PDF5 resource unavailable'); }
      });
    },
    async generateBundle() {
      for (const folder of folders) for (const entry of await readdir(directories[folder], { withFileTypes: true })) {
        if (!entry.isFile() || !resourceName.test(entry.name)) continue;
        const file = realpathSync(path.join(directories[folder], entry.name));
        if (!file.startsWith(directories[folder] + path.sep)) throw new Error('PDF5 build resource escaped its profile');
        this.emitFile({ type: 'asset', fileName: PDF5_RESOURCE_PREFIX.slice(1) + folder + '/' + entry.name, source: await readFile(file) });
      }
    },
  };
}
