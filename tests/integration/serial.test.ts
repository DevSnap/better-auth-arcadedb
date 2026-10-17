import type { BetterAuthOptions } from "better-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";
import { serialCounter } from "../../src/serial.js";
import { database, migrate, server } from "./helpers.js";

const options: BetterAuthOptions = {
  advanced: { database: { generateId: "serial" } },
  plugins: [
    {
      id: "serial-test",
      schema: {
        entry: {
          modelName: "serial-entry",
          fields: {
            name: { type: "string", unique: true },
            owner: {
              type: "string",
              fieldName: "owner_id",
              required: false,
              references: { model: "user", field: "id" },
            },
          },
        },
        empty: { fields: {} },
        quoted: {
          modelName: "quoted'\\model",
          fields: { name: { type: "string", fieldName: "a'b\\c" } },
        },
      },
    },
  ],
};
let db: Awaited<ReturnType<typeof database>>;
let adapter: Awaited<ReturnType<typeof migrate>>;
beforeEach(async () => {
  db = await database("serial");
  adapter = await migrate(db, options, true);
});
afterEach(async () => {
  if (db) await server.dropDatabase(db.name);
});

describe("serial IDs", () => {
  it("stores integers, returns strings, supports references and independent models", async () => {
    const user = await adapter.create<{ id: string }>({
      model: "user",
      data: {
        name: "serial",
        email: "serial@example.com",
        emailVerified: false,
      },
    });
    const entry = await adapter.create<{
      id: string;
      name: string;
      owner: string;
    }>({ model: "entry", data: { name: "first", owner: user.id } });
    expect(user.id).toBe("1");
    expect(entry).toEqual({ id: "1", name: "first", owner: user.id });
    const raw = await db.query({
      language: "sql",
      command: "SELECT FROM `serial-entrys`",
    });
    expect(raw.result[0]).toMatchObject({ id: 1, owner_id: 1 });
    expect(
      await adapter.findOne({
        model: "entry",
        where: [{ field: "owner", value: user.id }],
      }),
    ).toEqual(entry);
    expect(await adapter.create({ model: "empty", data: {} })).toEqual({
      id: "1",
    });
  });

  it("allocates unique IDs concurrently across adapter instances", async () => {
    const other = arcadeDBAdapter(server.db(db.name), { usePlural: true })(
      options,
    );
    const results = await Promise.allSettled(
      Array.from({ length: 16 }, (_, i) =>
        (i % 2 ? other : adapter).create<{ id: string }>({
          model: "entry",
          data: { name: `parallel-${i}` },
        }),
      ),
    );
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const created = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    expect(new Set(created.map((row) => row.id)).size).toBe(16);
    expect(await adapter.count({ model: "entry" })).toBe(16);
    const counter = await db.query<{ value: number }>({
      language: "sql",
      command: `SELECT value FROM \`${serialCounter}\` WHERE model = :model`,
      params: { model: "serial-entrys" },
    });
    expect(counter.result[0]!.value).toBe(
      Math.max(...created.map((row) => Number(row.id))),
    );
    expect(
      (
        await adapter.create<{ id: string }>({
          model: "entry",
          data: { name: "after-parallel" },
        })
      ).id,
    ).toBe(String(counter.result[0]!.value + 1));
  });

  it("round-trips quotes and backslashes in model and field names", async () => {
    const row = await adapter.create({
      model: "quoted",
      data: { name: "quoted" },
    });
    await migrate(db, options, true);
    expect(
      await adapter.findOne({
        model: "quoted",
        where: [{ field: "id", value: "1" }],
      }),
    ).toEqual(row);
  });

  it("preserves explicit IDs and advances the counter without resetting on schema reapplication", async () => {
    const explicit = await adapter.create<{ id: string }>({
      model: "entry",
      data: { id: "100", name: "explicit" },
      forceAllowId: true,
    });
    expect(explicit.id).toBe("100");
    await migrate(db, options, true);
    expect(
      (
        await adapter.create<{ id: string }>({
          model: "entry",
          data: { name: "after-schema" },
        })
      ).id,
    ).toBe("101");
    await adapter.create({
      model: "entry",
      data: { id: "50", name: "lower-explicit" },
      forceAllowId: true,
    });
    await expect(
      adapter.create({
        model: "entry",
        data: { id: "100", name: "duplicate" },
        forceAllowId: true,
      }),
    ).rejects.toThrow();
  });

  it("does not reuse committed IDs after deletion", async () => {
    const row = await adapter.create<{ id: string }>({
      model: "entry",
      data: { name: "delete-id" },
    });
    await adapter.delete({
      model: "entry",
      where: [{ field: "id", value: row.id }],
    });
    const next = await adapter.create<{ id: string }>({
      model: "entry",
      data: { name: "after-delete" },
    });
    expect(Number(next.id)).toBeGreaterThan(Number(row.id));
  });

  it("rolls back allocation and document together and commits references", async () => {
    let rolledBackId: string | undefined;
    await expect(
      adapter.transaction(async (tx) => {
        rolledBackId = (
          await tx.create<{ id: string }>({
            model: "entry",
            data: { name: "rollback" },
          })
        ).id;
        throw new Error("rollback requested");
      }),
    ).rejects.toThrow("rollback requested");
    expect(
      await adapter.count({
        model: "entry",
        where: [{ field: "name", value: "rollback" }],
      }),
    ).toBe(0);
    expect(
      (
        await adapter.create<{ id: string }>({
          model: "entry",
          data: { name: "after-rollback" },
        })
      ).id,
    ).toBe(rolledBackId);
    await adapter.transaction(async (tx) => {
      const user = await tx.create<{ id: string }>({
        model: "user",
        data: { name: "tx", email: "tx@example.com" },
      });
      const entry = await tx.create<{ name: string; owner: string }>({
        model: "entry",
        data: { name: "tx-entry", owner: user.id },
      });
      expect(entry.owner).toBe(user.id);
    });
  });

  it("rejects unsafe IDs and references and fails before committing exhausted allocations", async () => {
    for (const id of [1.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      await expect(
        adapter.create({
          model: "entry",
          data: { id, name: "invalid" },
          forceAllowId: true,
        }),
      ).rejects.toThrow("safe integers");
      await expect(
        adapter.findOne({
          model: "entry",
          where: [{ field: "id", value: id }],
        }),
      ).rejects.toThrow("safe integers");
      await expect(
        adapter.create({
          model: "entry",
          data: { name: "invalid-ref", owner: id },
        }),
      ).rejects.toThrow("safe integers");
    }
    await db.command({
      language: "sql",
      command: `UPDATE \`${serialCounter}\` SET value = :maximum WHERE model = :model`,
      params: { maximum: Number.MAX_SAFE_INTEGER - 1, model: "emptys" },
    });
    expect(await adapter.create({ model: "empty", data: {} })).toEqual({
      id: String(Number.MAX_SAFE_INTEGER),
    });
    await expect(adapter.create({ model: "empty", data: {} })).rejects.toThrow(
      "exhausted",
    );
    expect(await adapter.count({ model: "empty" })).toBe(1);
  });
});
