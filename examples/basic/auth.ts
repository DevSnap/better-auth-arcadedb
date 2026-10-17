import { basicAuth, createClient } from "@arcadedb/driver";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { arcadeDBAdapter } from "../../src/index.js";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

const server = createClient({
  baseUrl: env("ARCADEDB_URL"),
  auth: basicAuth(env("ARCADEDB_USERNAME"), env("ARCADEDB_PASSWORD")),
});
export const db = server.db(env("ARCADEDB_DATABASE"));
export const options = {
  secret: env("BETTER_AUTH_SECRET"),
  baseURL: env("BETTER_AUTH_URL"),
  database: arcadeDBAdapter(db),
  emailAndPassword: { enabled: true },
} satisfies BetterAuthOptions;

export const auth = betterAuth(options);
