import { createClient } from "@arcadedb/driver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arcadeDBAdapter } from "../../src/index.js";

const duplicate = "com.arcadedb.exception.DuplicatedKeyException";
const conflict = "com.arcadedb.exception.ConcurrentModificationException";
const options = { advanced: { database: { generateId: "serial" as const } } };
function fixture(failure: () => Response, failAt = "commit") {
  const requests: {
    path: string;
    session: string | null;
    body?: { command: string };
  }[] = [];
  let attempt = 0;
  const db = createClient({
    baseUrl: "http://arcadedb.test",
    fetch: async (input) => {
      const request = input as Request;
      const path = new URL(request.url).pathname.split("/")[3]!;
      requests.push({
        path,
        session: request.headers.get("arcadedb-session-id"),
        body: path === "command" ? await request.json() : undefined,
      });
      if (path === "begin") {
        attempt++;
        return new Response(null, {
          status: 204,
          headers: { "arcadedb-session-id": `tx-${attempt}` },
        });
      }
      if (path === failAt && attempt === 1) return failure();
      if (path === "command") {
        const insert = requests.at(-1)!.body!.command.startsWith("INSERT");
        return Response.json({
          result: [insert ? { id: 2, name: "entry" } : { value: 2 }],
        });
      }
      return new Response(null, { status: 204 });
    },
  }).db("test");
  return { adapter: arcadeDBAdapter(db)(options), requests };
}
const errorResponse = (exception: string, exceptionArgs?: string) =>
  Response.json({ error: "failed", exception, exceptionArgs }, { status: 409 });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("serial transaction retry boundaries", () => {
  it.each([
    { counter: {}, insert: { id: 2 }, message: "Invalid serial counter" },
    {
      counter: { value: null },
      insert: { id: 2 },
      message: "Invalid serial counter",
    },
    {
      counter: { value: -1 },
      insert: { id: 2 },
      message: "Invalid serial counter",
    },
    {
      counter: { value: 0 },
      insert: { id: 2 },
      message: "Invalid serial counter",
    },
    { counter: { value: 1.5 }, insert: { id: 2 }, message: "safe integers" },
    { counter: { value: 2 }, insert: {}, message: "no serial ID" },
    {
      counter: { value: 2 },
      insert: { id: 3 },
      message: "different serial ID",
    },
    { counter: { value: 2 }, insert: { id: "2" }, message: "safe integers" },
  ])(
    "rolls back inconsistent allocation responses ($message)",
    async ({ counter, insert, message }) => {
      const paths: string[] = [];
      const db = createClient({
        baseUrl: "http://arcadedb.test",
        fetch: async (input) => {
          const request = input as Request;
          const path = new URL(request.url).pathname.split("/")[3]!;
          paths.push(path);
          if (path === "begin")
            return new Response(null, {
              status: 204,
              headers: { "arcadedb-session-id": "tx" },
            });
          if (path === "command") {
            const body = await request.json();
            return Response.json({
              result: [body.command.startsWith("INSERT") ? insert : counter],
            });
          }
          return new Response(null, { status: 204 });
        },
      }).db("test");
      await expect(
        arcadeDBAdapter(db)(options).create({
          model: "user",
          data: { name: "entry" },
        }),
      ).rejects.toThrow(message);
      expect(paths.at(-1)).toBe("rollback");
      expect(paths).not.toContain("commit");
      expect(paths.filter((path) => path === "begin")).toHaveLength(1);
    },
  );

  it.each([conflict, duplicate])(
    "retries a confirmed allocation conflict (%s) in a fresh session",
    async (exception) => {
      const { adapter, requests } = fixture(() =>
        errorResponse(exception, "user[id]|[2]|#1:1"),
      );
      const result = expect(
        adapter.create({ model: "user", data: { name: "entry" } }),
      ).resolves.toMatchObject({ id: "2" });
      await vi.runAllTimersAsync();
      await result;
      expect(requests.map((r) => r.path)).toEqual([
        "begin",
        "command",
        "command",
        "commit",
        "rollback",
        "begin",
        "command",
        "command",
        "commit",
      ]);
      expect(
        requests.filter((r) => r.path === "command").map((r) => r.session),
      ).toEqual(["tx-1", "tx-1", "tx-2", "tx-2"]);
    },
  );

  it.each([
    {
      name: "unrelated unique index",
      exception: duplicate,
      args: "user[email]|[email]|#1:1",
      explicit: false,
    },
    {
      name: "unstructured duplicate",
      exception: duplicate,
      args: undefined,
      explicit: false,
    },
    {
      name: "explicit duplicate id",
      exception: duplicate,
      args: "user[id]|[2]|#1:1",
      explicit: true,
    },
  ])("does not retry $name", async ({ exception, args, explicit }) => {
    const { adapter, requests } = fixture(() => errorResponse(exception, args));
    const result = expect(
      adapter.create({
        model: "user",
        data: { name: "entry", ...(explicit ? { id: "2" } : {}) },
        forceAllowId: explicit,
      }),
    ).rejects.toMatchObject({ exception });
    await vi.runAllTimersAsync();
    await result;
    expect(requests.filter((r) => r.path === "begin")).toHaveLength(1);
  });

  it.each(["command", "commit"])(
    "never retries a network failure at %s",
    async (failAt) => {
      const error = new TypeError("connection lost");
      const { adapter, requests } = fixture(() => {
        throw error;
      }, failAt);
      await expect(
        adapter.create({ model: "user", data: { name: "entry" } }),
      ).rejects.toBe(error);
      expect(requests.filter((r) => r.path === "begin")).toHaveLength(1);
      expect(requests.at(-1)!.path).toBe("rollback");
    },
  );

  it("does not nest transactions or replay application callbacks on conflict", async () => {
    const { adapter, requests } = fixture(
      () => errorResponse(conflict),
      "command",
    );
    const callback = vi.fn((tx) =>
      tx.create({ model: "user", data: { name: "entry" } }),
    );
    await expect(adapter.transaction(callback)).rejects.toMatchObject({
      exception: conflict,
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(requests.map((r) => r.path)).toEqual([
      "begin",
      "command",
      "rollback",
    ]);
  });

  it("bounds automatic allocation retries", async () => {
    let attempts = 0;
    const db = createClient({
      baseUrl: "http://arcadedb.test",
      fetch: async (input) => {
        const path = new URL((input as Request).url).pathname;
        if (path.includes("/commit/")) return errorResponse(conflict);
        if (path.includes("/begin/")) {
          attempts++;
          return new Response(null, {
            status: 204,
            headers: { "arcadedb-session-id": "tx" },
          });
        }
        return Response.json({ result: [{ id: 2, value: 2 }] });
      },
    }).db("test");
    const result = expect(
      arcadeDBAdapter(db)(options).create({
        model: "user",
        data: { name: "entry" },
      }),
    ).rejects.toMatchObject({ exception: conflict });
    await vi.runAllTimersAsync();
    await result;
    expect(attempts).toBe(32);
  });
});
