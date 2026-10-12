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

function elementProps(attributes: t.JSXOpeningElement['attributes']): t.ObjectExpression {
  return t.objectExpression(attributes.map(attribute => {
    if (t.isJSXSpreadAttribute(attribute)) return t.spreadElement(attribute.argument);
    const name = t.isJSXIdentifier(attribute.name) ? attribute.name.name : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
    const value = !attribute.value ? t.booleanLiteral(true) : t.isJSXExpressionContainer(attribute.value) ? attribute.value.expression : attribute.value;
    if (t.isJSXEmptyExpression(value)) throw new Error('JSX attribute requires an expression');
    return t.objectProperty(t.stringLiteral(name), t.isStringLiteral(value) ? t.stringLiteral(value.value.replace(/\n\s+/g, ' ')) : value, name === '__proto__');
  }));
}

/** Opaque build IDs contain no paths; the authorized bridge keeps the source index. */
export function injectSourceIds(code: string, filename: string, root: string, excludedIntrinsics: ReadonlySet<string> = new Set(), domOnly = false): string {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const projectPath = relative(root, filename).replaceAll('\\', '/');
  let program: NodePath<t.Program>, helper: t.Identifier | undefined;
  traverse(ast, { Program(path) { program = path; }, JSXOpeningElement(path) {
    const node = path.node;
    if (!t.isJSXIdentifier(node.name) || !/^[a-z]/.test(node.name.name) || !domOnly && excludedIntrinsics.has(node.name.name)) return;
    if (node.attributes.some(attribute => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'data-rdesign-id' }))) return;
    const digest = createHash('sha256').update(`${projectPath}:${node.start}:${node.name.name}`).digest('hex').slice(0, 16);
    if (!domOnly) node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-rdesign-id'), t.stringLiteral(`source-${digest}`)));
    else {
      helper ??= program.scope.generateUidIdentifier('rdesignSourceProps');
      node.attributes = [t.jsxSpreadAttribute(t.callExpression(helper, [elementProps(node.attributes), t.stringLiteral(`source-${digest}`)]))];
    }
  } });
  if (helper) {
    // The owning renderer supplies the actual instance: DOM IDs never enter Three props.
    const support = parse(`const ${helper.name}=(()=>{const withRef=new WeakMap(),withoutRef=new Map();return(props,id)=>{
      const original=props.ref;
      if(original!=null&&typeof original!=='function'&&typeof original!=='object')return props;
      let callbacks=withoutRef;if(original){callbacks=withRef.get(original);if(!callbacks){callbacks=new Map();withRef.set(original,callbacks);}}
      let callback=callbacks.get(id);if(!callback){callback=value=>{
        const view=value&&typeof value.setAttribute==='function'&&value.ownerDocument?.defaultView;
        if(view&&value instanceof view.Element)value.setAttribute('data-rdesign-id',id);
        if(typeof original==='function')return original(value);if(original)original.current=value;
      };callbacks.set(id,callback);}return{...props,ref:callback};};})();`, { sourceType: 'module' });
    ast.program.body.unshift(...support.program.body);
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
