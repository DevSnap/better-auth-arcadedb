import type { BetterAuthDBSchema } from "better-auth/db";
import { identifier } from "./sql.js";

/** Generate additive DDL; changes to existing property types require a migration. */
export function generateSchema(
  tables: BetterAuthDBSchema,
  getModelName: (model: string) => string,
): string {
  const statements: string[] = [];
  for (const [key, table] of Object.entries(tables)) {
    const model = identifier(getModelName(key));
    statements.push(`CREATE DOCUMENT TYPE ${model} IF NOT EXISTS;`);
    const fields: typeof table.fields = {
      ...table.fields,
      id: { type: "string", unique: true },
    };
    for (const [key, attributes] of Object.entries(fields)) {
      const field = identifier(attributes.fieldName ?? key);
      const type = Array.isArray(attributes.type)
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
  }
  return `${statements.join("\n")}\n`;
}
