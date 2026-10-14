import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import * as t from '@babel/types';
import { DomainError, digest } from '../../document-core/src/index.js';
import { assertNoPrivateSourceContent } from './index.js';

const traverse = (traverseModule as any).default ?? traverseModule;
const fail = () => { throw new DomainError('ENGINEERING_STYLE', '样式模块不符合限定的颜色计算与 CSS 变量契约', 400); };
const exports = ['applyThemeToDOM', 'buildThemeTokens', 'clamp', 'isHexColor'];
const types = ['AppearanceSettings', 'ResolvedTheme', 'ThemePresetId', 'ThemeTokens'];
const forbiddenName = /^(?:window|globalThis|global|process|require|eval|Function|fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|navigator|location|document|Math|Number|constructor|prototype|__proto__)$/;
const privateName = /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential)/i;
const syntax = new Set(['File', 'Program', 'ImportDeclaration', 'ImportSpecifier', 'ExportNamedDeclaration', 'VariableDeclaration', 'VariableDeclarator', 'ArrowFunctionExpression', 'BlockStatement', 'ReturnStatement', 'IfStatement', 'ExpressionStatement', 'Identifier', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'RegExpLiteral', 'BinaryExpression', 'LogicalExpression', 'UnaryExpression', 'ConditionalExpression', 'CallExpression', 'MemberExpression', 'ObjectExpression', 'ObjectProperty', 'ArrayExpression', 'ArrayPattern', 'ObjectPattern', 'TemplateLiteral', 'TemplateElement', 'TSTypeAnnotation', 'TSTypeReference', 'TSTypeParameterInstantiation', 'TSArrayType', 'TSTupleType', 'TSStringKeyword', 'TSNumberKeyword']);
const shape = (node: t.Node) => JSON.stringify(node, (key, value) => ['loc', 'start', 'end', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key) ? undefined : value);
const same = (node: t.Node, expected: string) => shape(node) === shape(parse(expected, { sourceType: 'module' }).program.body[0]);
const styleLiteral = (value: string) => ['', '#', '0', 'light', 'dark', 'data-theme', './registry', './types'].includes(value) || /^#[0-9a-fA-F]{3,8}$/.test(value) || /^--[a-z][a-z0-9-]{0,63}$/.test(value) || /^0 [0-9]+px [0-9]+px rgba\([0-9., ]+\)$/.test(value);

/** Parse-only proof for one unchanged theme module; this is not an executable-code sandbox. */
export function proveThemeStyleModule(bytes: Buffer) {
  const text = bytes.toString('utf8');
  if (!bytes.length || bytes.length > 1024 * 1024 || text.includes('\0') || text.includes('\ufffd') || !Buffer.from(text).equals(bytes)) fail();
  assertNoPrivateSourceContent(text);
  let ast: t.File;
  try { ast = parse(text, { sourceType: 'module', plugins: ['typescript'] }); } catch { fail(); }
  const functions = new Map<string, t.VariableDeclarator>();
  const exported: string[] = [];
  let registryImports = 0, typeImports = 0;
  for (const statement of ast!.program.body) {
    if (t.isImportDeclaration(statement)) {
      if (statement.source.value === './registry' && statement.importKind !== 'type' && statement.specifiers.length === 1) {
        const item = statement.specifiers[0];
        if (!t.isImportSpecifier(item) || !t.isIdentifier(item.imported, { name: 'getThemePresetById' }) || item.local.name !== 'getThemePresetById' || item.importKind === 'type') fail();
        registryImports++;
      } else if (statement.source.value === './types' && statement.importKind === 'type' && statement.specifiers.every(item => t.isImportSpecifier(item) && t.isIdentifier(item.imported) && types.includes(item.imported.name) && item.local.name === item.imported.name)) typeImports++;
      else fail();
      continue;
    }
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!t.isVariableDeclaration(declaration) || declaration.kind !== 'const' || declaration.declarations.length !== 1) fail();
    const item = (declaration as t.VariableDeclaration).declarations[0];
    if (!t.isIdentifier(item.id) || !t.isArrowFunctionExpression(item.init) || item.init.async || functions.has(item.id.name) || forbiddenName.test(item.id.name) || privateName.test(item.id.name)) fail();
    functions.set((item.id as t.Identifier).name, item);
    if (t.isExportNamedDeclaration(statement)) exported.push((item.id as t.Identifier).name);
  }
  if (registryImports !== 1 || typeImports > 1 || functions.size > 32 || exported.sort().join(',') !== exports.join(',')) fail();
  const dom = functions.get('applyThemeToDOM')!.init as t.ArrowFunctionExpression;
  if (!t.isBlockStatement(dom.body) || dom.params.length !== 3 || !dom.params.every((param, index) => t.isIdentifier(param, { name: ['theme', 'tokens', 'appearanceSettings'][index] }))) fail();
  const body = (dom.body as t.BlockStatement).body;
  const fixed = ['const root=document.documentElement;', "root.classList.remove('light','dark');", 'root.classList.add(theme);', "root.setAttribute('data-theme',theme);"];
  if (body.length !== 6 || body.slice(0, 4).some((node, index) => !same(node, fixed[index])) || !same(body[5], 'entries.forEach(([key,value])=>root.style.setProperty(key,value));')) fail();
  const declaration = body[4];
  if (!t.isVariableDeclaration(declaration) || declaration.kind !== 'const' || declaration.declarations.length !== 1 || !t.isIdentifier(declaration.declarations[0].id, { name: 'entries' }) || !t.isArrayExpression(declaration.declarations[0].init)) fail();
  const entries = (declaration as t.VariableDeclaration).declarations[0].init as t.ArrayExpression;
  const keys = new Set<string>();
  if (!entries.elements.length || entries.elements.length > 128) fail();
  for (const pair of entries.elements) {
    if (!t.isArrayExpression(pair) || pair.elements.length !== 2 || !t.isStringLiteral(pair.elements[0]) || !/^--[a-z][a-z0-9-]{0,63}$/.test(pair.elements[0].value) || keys.has(pair.elements[0].value) || !pair.elements[1]) fail();
    keys.add(((pair as t.ArrayExpression).elements[0] as t.StringLiteral).value);
  }
  const domNodes = new WeakSet<t.Node>();
  const mark = (node: t.Node) => { domNodes.add(node); for (const key of t.VISITOR_KEYS[node.type] ?? []) { const value = (node as any)[key]; if (Array.isArray(value)) value.forEach(item => { if (item) mark(item); }); else if (value) mark(value); } };
  body.slice(0, 4).forEach(mark); mark(body[5]); mark((declaration as t.VariableDeclaration).declarations[0].id);
  let nodes = 0;
  traverse(ast!, { enter(p: any) {
    const node: t.Node = p.node;
    if (++nodes > 10000 || !syntax.has(node.type)) fail();
    if (t.isStringLiteral(node)) { assertNoPrivateSourceContent(node.value); if (privateName.test(node.value) || !styleLiteral(node.value)) fail(); }
    if (t.isTemplateElement(node)) { const value = node.value.cooked ?? node.value.raw; assertNoPrivateSourceContent(value); if (!['', '#', 'rgba(', ', ', ')', 'rem', 'px'].includes(value)) fail(); }
    if (t.isRegExpLiteral(node) && (node.pattern !== '^#(?:[0-9a-fA-F]{3}){1,2}$' || node.flags)) fail();
    if (t.isTSTypeReference(node) && (!t.isIdentifier(node.typeName) || !['Array', ...types].includes(node.typeName.name))) fail();
    if (t.isIdentifier(node) && privateName.test(node.name)) fail();
    if (t.isMemberExpression(node) && (node.computed || !t.isIdentifier(node.property) || /^(?:constructor|prototype|__proto__)$/.test(node.property.name))) fail();
    if (t.isObjectProperty(node) && (node.computed || !(t.isIdentifier(node.key) || t.isStringLiteral(node.key)) || /^(?:constructor|prototype|__proto__)$/.test(t.isIdentifier(node.key) ? node.key.name : node.key.value))) fail();
    if (t.isVariableDeclaration(node) && node.kind !== 'const') fail();
    if (t.isArrowFunctionExpression(node) && node.async) fail();
    if (t.isUnaryExpression(node) && !['+', '-', '!'].includes(node.operator)) fail();
    if (t.isIdentifier(node) && p.isBindingIdentifier() && forbiddenName.test(node.name)) fail();
    if (t.isIdentifier(node) && p.isReferencedIdentifier()) {
      const typePosition = p.parentPath.isTSTypeReference() && p.key === 'typeName';
      if (node.name === 'Array' && typePosition) return;
      const binding = p.scope.getBinding(node.name);
      if (binding?.path.isImportSpecifier()) {
        const declaration = binding.path.parentPath.node;
        const typeOnly = binding.path.node.importKind === 'type' || t.isImportDeclaration(declaration) && declaration.importKind === 'type';
        if (typeOnly && !typePosition) fail();
      }
      if (['root', 'entries', 'document'].includes(node.name) && !domNodes.has(node)) fail();
      if (!binding && !(['Math', 'Number'].includes(node.name) || node.name === 'document' && domNodes.has(node))) fail();
    }
    if (!t.isCallExpression(node) || domNodes.has(node)) return;
    const callee = node.callee;
    if (t.isIdentifier(callee)) {
      const binding = p.scope.getBinding(callee.name);
      if (callee.name === 'getThemePresetById' && binding?.path.isImportSpecifier()) return;
      if (binding?.path.node === functions.get(callee.name)) return;
      fail();
    }
    if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property)) fail();
    const member = callee as t.MemberExpression, method = (member.property as t.Identifier).name;
    if (t.isIdentifier(member.object, { name: 'Math' }) && ['min', 'max', 'round'].includes(method)) return;
    if (t.isIdentifier(member.object, { name: 'Number' }) && method === 'parseInt' && node.arguments.length === 2 && t.isNumericLiteral(node.arguments[1], { value: 16 })) return;
    if (t.isRegExpLiteral(member.object) && member.object.pattern === '^#(?:[0-9a-fA-F]{3}){1,2}$' && !member.object.flags && method === 'test' && node.arguments.length === 1) return;
    const args = node.arguments;
    if (method === 'map' && args.length === 1 && t.isArrowFunctionExpression(args[0])) return;
    if (method === 'replace' && args.length === 2 && t.isStringLiteral(args[0], { value: '#' }) && t.isStringLiteral(args[1], { value: '' })) return;
    if (['split', 'join'].includes(method) && args.length === 1 && t.isStringLiteral(args[0], { value: '' })) return;
    if (method === 'slice' && args.length === 2 && t.isNumericLiteral(args[0], { value: 0 }) && t.isNumericLiteral(args[1], { value: 6 })) return;
    if (method === 'toString' && args.length === 1 && t.isNumericLiteral(args[0], { value: 16 })) return;
    if (method === 'padStart' && args.length === 2 && t.isNumericLiteral(args[0], { value: 2 }) && t.isStringLiteral(args[1], { value: '0' })) return;
    if (method === 'toFixed' && args.length === 1 && t.isNumericLiteral(args[0]) && [2, 3].includes(args[0].value)) return;
    fail();
  } });
  return { profile: 'theme-color-css-v1', sourceSha256: digest(bytes), exports, cssProperties: [...keys], parsedOnly: true };
}
