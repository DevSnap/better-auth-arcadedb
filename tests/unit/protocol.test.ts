import { basicAuth, createClient } from "@arcadedb/driver";
import type { DBAdapter } from "better-auth/adapters";
import { describe, expect, it } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";

function adapterFor(result: unknown[], truncated = false) {
  const db = createClient({
    baseUrl: "http://arcadedb.test",
    auth: basicAuth("test", "test"),
    fetch: async () =>
      new Response(
        JSON.stringify({
          result,
          truncated,
          limit: 1,
          returned: result.length,
        }),
        { headers: { "content-type": "application/json" } },
      ),
  }).db("test");
  return arcadeDBAdapter(db)({
    user: { additionalFields: { remaining: { type: "number" } } },
  });
}

describe("driver response contract", () => {
  it.each([
    {
      name: "findOne",
      run: (db: DBAdapter) =>
        db.findOne({ model: "user", where: [{ field: "id", value: "1" }] }),
    },
    {
      name: "findMany",
      run: (db: DBAdapter) => db.findMany({ model: "user" }),
    },
    {
      name: "update",
      run: (db: DBAdapter) =>
        db.update({
          model: "user",
          where: [{ field: "id", value: "1" }],
          update: { name: "updated" },
        }),
    },
    {
      name: "consumeOne",
      run: (db: DBAdapter) =>
        db.consumeOne({ model: "user", where: [{ field: "id", value: "1" }] }),
    },
    {
      name: "incrementOne",
      run: (db: DBAdapter) =>
        db.incrementOne({
          model: "user",
          where: [{ field: "id", value: "1" }],
          increment: { remaining: 1 },
        }),
    },
    { name: "count", run: (db: DBAdapter) => db.count({ model: "user" }) },
    {
      name: "deleteMany",
      run: (db: DBAdapter) => db.deleteMany({ model: "user", where: [] }),
    },
  ])(
    "rejects a truncated $name result instead of accepting a partial answer",
    async ({ run }) => {
      await expect(
        run(adapterFor([{ id: "1", count: 1 }], true)),
      ).rejects.toThrow("truncated");
    },
  );
  it.each([undefined, "1", -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects the invalid affected-row count %s",
    async (count) => {
      await expect(
        adapterFor([{ count }]).deleteMany({ model: "user", where: [] }),
      ).rejects.toThrow("exact affected-row count");
    },
  );
  it.each([0, 2])("returns the exact affected-row count %i", async (count) => {
    await expect(
      adapterFor([{ count }]).deleteMany({ model: "user", where: [] }),
    ).resolves.toBe(count);
  });
  it("removes ArcadeDB metadata from atomic results", async () => {
    await expect(
      adapterFor([
        { id: "1", name: "Ada", "@rid": "#1:0", "@type": "d", "@version": 3 },
      ]).consumeOne({ model: "user", where: [{ field: "id", value: "1" }] }),
    ).resolves.toEqual({ id: "1", name: "Ada" });
  });
  it("returns null when an atomic consume matches no row", async () => {
    await expect(
      adapterFor([]).consumeOne({
        model: "user",
        where: [{ field: "id", value: "missing" }],
      }),
    ).resolves.toBeNull();
  });
  it("propagates driver failures", async () => {
    const db = createClient({
      baseUrl: "http://arcadedb.test",
      fetch: async () =>
        new Response(JSON.stringify({ error: "Security error" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    }).db("test");
    await expect(
      arcadeDBAdapter(db)({}).findMany({ model: "user" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
