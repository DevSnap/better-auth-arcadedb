import type { BetterAuthOptions } from "better-auth";
import type { Where } from "better-auth/adapters";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { database, migrate, server } from "./helpers.js";

const options: BetterAuthOptions = {
  plugins: [
    {
      id: "json-test",
      schema: {
        entry: {
          modelName: "json_entry",
          fields: {
            name: { type: "string", unique: true },
            payload: {
              type: "json",
              fieldName: "json_payload",
              required: false,
            },
            remaining: { type: "number", required: false },
          },
        },
      },
    },
  ],
};
const values = [
  "hello",
  "",
  42,
  0,
  false,
  true,
  [1, { nested: true }],
  { a: [null] },
];
// Better Auth's Where type does not yet include JSON objects or nested arrays.
const where = (value: unknown, operator: Where["operator"] = "eq"): Where[] => [
  { field: "payload", value: value as Where["value"], operator },
];
const db = await database("json");
let adapter: Awaited<ReturnType<typeof migrate>>;
beforeAll(async () => {
  adapter = await migrate(db, options, true);
  for (const [index, payload] of [...values, null].entries()) {
    await adapter.create({
      model: "entry",
      data: { name: `value-${index}`, payload },
    });
  }
});
afterAll(() => server.dropDatabase(db.name));

describe("JSON equality and membership on ArcadeDB", () => {
  it.each(values.map((value, index) => ({ value, index })))(
    "round-trips and compares $value with eq/ne",
    async ({ value, index }) => {
      const row = await adapter.findOne<{ name: string; payload: unknown }>({
        model: "entry",
        where: where(value),
      });
      expect(row).toMatchObject({ name: `value-${index}`, payload: value });
      const different = await adapter.findMany<{ name: string }>({
        model: "entry",
        where: where(value, "ne"),
      });
      expect(different.length).toBeGreaterThan(0);
      expect(different.map((entry) => entry.name)).not.toContain(
        `value-${index}`,
      );
    },
  );

  it("matches each mixed JSON candidate without serializing the outer list", async () => {
    const candidates = [values[0], values[2], values[4], values[6], values[7]];
    const names = [0, 2, 4, 6, 7].map((index) => `value-${index}`).sort();
    const included = await adapter.findMany<{ name: string; payload: unknown }>(
      {
        model: "entry",
        where: where(candidates, "in"),
      },
    );
    expect(included.map((entry) => entry.name).sort()).toEqual(names);
    for (const entry of included) {
      expect(candidates).toContainEqual(entry.payload);
    }
    const excluded = await adapter.findMany<{ name: string }>({
      model: "entry",
      where: where(candidates, "not_in"),
    });
    expect(excluded.length).toBeGreaterThan(0);
    for (const entry of excluded) expect(names).not.toContain(entry.name);
    expect(
      await adapter.count({ model: "entry", where: where(candidates, "in") }),
    ).toBe(5);
  });

  it("preserves null and empty membership behavior", async () => {
    expect(
      await adapter.findOne<{ payload: unknown }>({
        model: "entry",
        where: where(null),
      }),
    ).toMatchObject({ payload: null });
    expect(
      await adapter.count({ model: "entry", where: where(null, "ne") }),
    ).toBe(values.length);
    expect(
      await adapter.findMany({ model: "entry", where: where([], "in") }),
    ).toEqual([]);
    expect(
      await adapter.count({ model: "entry", where: where([], "not_in") }),
    ).toBe(values.length + 1);
    expect(
      await adapter.count({
        model: "entry",
        where: where([null, "hello"], "in"),
      }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("encodes update assignments and incrementOne.set using custom field names", async () => {
    const selector = [{ field: "name", value: "mutations" }];
    await adapter.create({
      model: "entry",
      data: { name: "mutations", payload: "initial", remaining: 0 },
    });
    expect(
      await adapter.update<{ payload: unknown }>({
        model: "entry",
        where: selector,
        update: { payload: [1, 2] },
      }),
    ).toMatchObject({ payload: [1, 2] });
    expect(
      await adapter.updateMany({
        model: "entry",
        where: where([[1, 2]], "in"),
        update: { payload: { updated: true } },
      }),
    ).toBe(1);
    expect(
      await adapter.incrementOne<{ payload: unknown; remaining: number }>({
        model: "entry",
        where: where([{ updated: true }], "in"),
        increment: { remaining: 1 },
        set: { payload: false },
      }),
    ).toMatchObject({ payload: false, remaining: 1 });
    expect(
      await adapter.consumeOne<{ name: string; payload: unknown }>({
        model: "entry",
        where: [...selector, ...where([false], "in")],
      }),
    ).toMatchObject({ name: "mutations", payload: false });
  });
});
