import { writeFile } from "node:fs/promises";
import { arcadeDBAdapter } from "../../src/index.js";
import { db, options } from "./auth.js";

const schema = await arcadeDBAdapter(db)(options).createSchema!(options);
await writeFile(schema.path, schema.code);
console.info(`Generated ${schema.path}`);
