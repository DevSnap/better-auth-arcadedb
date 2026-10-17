import assert from "node:assert/strict";
import { createClient } from "@arcadedb/driver";
import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter } from "better-auth/adapters";
import {
  type ArcadeDBAdapterConfig,
  arcadeDBAdapter,
} from "better-auth-arcadedb";

const db = createClient({ baseUrl: "http://127.0.0.1:1" }).db("package_smoke");
const config: ArcadeDBAdapterConfig = { usePlural: false, debugLogs: false };
const options: BetterAuthOptions = { emailAndPassword: { enabled: true } };
assert.equal(typeof arcadeDBAdapter, "function");
const adapter: DBAdapter = arcadeDBAdapter(db, config)(options);
assert.equal(typeof adapter.createSchema, "function");
assert.ok(adapter.createSchema);
const schema = await adapter.createSchema(options);
assert.equal(schema.path, "arcadedb-schema.sql");
assert.equal(schema.overwrite, true);
for (const model of ["user", "session", "account", "verification"]) {
  assert.ok(schema.code.includes(`CREATE DOCUMENT TYPE \`${model}\``));
  assert.ok(
    schema.code.includes(
      `CREATE INDEX IF NOT EXISTS ON \`${model}\` (\`id\`) UNIQUE;`,
    ),
  );
}
console.log("Tarball ESM import, public types and schema generation passed.");
