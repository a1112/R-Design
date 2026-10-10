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
  '@radix-ui/react-context-menu': '2.3.7',
  '@radix-ui/react-dialog': '1.1.23',
  '@radix-ui/react-dropdown-menu': '2.1.24',
  '@radix-ui/react-select': '2.3.7',
  '@radix-ui/react-slot': '1.3.3',
  '@radix-ui/react-tooltip': '1.2.8',
  'class-variance-authority': '0.7.1',
  'date-fns': '3.6.0',
  clsx: '2.1.1',
  'tailwind-merge': '3.7.0',
  'qrcode-generator': '1.5.2',
  // Separate import name preserves the existing icon version for other projects.
  'lucide-react-v0487': '0.487.0',
  'framer-motion': '12.43.0',
  recharts: '2.15.4', // Host pins this package's react-is to 19.3.0 for React 19 fragments.
  sonner: '2.0.8',
  xterm: '5.3.0',
  'xterm-addon-fit': '0.8.0',
  'xterm-addon-web-links': '0.9.0',
  motion: '12.23.24',
  'react-dnd': '16.0.1',
  'react-dnd-html5-backend': '16.0.1',
  'react-syntax-highlighter': '16.1.2',
});

export const CORE_PROJECT_DEPENDENCIES = new Set([
  'react', 'react-dom', '@rdesign/runtime-web', 'vite', '@vitejs/plugin-react',
  'typescript', '@types/react', '@types/react-dom',
]);

export function reviewedDependency(name: string, version: unknown): boolean {
  return typeof version === 'string' && REVIEWED_RUNTIME_DEPENDENCIES[name] === version;
}
