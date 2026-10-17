import { basicAuth, createClient } from "@arcadedb/driver";
import type { BetterAuthOptions } from "better-auth";
import { arcadeDBAdapter } from "../../src/index.js";

export const server = createClient({
  baseUrl: process.env.ARCADEDB_URL ?? "http://localhost:2480",
  auth: basicAuth(
    process.env.ARCADEDB_USERNAME ?? "root",
    process.env.ARCADEDB_PASSWORD ?? "arcadedb-test-password",
  ),
});

export async function database(prefix: string) {
  const name = `ba_${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  await server.createDatabase(name);
  return server.db(name);
}

export async function migrate(
  db: ReturnType<typeof server.db>,
  options: BetterAuthOptions,
  usePlural = false,
) {
  const adapter = arcadeDBAdapter(db, { usePlural })(options);
  const schema = await adapter.createSchema!(options);
  for (const command of schema.code
    .split(";\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await db.command({ language: "sql", command });
  }
  return adapter;
}
