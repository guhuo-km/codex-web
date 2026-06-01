import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".evn", override: true });

const host = process.env.CODEX_WEB_HOST || process.env.HOST || "0.0.0.0";
const frontendPort = parsePort(process.env.CODEX_WEB_FRONTEND_PORT || process.env.FRONTEND_PORT, 49381);
const backendPort = parsePort(process.env.CODEX_WEB_BACKEND_PORT || process.env.PORT, 49380);
const backendHttp = `http://127.0.0.1:${backendPort}`;
const backendWs = `ws://127.0.0.1:${backendPort}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-web",
    emptyOutDir: true
  },
  server: {
    host,
    port: frontendPort,
    proxy: {
      "/api": backendHttp,
      "/health": backendHttp,
      "/ready": backendHttp,
      "/icons": backendHttp,
      "/ws": {
        target: backendWs,
        ws: true
      }
    }
  }
});

function parsePort(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

