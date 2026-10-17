import type { BetterAuthOptions } from "better-auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database, migrate, server } from "./helpers.js";

const options: BetterAuthOptions = {
  plugins: [
    {
      id: "atomic-test",
      schema: {
        counter: {
          fields: {
            name: { type: "string", unique: true },
            remaining: { type: "number", required: false },
            payload: { type: "json", required: false },
          },
        },
      },
    },
  ],
};
const db = await database("atomic");
let adapter: Awaited<ReturnType<typeof migrate>>;
beforeAll(async () => {
  adapter = await migrate(db, options, true);
});
afterAll(() => server.dropDatabase(db.name));

describe("native atomic operations", () => {
  it("allows exactly one concurrent consumer and preserves other matching rows", async () => {
    const row = await adapter.create<{ name: string }>({
      model: "counter",
      data: { name: "consume" },
    });
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        adapter.consumeOne<{ id: string }>({
          model: "counter",
          where: [
            { field: "id", value: (row as unknown as { id: string }).id },
          ],
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    await adapter.create({
      model: "counter",
      data: { name: "consume-a", remaining: 7 },
    });
    await adapter.create({
      model: "counter",
      data: { name: "consume-b", remaining: 7 },
    });
    await adapter.consumeOne({
      model: "counter",
      where: [{ field: "remaining", value: 7 }],
    });
    expect(
      await adapter.count({
        model: "counter",
        where: [{ field: "remaining", value: 7 }],
      }),
    ).toBe(1);
  });
  it("enforces a counter guard under concurrent writes", async () => {
    await adapter.create({
      model: "counter",
      data: { name: "guard", remaining: 5 },
    });
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        adapter.incrementOne<{ remaining: number }>({
          model: "counter",
          where: [
            { field: "name", value: "guard" },
            { field: "remaining", operator: "gt", value: 0 },
          ],
          increment: { remaining: -1 },
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(
      (
        await adapter.findOne<{ remaining: number }>({
          model: "counter",
          where: [{ field: "name", value: "guard" }],
        })
      )?.remaining,
    ).toBe(0);
  });
  it("does not lose increments and initializes missing counters", async () => {
    await adapter.create({ model: "counter", data: { name: "increments" } });
    await Promise.all(
      Array.from({ length: 16 }, () =>
        adapter.incrementOne({
          model: "counter",
          where: [{ field: "name", value: "increments" }],
          increment: { remaining: 1 },
        }),
      ),
    );
    expect(
      (
        await adapter.findOne<{ remaining: number }>({
          model: "counter",
          where: [{ field: "name", value: "increments" }],
        })
      )?.remaining,
    ).toBe(16);
  });
  it("commits multiple writes and rolls back all writes on error", async () => {
    await adapter.transaction(async (tx) => {
      await tx.create({ model: "counter", data: { name: "commit" } });
    });
    await expect(
      adapter.transaction(async (tx) => {
        await tx.create({ model: "counter", data: { name: "rollback" } });
        await tx.incrementOne({
          model: "counter",
          where: [{ field: "name", value: "guard" }],
          increment: { remaining: 10 },
        });
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");
    expect(
      await adapter.count({
        model: "counter",
        where: [{ field: "name", value: "commit" }],
      }),
    ).toBe(1);
    expect(
      await adapter.count({
        model: "counter",
        where: [{ field: "name", value: "rollback" }],
      }),
    ).toBe(0);
    expect(
      (
        await adapter.findOne<{ remaining: number }>({
          model: "counter",
          where: [{ field: "name", value: "guard" }],
        })
      )?.remaining,
    ).toBe(0);
  });
  it("round-trips nested JSON, nulls and literal regex terminators", async () => {
    const payload = { list: [1, null, { enabled: true }], text: "test" };
    await adapter.create({
      model: "counter",
      data: { name: "a\\E.*%_", payload, remaining: null },
    });
    const row = await adapter.findOne<{
      payload: unknown;
      remaining: number | null;
    }>({
      model: "counter",
      where: [{ field: "name", operator: "contains", value: "\\E.*%_" }],
    });
    expect(row?.payload).toEqual(payload);
    expect(row?.remaining).toBeNull();
  });
  it("round-trips JSON arrays and scalar values", async () => {
    for (const [index, payload] of [
      [1, { active: true }],
      "hello",
      42,
      false,
    ].entries()) {
      const name = `json-${index}`;
      await adapter.create({ model: "counter", data: { name, payload } });
      expect(
        (
          await adapter.findOne<{ payload: unknown }>({
            model: "counter",
            where: [{ field: "name", value: name }],
          })
        )?.payload,
      ).toEqual(payload);
    }
  });
});
