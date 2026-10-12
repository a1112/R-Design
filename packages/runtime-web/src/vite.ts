import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generatorModule from '@babel/generator';
import * as t from '@babel/types';
import type { Plugin } from 'vite';

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule;
const generate = (generatorModule as unknown as { default?: typeof generatorModule }).default ?? generatorModule;

/** Opaque build IDs contain no paths; the authorized bridge keeps the source index. */
export function injectSourceIds(code: string, filename: string, root: string, excludedIntrinsics: ReadonlySet<string> = new Set()): string {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const projectPath = relative(root, filename).replaceAll('\\', '/');
  traverse(ast, { JSXOpeningElement(path) {
    const node = path.node;
    if (!t.isJSXIdentifier(node.name) || !/^[a-z]/.test(node.name.name) || excludedIntrinsics.has(node.name.name)) return;
    if (node.attributes.some(attribute => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'data-rdesign-id' }))) return;
    const digest = createHash('sha256').update(`${projectPath}:${node.start}:${node.name.name}`).digest('hex').slice(0, 16);
    node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-rdesign-id'), t.stringLiteral(`source-${digest}`)));
  } });
  return generate(ast, { retainLines: true }, code).code;
}

export function rdesignSourceIds(options: { root?: string; enabled?: boolean; excludedIntrinsics?: ReadonlySet<string> } = {}): Plugin {
  let root = options.root ?? process.cwd();
  let enabled = options.enabled;
  return {
    name: 'rdesign-source-ids', enforce: 'pre',
    configResolved(config) { root = options.root ?? config.root; enabled ??= config.command === 'serve'; },
    transform(code, id) {
      if (!enabled || !/\.[jt]sx(?:\?|$)/.test(id) || id.includes('/node_modules/')) return null;
      return { code: injectSourceIds(code, id.split('?')[0], root, options.excludedIntrinsics), map: null };
    },
  };
}
