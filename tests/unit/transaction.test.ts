import { createClient } from "@arcadedb/driver";
import type { DBTransactionAdapter } from "better-auth/adapters";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";

const sessionHeader = "arcadedb-session-id";
const conflict = "com.arcadedb.exception.ConcurrentModificationException";
const row = { id: "user-1", name: "updated", remaining: 2 };
const where = [{ field: "id", value: row.id }];
const operations = [
  {
    name: "update",
    run: (tx: DBTransactionAdapter) =>
      tx.update({ model: "user", where, update: { name: row.name } }),
  },
  {
    name: "consumeOne",
    run: (tx: DBTransactionAdapter) => tx.consumeOne({ model: "user", where }),
  },
  {
    name: "incrementOne",
    run: (tx: DBTransactionAdapter) =>
      tx.incrementOne({ model: "user", where, increment: { remaining: 1 } }),
  },
];

function fixture(
  reply: (endpoint: string, request: Request) => Response | Promise<Response>,
) {
  const requests: { endpoint: string; session: string | null }[] = [];
  const db = createClient({
    baseUrl: "http://arcadedb.test",
    fetch: async (input) => {
      const request = input as Request;
      const endpoint = new URL(request.url).pathname;
      expect(request.method).toBe("POST");
      requests.push({
        endpoint,
        session: request.headers.get(sessionHeader),
      });
      return reply(endpoint, request);
    },
  }).db("test");
  const adapter = arcadeDBAdapter(db)({
    user: { additionalFields: { remaining: { type: "number" } } },
  });
  return { adapter, requests };
}

function begin(session = "tx-1") {
  return new Response(null, {
    status: 204,
    headers: { [sessionHeader]: session },
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("adapter transactions", () => {
  it("routes callback reads and all atomic writes through their own session without leaking it to the outer adapter", async () => {
    let session = 0;
    const { adapter, requests } = fixture((endpoint) => {
      if (endpoint === "/api/v1/begin/test") return begin(`tx-${++session}`);
      if (endpoint === "/api/v1/commit/test")
        return new Response(null, { status: 204 });
      if (
        endpoint === "/api/v1/query/test" ||
        endpoint === "/api/v1/command/test"
      )
        return Response.json({ result: [row] });
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });

    for (const id of ["tx-1", "tx-2"]) {
      const callback = vi.fn(async (tx: DBTransactionAdapter) => {
        expect(await tx.findOne({ model: "user", where })).toEqual(row);
        // The outer handle must remain outside even while a transaction is open.
        expect(await adapter.findOne({ model: "user", where })).toEqual(row);
        for (const operation of operations)
          expect(await operation.run(tx)).toEqual(row);
        return { committed: id };
      });
      await expect(adapter.transaction(callback)).resolves.toEqual({
        committed: id,
      });
      expect(callback).toHaveBeenCalledTimes(1);
      expect(await adapter.findOne({ model: "user", where })).toEqual(row);
    }

    expect(
      requests.map(({ endpoint, session }) => [endpoint, session]),
    ).toEqual(
      ["tx-1", "tx-2"].flatMap((id) => [
        ["/api/v1/begin/test", null],
        ["/api/v1/query/test", id],
        ["/api/v1/query/test", null],
        ["/api/v1/command/test", id],
        ["/api/v1/command/test", id],
        ["/api/v1/command/test", id],
        ["/api/v1/commit/test", id],
        ["/api/v1/query/test", null],
      ]),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(operations)(
    "aborts on a $name conflict without retrying the command or replaying earlier writes",
    async (operation) => {
      let commands = 0;
      const { adapter, requests } = fixture((endpoint) => {
        if (endpoint === "/api/v1/begin/test") return begin();
        if (endpoint === "/api/v1/rollback/test")
          return new Response(null, { status: 204 });
        if (endpoint === "/api/v1/command/test") {
          if (++commands === 1) return Response.json({ result: [row] });
          return Response.json(
            { error: "transaction write conflict", exception: conflict },
            { status: 409 },
          );
        }
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      });
      const afterWrite = vi.fn();
      const callback = vi.fn(async (tx: DBTransactionAdapter) => {
        await tx.update({ model: "user", where, update: { name: "earlier" } });
        await operation.run(tx);
        afterWrite();
      });
      const result = expect(
        adapter.transaction(callback),
      ).rejects.toMatchObject({
        status: 409,
        exception: conflict,
        message: "transaction write conflict",
      });
      await vi.runAllTimersAsync();
      await result;

      expect(callback).toHaveBeenCalledTimes(1);
      expect(afterWrite).not.toHaveBeenCalled();
      expect(
        requests.map(({ endpoint, session }) => [endpoint, session]),
      ).toEqual([
        ["/api/v1/begin/test", null],
        ["/api/v1/command/test", "tx-1"],
        ["/api/v1/command/test", "tx-1"],
        ["/api/v1/rollback/test", "tx-1"],
      ]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["conflict", "network"])(
    "propagates a commit %s without replaying the callback or any successful write",
    async (failure) => {
      const networkError = new TypeError("commit connection lost");
      const { adapter, requests } = fixture((endpoint) => {
        if (endpoint === "/api/v1/begin/test") return begin();
        if (endpoint === "/api/v1/command/test")
          return Response.json({ result: [row] });
        if (endpoint === "/api/v1/commit/test") {
          if (failure === "network") throw networkError;
          return Response.json(
            { error: "commit conflict", exception: conflict },
            { status: 409 },
          );
        }
        if (endpoint === "/api/v1/rollback/test")
          return new Response(null, { status: 204 });
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      });
      const callback = vi.fn(async (tx: DBTransactionAdapter) => {
        for (const operation of operations) await operation.run(tx);
        return "callback succeeded";
      });
      const promise = adapter.transaction(callback);
      const result =
        failure === "network"
          ? expect(promise).rejects.toBe(networkError)
          : expect(promise).rejects.toMatchObject({
              status: 409,
              exception: conflict,
              message: "commit conflict",
            });
      await vi.runAllTimersAsync();
      await result;

      expect(callback).toHaveBeenCalledTimes(1);
      expect(
        requests.map(({ endpoint, session }) => [endpoint, session]),
      ).toEqual([
        ["/api/v1/begin/test", null],
        ["/api/v1/command/test", "tx-1"],
        ["/api/v1/command/test", "tx-1"],
        ["/api/v1/command/test", "tx-1"],
        ["/api/v1/commit/test", "tx-1"],
        ["/api/v1/rollback/test", "tx-1"],
      ]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
