import type { BetterAuthDBSchema } from "better-auth/db";
import { identifier } from "./sql.js";
import { literal, serialCounter } from "./serial.js";

/** Generate additive DDL; changes to existing property types require a migration. */
export function generateSchema(
  tables: BetterAuthDBSchema,
  getModelName: (model: string) => string,
  serial = false,
): string {
  const statements: string[] = [];
  if (serial) {
    if (Object.keys(tables).some((key) => getModelName(key) === serialCounter))
      throw new TypeError(`Reserved serial counter model: ${serialCounter}`);
    const counter = identifier(serialCounter);
    statements.push(
      `CREATE DOCUMENT TYPE ${counter} IF NOT EXISTS;`,
      `CREATE PROPERTY ${counter}.\`model\` IF NOT EXISTS STRING;`,
      `CREATE PROPERTY ${counter}.\`value\` IF NOT EXISTS LONG;`,
      `CREATE INDEX IF NOT EXISTS ON ${counter} (\`model\`) UNIQUE;`,
    );
  }
  for (const [key, table] of Object.entries(tables)) {
    if (table.disableMigrations) continue;
    const model = identifier(getModelName(key));
    statements.push(`CREATE DOCUMENT TYPE ${model} IF NOT EXISTS;`);
    const fields: typeof table.fields = {
      ...table.fields,
      id: { type: serial ? "number" : "string", unique: true },
    };
    for (const [key, attributes] of Object.entries(fields)) {
      const field = identifier(attributes.fieldName ?? key);
      const numericId =
        serial && (key === "id" || attributes.references?.field === "id");
      const type =
        numericId &&
        attributes.type !== "string[]" &&
        attributes.type !== "number[]" &&
        !Array.isArray(attributes.type)
          ? "LONG"
          : Array.isArray(attributes.type)
            ? "STRING"
            : {
                string: "STRING",
                number: "DOUBLE",
                boolean: "BOOLEAN",
                date: "STRING",
                json: "STRING",
                "string[]": "LIST",
                "number[]": "LIST",
              }[attributes.type];
      if (!type)
        throw new TypeError(`Unsupported schema type for ${model}.${field}`);
      statements.push(
        `CREATE PROPERTY ${model}.${field} IF NOT EXISTS ${type};`,
      );
      if (attributes.unique || attributes.index || attributes.references) {
        statements.push(
          `CREATE INDEX IF NOT EXISTS ON ${model} (${field}) ${attributes.unique ? "UNIQUE" : "NOTUNIQUE"};`,
        );
      }
    }
    if (serial)
      statements.push(
        `IF ((SELECT count(*) AS total FROM ${identifier(serialCounter)} WHERE \`model\` = ${literal(getModelName(key))})[0].total = 0) { INSERT INTO ${identifier(serialCounter)} SET \`model\` = ${literal(getModelName(key))}, \`value\` = 0; };`,
      );
    for (const index of table.indexes ?? []) {
      const name = index.name === undefined ? "" : ` ${identifier(index.name)}`;
      const columns = index.fields.map((field) => {
        const attributes = fields[field];
        if (!attributes)
          throw new TypeError(`Unknown index field ${model}.${field}`);
        return identifier(attributes.fieldName ?? field);
      });
      statements.push(
        `CREATE INDEX${name} IF NOT EXISTS ON ${model} (${columns.join(", ")}) ${index.unique ? "UNIQUE" : "NOTUNIQUE"};`,
      );
    }
  }
  return `${statements.join("\n")}\n`;
}
