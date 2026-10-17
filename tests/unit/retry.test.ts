import { createClient } from "@arcadedb/driver";
import type { DBAdapter } from "better-auth/adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";

const conflict = "com.arcadedb.exception.ConcurrentModificationException";
const row = { id: "user-1", name: "updated", remaining: 2 };
const where = [{ field: "id", value: row.id }];
const operations = [
  {
    name: "update",
    run: (adapter: DBAdapter) =>
      adapter.update({ model: "user", where, update: { name: row.name } }),
    command:
      "UPDATE `user` SET `name` = :p0, `updatedAt` = :p1 RETURN AFTER WHERE `id` = :p2 LIMIT 1",
    params: { p0: row.name, p1: "1970-01-01T00:00:00.000Z", p2: row.id },
  },
  {
    name: "consumeOne",
    run: (adapter: DBAdapter) => adapter.consumeOne({ model: "user", where }),
    command: "DELETE FROM `user` RETURN BEFORE WHERE `id` = :p0 LIMIT 1",
    params: { p0: row.id },
  },
  {
    name: "incrementOne",
    run: (adapter: DBAdapter) =>
      adapter.incrementOne({
        model: "user",
        where,
        increment: { remaining: -1 },
        set: { name: row.name },
      }),
    command:
      "UPDATE `user` SET `name` = :p0, `updatedAt` = :p1, `remaining` = ifnull(`remaining`, 0) + :p2 RETURN AFTER WHERE `id` = :p3 LIMIT 1",
    params: {
      p0: row.name,
      p1: "1970-01-01T00:00:00.000Z",
      p2: -1,
      p3: row.id,
    },
  },
];

function httpError(status: number, exception?: string) {
  return Response.json({ error: "write failed", exception }, { status });
}

function fixture(reply: (attempt: number) => Response) {
  const attempts: { at: number; request: Request; body: unknown }[] = [];
  const db = createClient({
    baseUrl: "http://arcadedb.test",
    fetch: async (input) => {
      const request = input as Request;
      attempts.push({
        at: Date.now(),
        request,
        body: await request.json(),
      });
      return reply(attempts.length);
    },
  }).db("test");
  const adapter = arcadeDBAdapter(db)({
    user: { additionalFields: { remaining: { type: "number" } } },
  });
  return { adapter, attempts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe.each(operations)("$name retry policy", (operation) => {
  it.each([1, 7])(
    "retries %i conflicts and returns the successful atomic result",
    async (failures) => {
      const { adapter, attempts } = fixture((attempt) =>
        attempt <= failures
          ? httpError(409, conflict)
          : Response.json({ result: [{ ...row, "@rid": "#1:0" }] }),
      );
      const result = expect(operation.run(adapter)).resolves.toEqual(row);
      await vi.runAllTimersAsync();
      await result;

      expect(attempts.map(({ at }) => at)).toEqual(
        [0, 1, 3, 7, 15, 31, 63, 127].slice(0, failures + 1),
      );
      for (const { request, body } of attempts) {
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://arcadedb.test/api/v1/command/test");
        expect(request.headers.get("arcadedb-session-id")).toBeNull();
        expect(body).toEqual({
          language: "sql",
          command: operation.command,
          params: operation.params,
        });
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("stops after exactly eight attempts and propagates the final conflict", async () => {
    const { adapter, attempts } = fixture((attempt) =>
      Response.json(
        { error: `conflict ${attempt}`, exception: conflict },
        { status: 409 },
      ),
    );
    const result = expect(operation.run(adapter)).rejects.toMatchObject({
      status: 409,
      exception: conflict,
      message: "conflict 8",
    });
    await vi.runAllTimersAsync();
    await result;
    expect(attempts.map(({ at }) => at)).toEqual([0, 1, 3, 7, 15, 31, 63, 127]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    {
      name: "unrelated conflict",
      status: 409,
      exception: "DuplicateKeyException",
    },
    { name: "server error", status: 500, exception: "InternalServerException" },
    { name: "permission error", status: 403, exception: "SecurityException" },
    { name: "unclassified conflict", status: 409, exception: undefined },
  ])("does not retry a $name", async ({ status, exception }) => {
    const { adapter, attempts } = fixture(() => httpError(status, exception));
    const result = expect(operation.run(adapter)).rejects.toMatchObject({
      status,
      message: "write failed",
    });
    await vi.runAllTimersAsync();
    await result;
    expect(attempts).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1])(
    "does not retry a network failure after %i conflicts",
    async (failures) => {
      // A matching property on a transport error is not a server-confirmed conflict.
      const error = Object.assign(new TypeError("connection reset"), {
        exception: conflict,
      });
      const { adapter, attempts } = fixture((attempt) => {
        if (attempt <= failures) return httpError(409, conflict);
        throw error;
      });
      const result = expect(operation.run(adapter)).rejects.toBe(error);
      await vi.runAllTimersAsync();
      await result;
      expect(attempts).toHaveLength(failures + 1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
