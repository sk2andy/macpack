export type ManagerName = "homebrew" | "npm" | "pnpm" | "bun" | "uv";

export interface MasApp {
  name: string;
  id: string;
}

export interface UvTool {
  python: string;
  packageName: string;
}

export interface PackageManifest {
  taps: string[];
  brews: string[];
  casks: string[];
  masApps: MasApp[];
  npmPackages: string[];
  pnpmPackages: string[];
  bunPackages: string[];
  uvTools: UvTool[];
}

export interface RunOptions {
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  quiet?: boolean;
}

export interface ApplyOptions extends RunOptions {
  cleanup?: boolean;
  yes?: boolean;
}

export interface CleanupOptions extends RunOptions {
  yes?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
