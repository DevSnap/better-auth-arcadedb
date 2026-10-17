import { createClient } from "@arcadedb/driver";
import type { BetterAuthOptions } from "better-auth";
import type { DBAdapter, Where } from "better-auth/adapters";
import { describe, expect, it } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";

const options: BetterAuthOptions = {
  plugins: [
    {
      id: "json-test",
      schema: {
        entry: {
          modelName: "json_entry",
          fields: {
            payload: {
              type: "json",
              fieldName: "json_payload",
              required: false,
            },
            remaining: { type: "number" },
            tags: { type: "string[]", required: false },
          },
        },
      },
    },
  ],
};

// Better Auth's Where type does not yet include JSON objects or nested arrays.
const where = (value: unknown, operator: Where["operator"] = "eq"): Where[] => [
  { field: "payload", value: value as Where["value"], operator },
];

function fixture(result: unknown[] = []) {
  const requests: { command: string; params: Record<string, unknown> }[] = [];
  const db = createClient({
    baseUrl: "http://arcadedb.test",
    fetch: async (input, init) => {
      requests.push(await new Request(input, init).json());
      return new Response(JSON.stringify({ result }), {
        headers: { "content-type": "application/json" },
      });
    },
  }).db("test");
  return {
    adapter: arcadeDBAdapter(db, { usePlural: true })(options),
    requests,
  };
}

describe("JSON bindings through the public adapter", () => {
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

  it.each(values.map((value) => ({ value })))(
    "encodes and decodes $value once for create, eq and ne",
    async ({ value }) => {
      const encoded = JSON.stringify(value);
      const { adapter, requests } = fixture([
        { id: "one", json_payload: encoded, remaining: 2 },
      ]);
      expect(
        await adapter.create<{
          payload: unknown;
          remaining: number;
          tags: string[];
        }>({
          model: "entry",
          data: { payload: value, remaining: 2, tags: ["a", "b"] },
        }),
      ).toMatchObject({ payload: value });
      expect(requests[0]).toMatchObject({
        params: { p0: encoded, p1: 2, p2: ["a", "b"] },
      });
      expect(requests[0]?.command).toContain("INSERT INTO `json_entrys`");
      for (const operator of ["eq", "ne"] as const) {
        expect(
          await adapter.findOne<{ payload: unknown }>({
            model: "entry",
            where: where(value, operator),
          }),
        ).toMatchObject({ payload: value });
        expect(requests.at(-1)).toMatchObject({ params: { p0: encoded } });
        expect(requests.at(-1)?.command).toContain(
          `\`json_payload\` ${operator === "eq" ? "=" : "<>"} :p0`,
        );
      }
    },
  );

  it.each(["in", "not_in"] as const)(
    "%s encodes individual scalar, array, object and null candidates",
    async (operator) => {
      const { adapter, requests } = fixture();
      const candidates = [...values, null];
      await adapter.findMany({
        model: "entry",
        where: where(candidates, operator),
      });
      expect(requests[0]?.params).toEqual({
        p0: candidates.map((value) =>
          value === null ? null : JSON.stringify(value),
        ),
      });
      expect(requests[0]?.command).toContain(
        `\`json_payload\` ${operator === "in" ? "IN" : "NOT IN"} :p0`,
      );
    },
  );

  it("preserves SQL null and empty membership semantics", async () => {
    const { adapter, requests } = fixture([{ id: "one", json_payload: null }]);
    expect(
      await adapter.create<{ payload: unknown }>({
        model: "entry",
        data: { payload: null },
      }),
    ).toMatchObject({ payload: null });
    expect(requests[0]?.params.p0).toBeNull();
    for (const [operator, value, expression] of [
      ["eq", null, "`json_payload` IS NULL"],
      ["ne", null, "`json_payload` IS NOT NULL"],
      ["in", [], "1 = 0"],
      ["not_in", [], "1 = 1"],
    ] as const) {
      await adapter.findMany({ model: "entry", where: where(value, operator) });
      expect(requests.at(-1)?.command).toContain(expression);
      expect(requests.at(-1)?.params).toEqual({});
    }
  });

  it.each([
    {
      name: "count",
      run: (db: DBAdapter) =>
        db.count({ model: "entry", where: where([false, { a: 1 }], "in") }),
    },
    {
      name: "update",
      run: (db: DBAdapter) =>
        db.update({
          model: "entry",
          where: where([false, { a: 1 }], "in"),
          update: { payload: [2, 3] },
        }),
    },
    {
      name: "updateMany",
      run: (db: DBAdapter) =>
        db.updateMany({
          model: "entry",
          where: where([false, { a: 1 }], "in"),
          update: { payload: [2, 3] },
        }),
    },
    {
      name: "delete",
      run: (db: DBAdapter) =>
        db.delete({ model: "entry", where: where([false, { a: 1 }], "in") }),
    },
    {
      name: "deleteMany",
      run: (db: DBAdapter) =>
        db.deleteMany({
          model: "entry",
          where: where([false, { a: 1 }], "in"),
        }),
    },
    {
      name: "consumeOne",
      run: (db: DBAdapter) =>
        db.consumeOne({
          model: "entry",
          where: where([false, { a: 1 }], "in"),
        }),
    },
    {
      name: "incrementOne",
      run: (db: DBAdapter) =>
        db.incrementOne({
          model: "entry",
          where: where([false, { a: 1 }], "in"),
          increment: { remaining: 1 },
          set: { payload: [2, 3] },
        }),
    },
  ])("encodes JSON in $name", async ({ run, name }) => {
    const { adapter, requests } = fixture([
      { count: 1, json_payload: "[2,3]" },
    ]);
    await run(adapter);
    const request = requests[0]!;
    expect(Object.values(request.params)).toContainEqual(["false", '{"a":1}']);
    if (["update", "updateMany", "incrementOne"].includes(name)) {
      expect(request.params.p0).toBe("[2,3]");
      expect(request.command).toContain("SET `json_payload` = :p0");
    }
    if (name === "incrementOne") expect(request.params.p1).toBe(1);
  });
});
