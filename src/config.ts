export interface AppConfig {
  host: string;
  port: number;
  frontendPort: number;
  publicBaseUrl?: string;
  configDir: string;
  codexBin: string;
  codexHome?: string;
  codexAppServerUrl?: string;
  codexAppServerPort: number;
  dataDir: string;
  projectRoot: string;
  bridgeToken?: string;
  password: string;
  authEnabled: boolean;
  enableExperimentalCodexApi: boolean;
  notificationUrl?: string;
  notificationToken?: string;
  notificationTargetType?: string;
  notificationTargetId?: string;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AppConfig {
  const backendPort = firstEnv(
    ["CODEX_WEB_BACKEND_PORT", env.CODEX_WEB_BACKEND_PORT],
    ["PORT", env.PORT]
  );
  const frontendPort = firstEnv(
    ["CODEX_WEB_FRONTEND_PORT", env.CODEX_WEB_FRONTEND_PORT],
    ["FRONTEND_PORT", env.FRONTEND_PORT]
  );
  return {
    host: firstValue(env.CODEX_WEB_HOST, env.HOST) || "0.0.0.0",
    port: parsePort(backendPort.value, backendPort.name ?? "CODEX_WEB_BACKEND_PORT", 49380),
    frontendPort: parsePort(frontendPort.value, frontendPort.name ?? "CODEX_WEB_FRONTEND_PORT", 49381),
    publicBaseUrl: emptyToUndefined(env.PUBLIC_BASE_URL),
    configDir: env.CODEX_WEB_CONFIG_DIR || process.cwd(),
    codexBin: env.CODEX_BIN || "codex",
    codexHome: emptyToUndefined(env.CODEX_HOME),
    codexAppServerUrl: emptyToUndefined(env.CODEX_APP_SERVER_URL),
    codexAppServerPort: parsePort(env.CODEX_APP_SERVER_PORT, "CODEX_APP_SERVER_PORT", 49317),
    dataDir: env.CODEX_WEB_DATA_DIR || env.DATA_DIR || ".data",
    projectRoot: env.CODEX_WEB_PROJECT_ROOT || process.cwd(),
    bridgeToken: emptyToUndefined(env.BRIDGE_TOKEN),
    password: emptyToUndefined(firstValue(env.CODEX_WEB_PASSWORD, env.APP_PASSWORD)) ?? "root",
    authEnabled: parseBoolean(env.CODEX_WEB_AUTH_ENABLED, (env.NODE_ENV ?? process.env.NODE_ENV) === "test" ? false : true),
    enableExperimentalCodexApi: parseBoolean(env.ENABLE_EXPERIMENTAL_CODEX_API, true),
    notificationUrl: emptyToUndefined(env.NOTIFY_URL),
    notificationToken: emptyToUndefined(env.NOTIFY_TOKEN),
    notificationTargetType: emptyToUndefined(env.NOTIFY_TARGET_TYPE),
    notificationTargetId: emptyToUndefined(env.NOTIFY_TARGET_ID)
  };
}

function firstEnv(...entries: Array<[name: string, value: string | undefined]>): { name?: string; value?: string } {
  for (const [name, value] of entries) {
    if (value !== undefined && value.trim() !== "") return { name, value };
  }
  return {};
}

function firstValue(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.trim() !== "");
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`ENABLE_EXPERIMENTAL_CODEX_API must be a boolean`);
}

function parsePort(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be an integer`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return port;
}
