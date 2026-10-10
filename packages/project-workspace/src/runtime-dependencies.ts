/** Reviewed browser packages shipped by the host. Import never installs packages. */
export const REVIEWED_RUNTIME_DEPENDENCIES: Readonly<Record<string, string>> = Object.freeze({
  'lucide-react': '0.468.0',
  three: '0.180.0',
  '@tauri-apps/api': '2.8.0',
});

export const CORE_PROJECT_DEPENDENCIES = new Set([
  'react', 'react-dom', '@rdesign/runtime-web', 'vite', '@vitejs/plugin-react',
  'typescript', '@types/react', '@types/react-dom',
]);

export function reviewedDependency(name: string, version: unknown): boolean {
  return typeof version === 'string' && REVIEWED_RUNTIME_DEPENDENCIES[name] === version;
}
