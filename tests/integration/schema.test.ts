import type { BetterAuthOptions } from "better-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database, migrate, server } from "./helpers.js";

const options: BetterAuthOptions = {
  plugins: [
    {
      id: "schema-test",
      schema: {
        entry: {
          modelName: "record",
          fields: {
            owner: { type: "string", fieldName: "owner_id" },
            key: { type: "string", fieldName: "entry_key" },
            label: { type: "string" },
            count: { type: "number", required: false },
            enabled: { type: "boolean", required: false },
            created: { type: "date", required: false },
            payload: { type: "json", required: false },
            tags: { type: "string[]", required: false },
            scores: { type: "number[]", required: false },
            state: { type: ["draft", "published"], required: false },
          },
          indexes: [
            { name: "entry_pair", fields: ["owner", "key"], unique: true },
            { fields: ["label", "owner"] },
          ],
        },
        external: {
          modelName: "managed_elsewhere",
          disableMigration: true,
          fields: { value: { type: "string", unique: true } },
          indexes: [{ name: "external_value", fields: ["value"] }],
        },
      },
    },
  ],
};

interface SchemaType {
  name: string;
  properties: { name: string; type: string }[];
  indexes: { name: string; properties: string[]; unique: boolean }[];
}

describe.each([false, true])("schema (usePlural=%s)", (usePlural) => {
  let db: Awaited<ReturnType<typeof database>>;
  let adapter: Awaited<ReturnType<typeof migrate>>;
  const model = usePlural ? "records" : "record";

  beforeAll(async () => {
    db = await database("schema");
    adapter = await migrate(db, options, usePlural);
  });
  afterAll(async () => {
    if (db) await server.dropDatabase(db.name);
  });

  it("reapplies named and unnamed indexes on populated custom models and skips external models", async () => {
    await adapter.create({
      model: "entry",
      data: { owner: "alice", key: "shared", label: "repeat" },
    });
    await adapter.create({
      model: "entry",
      data: { owner: "alice", key: "other", label: "repeat" },
    });
    await adapter.create({
      model: "entry",
      data: { owner: "bob", key: "shared", label: "repeat" },
    });
    const metadata = () =>
      db.query<SchemaType>({
        language: "sql",
        command: "SELECT FROM schema:types",
        limit: -1,
      });
    const before = (await metadata()).result;
    await migrate(db, options, usePlural);
    const after = (await metadata()).result;
    const indexed = after.find((type) => type.name === model)!;
    expect(indexed.indexes).toEqual(
      before.find((type) => type.name === model)?.indexes,
    );
    expect(indexed.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "entry_pair",
          properties: ["owner_id", "entry_key"],
          unique: true,
        }),
        expect.objectContaining({
          name: `${model}[label,owner_id]`,
          properties: ["label", "owner_id"],
          unique: false,
        }),
      ]),
    );
    expect(after.map((type) => type.name)).not.toContain(
      usePlural ? "managed_elsewheres" : "managed_elsewhere",
    );
    await expect(
      adapter.create({
        model: "entry",
        data: { owner: "alice", key: "shared", label: "different" },
      }),
    ).rejects.toMatchObject({
      exception: expect.stringContaining("DuplicatedKeyException"),
    });
    expect(
      await adapter.count({
        model: "entry",
        where: [{ field: "label", value: "repeat" }],
      }),
    ).toBe(3);
  });

  it("creates compatible physical types and round-trips every supported field type", async () => {
    const { result } = await db.query<SchemaType>({
      language: "sql",
      command: "SELECT FROM schema:types WHERE name = :name",
      params: { name: model },
    });
    expect(
      Object.fromEntries(
        result[0]!.properties.map((property) => [property.name, property.type]),
      ),
    ).toEqual({
      id: "STRING",
      owner_id: "STRING",
      entry_key: "STRING",
      label: "STRING",
      count: "DOUBLE",
      enabled: "BOOLEAN",
      created: "STRING",
      payload: "STRING",
      tags: "LIST",
      scores: "LIST",
      state: "STRING",
    });
    const data = {
      owner: "typed",
      key: "values",
      label: "types",
      count: 1.25,
      enabled: false,
      created: new Date("2026-01-02T03:04:05.000Z"),
      payload: { nested: [1, null, { active: true }] },
      tags: ["one", "two"],
      scores: [1, 2.5],
      state: "draft",
    };
    const row = await adapter.create<{ id: string }>({ model: "entry", data });
    expect(
      await adapter.findOne({
        model: "entry",
        where: [{ field: "id", value: row.id }],
      }),
    ).toEqual({ ...data, id: row.id });
  });
});
