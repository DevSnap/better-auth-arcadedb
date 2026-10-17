import { readFile } from "node:fs/promises";
import { db } from "./auth.js";

const path = process.argv[2] ?? "arcadedb-schema.sql";
const command = await readFile(path, "utf8");
await db.command({ language: "sqlscript", command });
console.info(`Applied ${path}`);
