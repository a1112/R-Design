import { describe, expect, it } from 'vitest';
import { isInstrumentationNode, safeText } from '../../packages/runtime-web/src/index';
import { injectSourceIds, rdesignSourceIds } from '../../packages/runtime-web/src/vite';
import type { ResolvedConfig } from 'vite';

function text(value: string): Node { return { nodeType: 3, textContent: value } as Node; }
function element(tag: string, children: Node[] = [], attributes: string[] = []): Element {
  const node = { nodeType: 1, tagName: tag.toUpperCase(), childNodes: children, hasAttribute: (name: string) => attributes.includes(name), closest: (selector: string) => selector === '[data-rdesign-private]' && attributes.includes('data-rdesign-private') ? node : null };
  return node as unknown as Element;
}
describe('runtime privacy and opaque source identity', () => {
  it('excludes all form contents and private descendants from ancestor text', () => {
    const root = element('section', [text('Settings'), element('input', [text('private-password')]), element('textarea', [text('form-value')]), element('select', [element('option', [text('private-option')])]), element('div', [text('private-token')], ['data-rdesign-private']), element('button', [text('Save')])]);
    expect(safeText(root)).toBe('Settings Save');
    expect(safeText(element('input', [text('password')]))).toBe('');
    expect(safeText(element('div', [text('token')], ['data-rdesign-private']))).toBe('[已隐藏]');
  });
  it('preserves manually assigned IDs and never injects an absolute source path', () => {
    const code = 'export const Card = () => <article><button data-rdesign-id="manual-button">Start</button><Widget /></article>';
    const result = injectSourceIds(code, '/secret/home/project/src/Card.tsx', '/secret/home/project');
    expect(result).toContain('data-rdesign-id="manual-button"');
    expect(result.match(/data-rdesign-id=/g)).toHaveLength(2);
    expect(result).toMatch(/source-[a-f0-9]{16}/);
    expect(result).not.toContain('/secret');
    expect(result).not.toContain('Card.tsx');
    expect(injectSourceIds(code, '/candidate/src/Card.tsx', '/candidate')).toBe(result);
  });
  it('injects only development builds by default and skips dependencies', () => {
    const run = (command: 'serve' | 'build', id: string, enabled?: boolean) => {
      const plugin = rdesignSourceIds({ enabled });
      const resolved = plugin.configResolved as (config: ResolvedConfig) => void;
      const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
      resolved({ root: '/project', command } as ResolvedConfig);
      return transform('export const App = () => <main>Hello</main>', id);
    };
    expect(run('serve', '/project/src/App.tsx')?.code).toContain('data-rdesign-id="source-');
    expect(run('build', '/project/src/App.tsx')).toBeNull();
    expect(run('serve', '/project/src/App.tsx', false)).toBeNull();
    expect(run('serve', '/project/node_modules/demo/App.tsx')).toBeNull();
    expect(run('build', '/project/src/App.tsx', true)?.code).toContain('data-rdesign-id="source-');
  });
  it('ignores mask instrumentation while retaining normal custom elements', () => {
    const helper = element('x-pw-glass', [text('capture helper')]);
    expect(isInstrumentationNode(helper)).toBe(true);
    expect(isInstrumentationNode(element('x-device-card'))).toBe(false);
    expect(safeText(element('main', [text('Monitor'), helper]))).toBe('Monitor');
  });
});
