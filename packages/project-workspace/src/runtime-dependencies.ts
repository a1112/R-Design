/** Reviewed browser packages shipped by the host. Import never installs packages. */
export const REVIEWED_RUNTIME_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({
  'lucide-react': '0.468.0',
  three: '0.180.0',
  '@tauri-apps/api': '2.8.0',
  'react-markdown': '9.0.3',
  'remark-gfm': '4.0.1',
  i18next: '25.10.0',
  'react-i18next': '16.3.5',
  'react-router-dom': '7.9.3',
  uplot: '1.6.32',
  zod: '3.25.76',
});

export const CORE_PROJECT_DEPENDENCIES = new Set([
  'react', 'react-dom', '@rdesign/runtime-web', 'vite', '@vitejs/plugin-react',
  'typescript', '@types/react', '@types/react-dom',
]);

export function reviewedDependency(name: string, version: unknown): boolean {
  return typeof version === 'string' && REVIEWED_RUNTIME_DEPENDENCIES[name] === version;
}
