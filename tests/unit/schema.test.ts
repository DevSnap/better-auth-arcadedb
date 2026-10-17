import { createClient } from "@arcadedb/driver";
import type { BetterAuthDBSchema, DBFieldAttribute } from "better-auth/db";
import { describe, expect, it } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";
import { generateSchema } from "../../src/schema.js";

const db = createClient({ baseUrl: "http://arcadedb.test" }).db("test");

describe("schema generation", () => {
  it("generates serial ids, numeric id references and isolated persistent counters", () => {
    const code = generateSchema(
      {
        entry: {
          modelName: "entry",
          fields: {
            owner: {
              type: "string",
              fieldName: "owner_id",
              references: { model: "user", field: "id" },
            },
            slug: {
              type: "string",
              references: { model: "user", field: "slug" },
            },
            score: { type: "number" },
            owners: {
              type: "string[]",
              references: { model: "user", field: "id" },
            },
          },
        },
        external: {
          modelName: "external",
          disableMigrations: true,
          fields: {},
        },
      },
      (model) => model,
      true,
    );
    expect(code).toContain("CREATE PROPERTY `entry`.`id` IF NOT EXISTS LONG;");
    expect(code).toContain(
      "CREATE PROPERTY `entry`.`owner_id` IF NOT EXISTS LONG;",
    );
    expect(code).toContain(
      "CREATE PROPERTY `entry`.`slug` IF NOT EXISTS STRING;",
    );
    expect(code).toContain(
      "CREATE PROPERTY `entry`.`score` IF NOT EXISTS DOUBLE;",
    );
    expect(code).toContain(
      "CREATE PROPERTY `entry`.`owners` IF NOT EXISTS LIST;",
    );
    expect(code).toContain("WHERE `model` = 'entry'");
    expect(code).not.toContain("external");
    expect(code).not.toContain("CREATE TRIGGER");
  });

  it("reserves the internal counter type and escapes physical names as literals", () => {
    expect(() =>
      generateSchema(
        { entry: { modelName: "entry", fields: {} } },
        () => "__better_auth_serial",
        true,
      ),
    ).toThrow("Reserved");
    const code = generateSchema(
      { entry: { modelName: "entry", fields: {} } },
      () => "a'b\\c",
      true,
    );
    expect(code).toContain("WHERE `model` = 'a\\'b\\\\c'");
    expect(code).toContain("CREATE DOCUMENT TYPE `a'b\\c`");
  });

  it("omits plugin models that disable migrations", async () => {
    const adapter = arcadeDBAdapter(db)({
      plugins: [
        {
          id: "external-model",
          schema: {
            external: {
              disableMigration: true,
              fields: { value: { type: "string", unique: true } },
              indexes: [{ name: "external_value", fields: ["value"] }],
            },
          },
        },
      ],
    });
    const schema = await adapter.createSchema!({});
    expect(schema.code).toContain("CREATE DOCUMENT TYPE `user`");
    expect(schema.code).not.toContain("external");
  });

  it("preserves field indexes, references and the implicit unique id", () => {
    const schema = generateSchema(
      {
        entry: {
          modelName: "entry",
          fields: {
            slug: { type: "string", fieldName: "slug_key", unique: true },
            search: { type: "string", index: true },
            owner: {
              type: "string",
              fieldName: "owner_id",
              references: { model: "user", field: "id" },
            },
            plain: { type: "string" },
          },
          indexes: [{ name: "entry_identity", fields: ["id", "slug"] }],
        },
      },
      (model) => model,
    );
    expect(
      schema.split("\n").filter((line) => line.startsWith("CREATE INDEX")),
    ).toEqual([
      "CREATE INDEX IF NOT EXISTS ON `entry` (`slug_key`) UNIQUE;",
      "CREATE INDEX IF NOT EXISTS ON `entry` (`search`) NOTUNIQUE;",
      "CREATE INDEX IF NOT EXISTS ON `entry` (`owner_id`) NOTUNIQUE;",
      "CREATE INDEX IF NOT EXISTS ON `entry` (`id`) UNIQUE;",
      "CREATE INDEX `entry_identity` IF NOT EXISTS ON `entry` (`id`, `slug_key`) NOTUNIQUE;",
    ]);
  });

  it.each<[DBFieldAttribute["type"], string]>([
    ["string", "STRING"],
    ["number", "DOUBLE"],
    ["boolean", "BOOLEAN"],
    ["date", "STRING"],
    ["json", "STRING"],
    ["string[]", "LIST"],
    ["number[]", "LIST"],
    [["draft", "published"], "STRING"],
  ])("maps %j to %s", (type, expected) => {
    expect(
      generateSchema(
        { entry: { modelName: "entry", fields: { value: { type } } } },
        (model) => model,
      ),
    ).toContain(
      `CREATE PROPERTY \`entry\`.\`value\` IF NOT EXISTS ${expected};`,
    );
  });

  it("rejects unknown index fields with schema context", () => {
    const tables: BetterAuthDBSchema = {
      entry: {
        modelName: "entry",
        fields: {},
        indexes: [{ fields: ["missing"] }],
      },
    };
    expect(() => generateSchema(tables, (model) => model)).toThrow(
      "Unknown index field `entry`.missing",
    );
  });

  it("maps table-level indexes to custom plural models and physical fields", async () => {
    const adapter = arcadeDBAdapter(db, { usePlural: true })({
      plugins: [
        {
          id: "indexed-model",
          schema: {
            entry: {
              modelName: "record",
              fields: {
                owner: { type: "string", fieldName: "owner_id" },
                key: { type: "string", fieldName: "entry_key" },
              },
              indexes: [
                { name: "entry_pair", fields: ["owner", "key"], unique: true },
                { fields: ["key", "owner"] },
              ],
            },
          },
        },
      ],
    });
    const schema = await adapter.createSchema!({});
    expect(schema.code).toContain(
      "CREATE INDEX `entry_pair` IF NOT EXISTS ON `records` (`owner_id`, `entry_key`) UNIQUE;",
    );
    expect(schema.code).toContain(
      "CREATE INDEX IF NOT EXISTS ON `records` (`entry_key`, `owner_id`) NOTUNIQUE;",
    );
  });
});
