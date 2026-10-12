import { DomainError } from '../../document-core/src/index.js';

export type RuntimeProfile = 'react19' | 'react18';
export const REACT18_CORE_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  react: '18.3.1', 'react-dom': '18.3.1', '@types/react': '18.3.31', '@types/react-dom': '18.3.7',
});

/** Executable package metadata never configures a managed React 18 preview. */
export function assertProfileExecution(config: Record<string, unknown>, profile: RuntimeProfile): void {
  if (profile !== 'react18') return;
  const scripts = config.scripts ?? {};
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts) ||
      Object.entries(scripts).some(([name, value]) => !['dev', 'build'].includes(name) || typeof value !== 'string' || !/^vite(?: build)?(?: --host 127\.0\.0\.1)?(?: --port \d+)?$/.test(value)) ||
      ['bin', 'workspaces', 'packageManager', 'overrides', 'resolutions', 'imports'].some(name => config[name] !== undefined)) {
    throw new DomainError('IMPORT_CONFIG', 'React 18 包配置包含未授权的脚本或依赖重定向', 400);
  }
}

export function assertRuntimeProfile(profile: unknown): asserts profile is RuntimeProfile {
  if (profile !== 'react19' && profile !== 'react18') throw new DomainError('IMPORT_CONFIG', '未知项目运行配置', 400);
}

/** The package carries only an enumerated opt-in, never paths, aliases, scripts or registry URLs. */
export function runtimeProfileFromPackage(config: unknown): RuntimeProfile {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new DomainError('IMPORT_CONFIG', '无效项目包配置', 400);
  const metadata = (config as Record<string, unknown>).rdesign;
  if (metadata === undefined) return 'react19';
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(key => key !== 'runtimeProfile')) throw new DomainError('IMPORT_CONFIG', '运行配置只接受受控 profile 标识', 400);
  const profile = (metadata as Record<string, unknown>).runtimeProfile;
  assertRuntimeProfile(profile);
  return profile;
}

/** Explicit React 18 bundles cannot mix React majors or smuggle an alternate core package spec. */
export function assertProfileCoreVersions(config: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; optionalDependencies?: Record<string, unknown> }, profile: RuntimeProfile): void {
  if (profile !== 'react18') return;
  if (config.dependencies?.react !== '18.3.1' || config.dependencies?.['react-dom'] !== '18.3.1') throw new DomainError('IMPORT_CONFIG', 'React 18 配置须声明精确的 React/ReactDOM 18.3.1', 400);
  for (const declarations of [config.dependencies, config.devDependencies, config.optionalDependencies]) {
    for (const [name, version] of Object.entries(declarations ?? {})) if (name in REACT18_CORE_VERSIONS && version !== REACT18_CORE_VERSIONS[name]) throw new DomainError('IMPORT_CONFIG', 'React 18 核心依赖版本不匹配', 400);
  }
}
