import { basicAuth, createClient } from "@arcadedb/driver";
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
  return arcadeDBAdapter(db)({});
}

describe("driver response contract", () => {
  it("rejects truncated reads instead of returning a partial answer", async () => {
    await expect(
      adapterFor([{ id: "1" }], true).findMany({ model: "user" }),
    ).rejects.toThrow("truncated");
  });
  it("rejects invalid affected-row counts", async () => {
    await expect(
      adapterFor([{ count: "1" }]).deleteMany({ model: "user", where: [] }),
    ).rejects.toThrow("exact affected-row count");
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
