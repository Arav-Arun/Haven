import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { createApi, readEnv } from "./app";

// apps/api/.env for local runs; on Fly the same names come from `fly secrets set`.
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

const env = readEnv(process.env);
const { app, relayer } = createApi(env);
const port = Number(process.env.PORT);
if (!port) throw new Error("PORT is not set");
serve({ fetch: app.fetch, port }, () => console.log(`Cloakroom API on :${port}, relayer ${relayer}`));
