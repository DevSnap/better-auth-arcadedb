import {
  authFlowTestSuite,
  caseInsensitiveTestSuite,
  joinsTestSuite,
  normalTestSuite,
  testAdapter,
  transactionsTestSuite,
  uuidTestSuite,
} from "@better-auth/test-utils/adapter";
import { arcadeDBAdapter } from "../../src/index.js";
import { database, migrate, server } from "./helpers.js";

const db = await database("official");
const { execute } = await testAdapter({
  adapter: () => arcadeDBAdapter(db),
  runMigrations: (options) => migrate(db, options).then(() => undefined),
  tests: [
    normalTestSuite(),
    caseInsensitiveTestSuite(),
    joinsTestSuite(),
    transactionsTestSuite(),
    uuidTestSuite(),
    authFlowTestSuite(),
  ],
  onFinish: () => server.dropDatabase(db.name),
});
execute();
