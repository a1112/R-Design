import { expect, it } from 'vitest';
import { transform } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
import { rdesignSourceIds } from '../../packages/runtime-web/src/vite';

const host = path.resolve(import.meta.dirname, '../..');
const requireReact18 = createRequire(path.join(host, 'packages/runtime-react18/package.json'));
async function compile(source: string, instrumented = false) {
  const plugin = rdesignSourceIds({ root: '/ordinary-fixture', enabled: true, domOnly: true });
  const hook = plugin.transform as (code: string, id: string) => { code: string } | null;
  const code = instrumented ? hook(source, '/ordinary-fixture/src/App.tsx')!.code : source;
  const output = await transform(code, { loader: 'tsx', jsx: 'automatic', format: 'cjs', target: 'es2022' });
  const module = { exports: {} as any };
  // Execute only the fixed synthetic JSX fixture against the existing frozen React 18 runtime.
  new Function('require', 'module', 'exports', output.code)(requireReact18, module, module.exports);
  return module.exports;
}

it.each([
  ['quoted decimal entity', 'defaultValue="First line&#10;  indented line"', 'First line\n  indented line'],
  ['quoted hexadecimal entity', 'defaultValue="First line&#xA;  indented line"', 'First line\n  indented line'],
  ['quoted escaped entity', 'defaultValue="First line&amp;#10;  indented line"', 'First line&#10;  indented line'],
  ['string expression', 'defaultValue={"First line\\n  indented line"}', 'First line\n  indented line'],
  ['template expression', 'defaultValue={`First line\n  indented line`}', 'First line\n  indented line'],
  ['single line', 'defaultValue="First  line"', 'First  line'],
  ['physical quoted newline', 'defaultValue="First line\n  indented line"', undefined],
] as const)('preserves downstream JSX string semantics for %s', async (_name, attribute, expected) => {
  const source = `export const element=<textarea ${attribute}/>;`;
  const baseline = await compile(source), observed = await compile(source, true);
  if (expected !== undefined) expect(baseline.element.props.defaultValue).toBe(expected);
  expect(observed.element.props.defaultValue).toBe(baseline.element.props.defaultValue);
});

it.each([
  'id={mark("id")} key={mark("key")} title={mark("title")}',
  'key={mark("key")} {...{id:mark("id")}} title={mark("title")}',
  'id={mark("id")} {...{key:mark("spread-key")}} key={mark("key")} title={mark("title")}',
])('preserves the compiler evaluation order for %s', async attributes => {
  const source = `export const order=[];const mark=name=>{order.push(name);return name};export const element=<div ${attributes}>{mark("child")}</div>;`;
  const baseline = await compile(source), observed = await compile(source, true);
  expect(observed.order).toEqual(baseline.order);
  expect(observed.element.key).toBe(baseline.element.key);
  expect(observed.element.props.children).toBe(baseline.element.props.children);
});
