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

const DOM_INTRINSICS = new Set(`a abbr address area article aside audio b base bdi bdo big blockquote body br button canvas caption center cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu menuitem meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr
svg animate animateMotion animateTransform circle clipPath defs desc ellipse feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence filter foreignObject g image line linearGradient marker mask metadata mpath path pattern polygon polyline radialGradient rect set stop switch symbol text textPath tspan use view
math annotation annotation-xml maction menclose merror mfenced mfrac mglyph mi mlabeledtr mmultiscripts mn mo mover mpadded mphantom mroot mrow ms mspace msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover semantics`.split(/\s+/));

function importedComponent(element: NodePath<t.JSXElement>, module: string, component: string): boolean {
  const name = element.node.openingElement.name;
  const binding = t.isJSXIdentifier(name) ? element.scope.getBinding(name.name) :
    t.isJSXMemberExpression(name) && t.isJSXIdentifier(name.object) && t.isJSXIdentifier(name.property, { name: component }) ? element.scope.getBinding(name.object.name) : undefined;
  if (!binding?.path.parentPath?.isImportDeclaration() || binding.path.parentPath.node.source.value !== module) return false;
  return binding.path.isImportSpecifier() && (t.isIdentifier(binding.path.node.imported, { name: component }) || t.isStringLiteral(binding.path.node.imported, { value: component })) ||
    t.isJSXMemberExpression(name) && binding.path.isImportNamespaceSpecifier();
}

function insideThreeScene(element: NodePath<t.JSXOpeningElement>): boolean {
  for (let parent: NodePath | null = element.parentPath; parent; parent = parent.parentPath) {
    if (!parent.isJSXElement()) continue;
    if (importedComponent(parent, '@react-three/drei', 'Html')) return false;
    if (importedComponent(parent, '@react-three/fiber', 'Canvas')) return true;
  }
  return false;
}

/** Opaque build IDs contain no paths; the authorized bridge keeps the source index. */
export function injectSourceIds(code: string, filename: string, root: string, excludedIntrinsics: ReadonlySet<string> = new Set(), domOnly = false): string {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const projectPath = relative(root, filename).replaceAll('\\', '/');
  traverse(ast, { JSXOpeningElement(path) {
    const node = path.node;
    if (!t.isJSXIdentifier(node.name) || !/^[a-z]/.test(node.name.name) || excludedIntrinsics.has(node.name.name)) return;
    if (domOnly && (!DOM_INTRINSICS.has(node.name.name) || insideThreeScene(path))) return;
    if (node.attributes.some(attribute => t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: 'data-rdesign-id' }))) return;
    const digest = createHash('sha256').update(`${projectPath}:${node.start}:${node.name.name}`).digest('hex').slice(0, 16);
    node.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-rdesign-id'), t.stringLiteral(`source-${digest}`)));
  } });
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
