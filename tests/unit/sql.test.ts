import type { CleanedWhere } from "better-auth/adapters";
import { describe, expect, it } from "vitest";
import { identifier, pagination, SQLBuilder } from "../../src/sql.js";

const clause = (
  field: string,
  value: CleanedWhere["value"],
  operator: CleanedWhere["operator"] = "eq",
  connector: "AND" | "OR" = "AND",
): CleanedWhere => ({ field, value, operator, connector, mode: "sensitive" });

describe("SQL construction", () => {
  it("binds values independently of SQL", () => {
    const sql = new SQLBuilder();
    expect(sql.where([clause("email", "' OR 1=1 --")])).toBe(
      " WHERE `email` = :p0",
    );
    expect(sql.params).toEqual({ p0: "' OR 1=1 --" });
  });
  it("preserves left-to-right connector grouping", () => {
    const sql = new SQLBuilder();
    expect(
      sql.where([clause("a", 1), clause("b", 2, "eq", "OR"), clause("c", 3)]),
    ).toBe(" WHERE ((`a` = :p0 OR `b` = :p1) AND `c` = :p2)");
  });
  it("handles null and empty membership without invalid SQL", () => {
    const sql = new SQLBuilder();
    expect(
      sql.where([
        clause("a", null),
        clause("b", null, "ne"),
        clause("c", [], "in"),
      ]),
    ).toBe(" WHERE ((`a` IS NULL AND `b` IS NOT NULL) AND 1 = 0)");
    expect(sql.params).toEqual({});
  });
  it("rejects identifiers that could escape quoting or access metadata", () => {
    for (const value of ["", "x` WHERE 1=1", "@rid", "x\n"])
      expect(() => identifier(value)).toThrow();
    expect(identifier("users-table")).toBe("`users-table`");
  });
  it("quotes regex input including Java quote terminators", () => {
    const sql = new SQLBuilder();
    sql.where([clause("name", "a\\E.*%_", "contains")]);
    expect(sql.params.p0).toBe("(?s).*\\Qa\\E\\\\E\\Q.*%_\\E.*");
  });
  it("validates pagination", () => {
    for (const value of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
      expect(() => pagination(value, "limit")).toThrow();
    expect(pagination(0, "offset")).toBe(0);
  });
});
