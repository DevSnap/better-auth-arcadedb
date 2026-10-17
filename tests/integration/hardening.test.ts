import type { BetterAuthOptions } from "better-auth";
import { describe, expect, it } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";
import { serialCounter } from "../../src/serial.js";
import { database, migrate, server } from "./helpers.js";

const serialOptions: BetterAuthOptions = {
  advanced: { database: { generateId: "serial" } },
  plugins: [
    {
      id: "hardening",
      schema: {
        entry: {
          fields: {
            name: { type: "string", unique: true },
            owner: {
              type: "string",
              fieldName: "owner_id",
              required: false,
              references: { model: "user", field: "id" },
            },
            amount: { type: "number", required: false },
          },
        },
      },
    },
  ],
};

async function isolated(
  options: BetterAuthOptions,
  run: (
    adapter: Awaited<ReturnType<typeof migrate>>,
    db: Awaited<ReturnType<typeof database>>,
  ) => Promise<void>,
  plural = false,
) {
  const db = await database("hardening");
  try {
    await run(await migrate(db, options, plural), db);
  } finally {
    await server.dropDatabase(db.name);
  }
}

describe.each([false, true])("canonical metadata (plural=%s)", (plural) => {
  it.each([false, true])(
    "handles swapped models and physical fields (serial=%s)",
    async (serial) => {
      const options: BetterAuthOptions = {
        ...(serial
          ? { advanced: { database: { generateId: "serial" as const } } }
          : {}),
        plugins: [
          {
            id: "swapped",
            schema: {
              first: {
                modelName: "second",
                fields: {
                  payload: { type: "json", fieldName: "label" },
                  label: { type: "string", fieldName: "payload" },
                  amount: { type: "number" },
                },
              },
              second: {
                modelName: "first",
                fields: { label: { type: "string" } },
              },
            },
          },
        ],
      };
      await isolated(
        options,
        async (adapter) => {
          const payload = { nested: [1, "two"] };
          const row = await adapter.create<{ id: string }>({
            model: "first",
            data: { payload, label: "text", amount: 1 },
          });
          await adapter.create({ model: "second", data: { label: "other" } });
          const where = [{ field: "payload", value: payload as never }];
          expect(
            await adapter.findOne({ model: "first", where }),
          ).toMatchObject({ payload, label: "text" });
          expect(await adapter.count({ model: "first", where })).toBe(1);
          expect(
            await adapter.findMany({
              model: "first",
              where,
              select: ["payload"],
              sortBy: { field: "label", direction: "asc" },
            }),
          ).toEqual([{ payload }]);
          await adapter.update({
            model: "first",
            where,
            update: { payload: { next: true } },
          });
          const id = [{ field: "id", value: row.id }];
          await adapter.updateMany({
            model: "first",
            where: id,
            update: { payload },
          });
          expect(
            await adapter.incrementOne({
              model: "first",
              where,
              increment: { amount: 0.5 },
            }),
          ).toMatchObject({ amount: 1.5, payload });
          expect(
            await adapter.consumeOne({ model: "first", where }),
          ).toMatchObject({ payload });
          await adapter.create({
            model: "first",
            data: { payload, label: "delete" },
          });
          await adapter.delete({ model: "first", where });
          await adapter.create({
            model: "first",
            data: { payload, label: "bulk" },
          });
          expect(await adapter.deleteMany({ model: "first", where })).toBe(1);
          expect(await adapter.count({ model: "second" })).toBe(1);
        },
        plural,
      );
    },
  );
});

describe("serial hardening", () => {
  it("rejects missing and corrupt counters without inserting or repairing them implicitly", async () => {
    await isolated(serialOptions, async (adapter, db) => {
      for (const value of [-1, null]) {
        await db.command({
          language: "sql",
          command: `UPDATE \`${serialCounter}\` SET value = :value WHERE model = 'entry'`,
          params: { value },
        });
        await expect(
          adapter.create({ model: "entry", data: { name: "corrupt" } }),
        ).rejects.toThrow("invalid");
        await expect(
          adapter.create({
            model: "entry",
            data: { id: "100", name: "explicit" },
            forceAllowId: true,
          }),
        ).rejects.toThrow("invalid");
        expect(await adapter.count({ model: "entry" })).toBe(0);
      }
      await db.command({
        language: "sql",
        command: `DELETE FROM \`${serialCounter}\` WHERE model = 'entry'`,
      });
      await expect(
        adapter.create({ model: "entry", data: { name: "missing" } }),
      ).rejects.toThrow("missing");
      expect(await adapter.count({ model: "entry" })).toBe(0);
    });
  });

  it("preserves null versus zero predicates across reads, writes and concurrent invocations", async () => {
    await isolated(serialOptions, async (adapter, db) => {
      await adapter.create({
        model: "entry",
        data: { name: "null", owner: null },
      });
      await adapter.create({ model: "entry", data: { name: "missing" } });
      await adapter.create({
        model: "entry",
        data: { name: "zero", owner: 0 },
      });
      const where = [{ field: "owner", value: null }];
      expect(await adapter.count({ model: "entry", where })).toBe(2);
      expect(
        await adapter.count({
          model: "entry",
          where: [{ field: "owner", value: null, operator: "ne" }],
        }),
      ).toBe(1);
      expect(
        await adapter.count({
          model: "entry",
          where: [{ field: "owner", value: [0], operator: "in" }],
        }),
      ).toBe(1);
      expect(
        await adapter.count({
          model: "entry",
          where: [{ field: "owner", value: [99], operator: "not_in" }],
        }),
      ).toBe(1);
      expect(await adapter.findMany({ model: "entry", where })).toHaveLength(2);
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          adapter.count({
            model: "entry",
            where: [{ field: "owner", value: i % 2 ? 0 : null }],
          }),
        ),
      );
      expect(results).toEqual(
        Array.from({ length: 12 }, (_, i) => (i % 2 ? 1 : 2)),
      );
      expect(
        await adapter.updateMany({
          model: "entry",
          where,
          update: { amount: 2 },
        }),
      ).toBe(2);
      expect(
        await adapter.incrementOne({
          model: "entry",
          where,
          increment: { amount: 0.5 },
        }),
      ).toMatchObject({ amount: 2.5 });
      expect(
        await adapter.update({ model: "entry", where, update: { amount: 4 } }),
      ).toMatchObject({ amount: 4 });
      await adapter.transaction(async (tx) => {
        expect(await tx.count({ model: "entry", where })).toBe(2);
      });
      const other = arcadeDBAdapter(db)(serialOptions);
      expect(
        await other.consumeOne({ model: "entry", where }),
      ).not.toMatchObject({ name: "zero" });
      await adapter.delete({ model: "entry", where });
      expect(await adapter.deleteMany({ model: "entry", where })).toBe(0);
      expect(
        await adapter.findOne({
          model: "entry",
          where: [{ field: "owner", value: 0 }],
        }),
      ).toMatchObject({ name: "zero" });
    });
  });

  it("rejects ID mutations and reference increments while allowing reference reassignment", async () => {
    await isolated(serialOptions, async (adapter) => {
      const row = await adapter.create<{ id: string }>({
        model: "entry",
        data: { name: "original", amount: 1 },
      });
      const where = [{ field: "id", value: row.id }];
      for (const update of [{ id: "500" }, { id: null }]) {
        await expect(
          adapter.update({ model: "entry", where, update }),
        ).rejects.toThrow("immutable");
        await expect(
          adapter.updateMany({ model: "entry", where, update }),
        ).rejects.toThrow("immutable");
        await expect(
          adapter.incrementOne({
            model: "entry",
            where,
            increment: {},
            set: update,
          }),
        ).rejects.toThrow("immutable");
      }
      for (const field of ["id", "owner"])
        await expect(
          adapter.incrementOne({
            model: "entry",
            where,
            increment: { [field]: 1 },
          }),
        ).rejects.toThrow("Cannot increment");
      expect(
        await adapter.update({ model: "entry", where, update: { owner: "3" } }),
      ).toMatchObject({ id: row.id, owner: "3" });
      expect(
        await adapter.incrementOne({
          model: "entry",
          where,
          increment: { amount: 0.25 },
          set: { owner: null },
        }),
      ).toMatchObject({ amount: 1.25, owner: null });
      expect(
        (
          await adapter.create<{ id: string }>({
            model: "entry",
            data: { name: "next" },
          })
        ).id,
      ).toBe("2");
    });
  });

  it("mixes explicit and automatic allocations without partial commits", async () => {
    await isolated(serialOptions, async (adapter, db) => {
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, (_, i) =>
          adapter.create<{ id: string }>({
            model: "entry",
            data: {
              name: `mixed-${i}`,
              ...(i === 3 ? { id: "1000" } : i === 7 ? { id: "-5" } : {}),
            },
            forceAllowId: i === 3 || i === 7,
          }),
        ),
      );
      expect(results.every((result) => result.status === "fulfilled")).toBe(
        true,
      );
      const ids = results.flatMap((result) =>
        result.status === "fulfilled" ? [Number(result.value.id)] : [],
      );
      expect(new Set(ids).size).toBe(12);
      expect(await adapter.count({ model: "entry" })).toBe(12);
      const counter = await db.query<{ value: number }>({
        language: "sql",
        command: `SELECT value FROM \`${serialCounter}\` WHERE model = 'entry'`,
      });
      expect(counter.result[0]!.value).toBe(Math.max(...ids));
      await expect(
        adapter.transaction(async (tx) => {
          await tx.create({ model: "entry", data: { name: "partial" } });
          await tx.create({ model: "entry", data: { name: "mixed-0" } });
        }),
      ).rejects.toThrow();
      expect(
        await adapter.count({
          model: "entry",
          where: [{ field: "name", value: "partial" }],
        }),
      ).toBe(0);
      expect(
        Number(
          (
            await adapter.create<{ id: string }>({
              model: "entry",
              data: { name: "after" },
            })
          ).id,
        ),
      ).toBe(Math.max(...ids) + 1);
    });
  });

  it("propagates a real transaction conflict without replay or partial writes", async () => {
    await isolated(serialOptions, async (adapter) => {
      const deferred = () => {
        let resolve!: () => void;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        return { promise, resolve };
      };
      const allocated = deferred();
      const release = deferred();
      let calls = 0;
      const first = adapter.transaction(async (tx) => {
        calls++;
        try {
          await tx.create({ model: "entry", data: { name: "loser" } });
        } finally {
          allocated.resolve();
        }
        await release.promise;
      });
      const observed = first.then(
        () => null,
        (error) => error,
      );
      try {
        await allocated.promise;
        await adapter.create({ model: "entry", data: { name: "winner" } });
      } finally {
        release.resolve();
      }
      expect(await observed).toBeInstanceOf(Error);
      expect(calls).toBe(1);
      expect(await adapter.count({ model: "entry" })).toBe(1);
      expect(
        await adapter.findOne({
          model: "entry",
          where: [{ field: "name", value: "loser" }],
        }),
      ).toBeNull();
      expect(
        (
          await adapter.create<{ id: string }>({
            model: "entry",
            data: { name: "next" },
          })
        ).id,
      ).toBe("2");
    });
  });

  it("commits one explicit duplicate and rolls back the other attempt", async () => {
    await isolated(serialOptions, async (adapter) => {
      const results = await Promise.allSettled(
        ["one", "two"].map((name) =>
          adapter.create({
            model: "entry",
            data: { id: "500", name },
            forceAllowId: true,
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(await adapter.count({ model: "entry" })).toBe(1);
      expect(
        (
          await adapter.create<{ id: string }>({
            model: "entry",
            data: { name: "next" },
          })
        ).id,
      ).toBe("501");
    });
  });
});
