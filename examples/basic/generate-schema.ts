import { writeFile } from "node:fs/promises";
import { arcadeDBAdapter } from "../../src/index.js";
import { db, options } from "./auth.js";

const schema = await arcadeDBAdapter(db)(options).createSchema!(options);
const path = process.argv[2] ?? schema.path;
await writeFile(path, schema.code);
console.info(`Generated ${path}`);
