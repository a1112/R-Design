import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import type { NodePath } from '@babel/traverse';
import generatorModule from '@babel/generator';
import * as t from '@babel/types';
import type { Plugin } from 'vite';

const traverse = (traverseModule as unknown as { default?: typeof traverseModule }).default ?? traverseModule;
const generate = (generatorModule as unknown as { default?: typeof generatorModule }).default ?? generatorModule;

/** Opaque build IDs contain no paths; the authorized bridge keeps the source index. */
export function injectSourceIds(code: string, filename: string, root: string, excludedIntrinsics: ReadonlySet<string> = new Set(), domOnly = false): string {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const projectPath = relative(root, filename).replaceAll('\\', '/');
  let program: NodePath<t.Program>, helper: t.Identifier | undefined, clone: t.Identifier | undefined;
  traverse(ast, { Program(path) { program = path; }, JSXOpeningElement(path) {
    if (domOnly) return;
    const node = path.node;
    if (!t.isJSXIdentifier(node.name) || !/^[a-z]/.test(node.name.name) || excludedIntrinsics.has(node.name.name)) return;
    if (node.attributes.some(attribute => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'data-rdesign-id' }))) return;
    const digest = createHash('sha256').update(`${projectPath}:${node.start}:${node.name.name}`).digest('hex').slice(0, 16);
    node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-rdesign-id'), t.stringLiteral(`source-${digest}`)));
  }, JSXElement: { exit(path) {
    if (!domOnly) return;
    const element = path.node, node = element.openingElement;
    if (!t.isJSXIdentifier(node.name) || !/^[a-z]/.test(node.name.name)) return;
    if (node.attributes.some(attribute => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'data-rdesign-id' }))) return;
    const digest = createHash('sha256').update(`${projectPath}:${node.start}:${node.name.name}`).digest('hex').slice(0, 16);
    helper ??= program.scope.generateUidIdentifier('rdesignSourceElement');
    clone ??= program.scope.generateUidIdentifier('rdesignCloneElement');
    const wrapped = t.callExpression(helper, [element, t.stringLiteral(`source-${digest}`)]);
    // Keep the original JSX attributes/children for native compiler decoding and key evaluation.
    if (path.parentPath.isJSXElement() || path.parentPath.isJSXFragment() || path.parentPath.isJSXAttribute()) {
      path.replaceWith(t.jsxExpressionContainer(wrapped));
    } else {
      path.replaceWith(wrapped);
    }
    path.skip();
  } } });
  if (helper) {
    // The owning renderer supplies the actual instance: DOM IDs never enter Three props.
    const support = parse(`const ${helper.name}=(()=>{const withRef=new WeakMap(),withoutRef=new Map();return(element,id)=>{
      const original=element.ref;
      if(original!=null&&typeof original!=='function'&&typeof original!=='object')return element;
      let callbacks=withoutRef;if(original){callbacks=withRef.get(original);if(!callbacks){callbacks=new Map();withRef.set(original,callbacks);}}
      let callback=callbacks.get(id);if(!callback){callback=value=>{
        const view=value&&typeof value.setAttribute==='function'&&value.ownerDocument?.defaultView;
        if(view&&value instanceof view.Element)value.setAttribute('data-rdesign-id',id);
        if(typeof original==='function')return original(value);if(original)original.current=value;
      };callbacks.set(id,callback);}return ${clone!.name}(element,{ref:callback});};})();`, { sourceType: 'module' });
    ast.program.body.unshift(t.importDeclaration([t.importSpecifier(clone!, t.identifier('cloneElement'))], t.stringLiteral('react')), ...support.program.body);
  }
  return generate(ast, { retainLines: true }, code).code;
}

export function rdesignSourceIds(options: { root?: string; enabled?: boolean; excludedIntrinsics?: ReadonlySet<string>; domOnly?: boolean } = {}): Plugin {
  let root = options.root ?? process.cwd();
  let enabled = options.enabled;
  return {
    name: 'rdesign-source-ids', enforce: 'pre',
    configResolved(config) { root = options.root ?? config.root; enabled ??= config.command === 'serve'; },
    transform(code, id) {
      if (!enabled || !/\.[jt]sx(?:\?|$)/.test(id) || id.includes('/node_modules/')) return null;
      return { code: injectSourceIds(code, id.split('?')[0], root, options.excludedIntrinsics, options.domOnly), map: null };
    },
  };
}
