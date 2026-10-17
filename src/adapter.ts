import {
  type ArcadeDBDatabase,
  ArcadeDBError,
  type QueryEnvelope,
} from "@arcadedb/driver";
import type { BetterAuthOptions } from "better-auth";
import { createAdapterFactory, type DBAdapter } from "better-auth/adapters";
import { generateSchema } from "./schema.js";
import { identifier, pagination, SQLBuilder } from "./sql.js";
import type { ArcadeDBAdapterConfig } from "./types.js";

type Row = Record<string, unknown>;

function rows<T>(response: QueryEnvelope<T>): T[] {
  if (response.truncated)
    throw new Error(
      "ArcadeDB returned a truncated result; narrow the query or raise the server result limit.",
    );
  return response.result;
}

function affected(response: QueryEnvelope<Row>): number {
  const count = rows(response)[0]?.count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("ArcadeDB did not return an exact affected-row count");
  }
  return count;
}

function clean<T>(row: Row | undefined): T | null {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !key.startsWith("@")),
  ) as T;
}

/** Retry only optimistic write conflicts, never arbitrary HTTP/commit failures. */
async function atomic<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof ArcadeDBError) ||
        !error.exception?.endsWith("ConcurrentModificationException") ||
        attempt >= 7
      )
        throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(2 ** attempt, 64)),
      );
    }
  }
}

export function arcadeDBAdapter(
  db: ArcadeDBDatabase,
  config: ArcadeDBAdapterConfig = {},
): (options: BetterAuthOptions) => DBAdapter {
  const build = (
    database: ArcadeDBDatabase,
    options: BetterAuthOptions,
    inTransaction: boolean,
  ): DBAdapter =>
    createAdapterFactory({
      config: {
        adapterId: "arcadedb",
        adapterName: "ArcadeDB",
        usePlural: config.usePlural ?? false,
        debugLogs: config.debugLogs ?? false,
        supportsNumericIds: false,
        supportsUUIDs: false,
        supportsDates: false,
        supportsJSON: true,
        supportsArrays: true,
        supportsBooleans: true,
        // JSON can contain objects, arrays or scalars; one STRING encoding preserves all.
        customTransformInput: ({ data, fieldAttributes }) =>
          fieldAttributes.type === "json" && data != null
            ? JSON.stringify(data)
            : data,
        customTransformOutput: ({ data, fieldAttributes }) =>
          fieldAttributes.type === "json" && typeof data === "string"
            ? JSON.parse(data)
            : data,
        transaction: inTransaction
          ? false
          : (callback) =>
              database.transaction((tx) => callback(build(tx, options, true))),
      },
      adapter: ({ getModelName, getFieldName, getDefaultModelName }) => {
        const command = (sql: string, builder: SQLBuilder) =>
          database.command<Row>({
            language: "sql",
            command: sql,
            params: builder.params,
          });
        const query = (sql: string, builder: SQLBuilder) =>
          database.query<Row>({
            language: "sql",
            command: sql,
            params: builder.params,
            limit: -1,
          });
        // Conflicts inside an explicit transaction must abort the whole transaction.
        const write = <T>(operation: () => Promise<T>) =>
          inTransaction ? operation() : atomic(operation);
        return {
          async create({ model, data }) {
            const sql = new SQLBuilder();
            const assignments = sql.assignments(data);
            if (!assignments.length)
              throw new TypeError("Cannot insert an empty record");
            const result = clean<typeof data>(
              rows(
                await command(
                  `INSERT INTO ${identifier(model)} SET ${assignments.join(", ")}`,
                  sql,
                ),
              )[0],
            );
            if (!result) throw new Error("ArcadeDB insert returned no record");
            return result;
          },
          async findOne({ model, where }) {
            const sql = new SQLBuilder();
            return clean(
              rows(
                await query(
                  `SELECT FROM ${identifier(model)}${sql.where(where)} LIMIT 1`,
                  sql,
                ),
              )[0],
            );
          },
          async findMany({
            model,
            modelKey,
            where,
            limit,
            offset,
            sortBy,
            select,
          }) {
            pagination(limit, "limit");
            if (offset !== undefined) pagination(offset, "offset");
            if (limit === 0) return [];
            const sql = new SQLBuilder();
            const projection = select?.length
              ? ` ${select.map((field) => identifier(getFieldName({ model: modelKey ?? getDefaultModelName(model), field }))).join(", ")}`
              : "";
            let statement = `SELECT${projection} FROM ${identifier(model)}${sql.where(where)}`;
            if (sortBy) {
              const field = getFieldName({
                model: modelKey ?? getDefaultModelName(model),
                field: sortBy.field,
              });
              if (sortBy.direction !== "asc" && sortBy.direction !== "desc")
                throw new TypeError("Invalid sort direction");
              statement += ` ORDER BY ${identifier(field)} ${sortBy.direction.toUpperCase()}`;
            }
            if (offset) statement += ` SKIP ${offset}`;
            statement += ` LIMIT ${limit}`;
            return rows(await query(statement, sql)).map((row) => clean(row)!);
          },
          async count({ model, where }) {
            const sql = new SQLBuilder();
            return affected(
              await query(
                `SELECT count(*) AS count FROM ${identifier(model)}${sql.where(where)}`,
                sql,
              ),
            );
          },
          async update({ model, where, update }) {
            if (!where.length) return null;
            const sql = new SQLBuilder();
            const assignments = sql.assignments(update as Row);
            if (!assignments.length)
              return clean(
                rows(
                  await query(
                    `SELECT FROM ${identifier(model)}${sql.where(where)} LIMIT 1`,
                    sql,
                  ),
                )[0],
              );
            const statement = `UPDATE ${identifier(model)} SET ${assignments.join(", ")} RETURN AFTER${sql.where(where)} LIMIT 1`;
            return write(async () =>
              clean(rows(await command(statement, sql))[0]),
            );
          },
          async updateMany({ model, where, update }) {
            const sql = new SQLBuilder();
            const assignments = sql.assignments(update);
            if (!assignments.length) return 0;
            return affected(
              await command(
                `UPDATE ${identifier(model)} SET ${assignments.join(", ")}${sql.where(where)}`,
                sql,
              ),
            );
          },
          async delete({ model, where }) {
            if (!where.length) return;
            const sql = new SQLBuilder();
            await command(
              `DELETE FROM ${identifier(model)}${sql.where(where)} LIMIT 1`,
              sql,
            );
          },
          async deleteMany({ model, where }) {
            const sql = new SQLBuilder();
            return affected(
              await command(
                `DELETE FROM ${identifier(model)}${sql.where(where)}`,
                sql,
              ),
            );
          },
          async consumeOne({ model, where }) {
            if (!where.length) return null;
            const sql = new SQLBuilder();
            const statement = `DELETE FROM ${identifier(model)} RETURN BEFORE${sql.where(where)} LIMIT 1`;
            return write(async () =>
              clean(rows(await command(statement, sql))[0]),
            );
          },
          async incrementOne({ model, where, increment, set }) {
            if (!where.length) return null;
            const sql = new SQLBuilder();
            const assignments = sql.assignments(set ?? {});
            for (const [field, delta] of Object.entries(increment)) {
              if (!Number.isFinite(delta))
                throw new TypeError("Increment deltas must be finite numbers");
              if (set?.[field] !== undefined)
                throw new TypeError(`Cannot both set and increment ${field}`);
              const column = identifier(field);
              assignments.push(
                `${column} = ifnull(${column}, 0) + ${sql.bind(delta)}`,
              );
            }
            if (!assignments.length)
              throw new TypeError(
                "incrementOne requires an increment or set value",
              );
            const statement = `UPDATE ${identifier(model)} SET ${assignments.join(", ")} RETURN AFTER${sql.where(where)} LIMIT 1`;
            return write(async () =>
              clean(rows(await command(statement, sql))[0]),
            );
          },
          async createSchema({ tables, file }) {
            return {
              code: generateSchema(tables, getModelName),
              path: file ?? "arcadedb-schema.sql",
              overwrite: true,
            };
          },
        };
      },
    })(options);
  return (options) => build(db, options, false);
}
