import {
  authFlowTestSuite,
  numberIdTestSuite,
  testAdapter,
} from "@better-auth/test-utils/adapter";
import { arcadeDBAdapter } from "../../src/index.js";
import { database, migrate, server } from "./helpers.js";

const db = await database("serial_official");
const { execute } = await testAdapter({
  adapter: () => arcadeDBAdapter(db),
  runMigrations: (options) => migrate(db, options).then(() => undefined),
  overrideBetterAuthOptions: (options) => ({
    ...options,
    advanced: {
      ...options.advanced,
      database: { ...options.advanced?.database, generateId: "serial" },
    },
  }),
  tests: [numberIdTestSuite(), authFlowTestSuite()],
  onFinish: () => server.dropDatabase(db.name),
});
execute();
