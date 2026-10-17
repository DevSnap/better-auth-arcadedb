import {
  type ArcadeDBDatabase,
  ArcadeDBError,
  type QueryEnvelope,
} from "@arcadedb/driver";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthOptions } from "better-auth";
import {
  createAdapterFactory,
  type DBAdapter,
  type CleanedWhere,
  type Where,
} from "better-auth/adapters";
import { generateSchema } from "./schema.js";
import { identifier, pagination, SQLBuilder } from "./sql.js";
import type { ArcadeDBAdapterConfig } from "./types.js";
import { safeSerial, serialCounter } from "./serial.js";

type Row = Record<string, unknown>;
const filterContext = new AsyncLocalStorage<{
  model: string;
  where: Where[];
}>();

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
async function atomic<T>(
  operation: () => Promise<T>,
  conflict?: (error: ArcadeDBError) => boolean,
  retries = 7,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof ArcadeDBError) ||
        !(
          error.exception?.endsWith("ConcurrentModificationException") ||
          conflict?.(error)
        ) ||
        attempt >= retries
      )
        throw error;
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(2 ** attempt, 64) +
            (retries > 7 ? Math.floor(Math.random() * 64) : 0),
        ),
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
  ): DBAdapter => {
    const adapter = createAdapterFactory({
      config: {
        adapterId: "arcadedb",
        adapterName: "ArcadeDB",
        usePlural: config.usePlural ?? false,
        debugLogs: config.debugLogs ?? false,
        supportsNumericIds: true,
        supportsUUIDs: false,
        supportsDates: false,
        supportsJSON: true,
        supportsArrays: true,
        supportsBooleans: true,
        customTransformInput: ({ data, field, fieldAttributes }) => {
          if (
            options.advanced?.database?.generateId === "serial" &&
            (field === "id" || fieldAttributes.references?.field === "id")
          )
            safeSerial(data);
          return data;
        },
        customTransformOutput: ({ data, fieldAttributes }) =>
          fieldAttributes.type === "json" && typeof data === "string"
            ? JSON.parse(data)
            : data,
        transaction: inTransaction
          ? false
          : (callback) =>
              database.transaction((tx) => callback(build(tx, options, true))),
      },
      adapter: ({
        schema,
        getModelName,
        getFieldName,
        getDefaultModelName,
      }) => {
        // SQL receives physical field names. Resolve those directly rather than
        // letting a physical name collide with another canonical schema key.
        const attributes = (model: string, field: string) => {
          if (field === "id") return { type: "string" as const };
          const found = Object.entries(schema[model]!.fields).find(
            ([key, value]) => (value.fieldName ?? key) === field,
          )?.[1];
          if (!found)
            throw new TypeError(`Unknown physical field ${model}.${field}`);
          return found;
        };
        // Encode at the bind boundary so membership keeps its outer candidate list.
        const sqlFor = (model: string) =>
          new SQLBuilder((field, value) =>
            value != null && attributes(model, field).type === "json"
              ? JSON.stringify(value)
              : value,
          );
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
        const serial = options.advanced?.database?.generateId === "serial";
        const canonical = (model: string, modelKey?: string) =>
          modelKey ?? getDefaultModelName(model);
        const predicate = (
          model: string,
          where: CleanedWhere[] = [],
        ): CleanedWhere[] => {
          const source = filterContext.getStore();
          if (!serial || !source || getDefaultModelName(source.model) !== model)
            return where;
          return where.map((clause, index) => {
            const raw = source.where[index];
            if (
              !raw ||
              getFieldName({ model, field: raw.field }) !== clause.field ||
              (clause.field !== "id" &&
                attributes(model, clause.field).references?.field !== "id")
            )
              return clause;
            // The factory coerces null to zero. Restore only original nulls;
            // every other conversion and validation remains factory-owned.
            return raw.value === null ? { ...clause, value: null } : clause;
          });
        };
        const mutable = (data: Row) => {
          if (serial && data.id !== undefined)
            throw new TypeError("Serial IDs are immutable");
        };
        return {
          async create({ model, modelKey, data }) {
            if (serial) {
              const insert = async (target: ArcadeDBDatabase) => {
                safeSerial(data.id);
                const explicit = data.id != null;
                const counter = rows(
                  await target.command<Row>({
                    language: "sql",
                    command: explicit
                      ? `UPDATE ${identifier(serialCounter)} SET \`value\` = max(\`value\`, :id) RETURN AFTER WHERE \`model\` = :model AND \`value\` >= 0 AND \`value\` <= :maximum LIMIT 1`
                      : `UPDATE ${identifier(serialCounter)} SET \`value\` = \`value\` + 1 RETURN AFTER WHERE \`model\` = :model AND \`value\` >= 0 AND \`value\` < :maximum LIMIT 1`,
                    params: explicit
                      ? { model, id: data.id, maximum: Number.MAX_SAFE_INTEGER }
                      : { model, maximum: Number.MAX_SAFE_INTEGER },
                  }),
                )[0];
                if (!counter)
                  throw new Error(
                    `Serial counter missing, invalid or exhausted for ${model}; apply or repair the generated schema`,
                  );
                safeSerial(counter.value);
                if (
                  typeof counter.value !== "number" ||
                  counter.value < 0 ||
                  (!explicit && counter.value === 0)
                )
                  throw new Error(`Invalid serial counter for ${model}`);
                const sql = sqlFor(canonical(model, modelKey));
                const id = explicit ? data.id : counter.value;
                const assignments = sql.assignments({
                  ...data,
                  id,
                });
                const result = clean<typeof data>(
                  rows(
                    await target.command<Row>({
                      language: "sql",
                      command: `INSERT INTO ${identifier(model)} SET ${assignments.join(", ")}`,
                      params: sql.params,
                    }),
                  )[0],
                );
                if (!result)
                  throw new Error("ArcadeDB insert returned no record");
                if (result.id == null)
                  throw new Error("ArcadeDB insert returned no serial ID");
                safeSerial(result.id);
                if (result.id !== id)
                  throw new Error(
                    "ArcadeDB insert returned a different serial ID",
                  );
                return result;
              };
              // The server can report the generated id's unique-index collision before
              // checking the counter page's MVCC conflict. Only that exact index and
              // only an automatically allocated id qualify for a transaction retry.
              return inTransaction
                ? insert(database)
                : atomic(
                    () => database.transaction(insert),
                    (error) =>
                      data.id == null &&
                      error.exception?.endsWith("DuplicatedKeyException") ===
                        true &&
                      error.exceptionArgs?.startsWith(`${model}[id]|`) === true,
                    31,
                  );
            }
            const sql = sqlFor(canonical(model, modelKey));
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
          async findOne({ model, modelKey, where }) {
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
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
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
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
          async count({ model, modelKey, where }) {
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
            return affected(
              await query(
                `SELECT count(*) AS count FROM ${identifier(model)}${sql.where(where)}`,
                sql,
              ),
            );
          },
          async update({ model, modelKey, where, update }) {
            if (!where.length) return null;
            mutable(update as Row);
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
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
          async updateMany({ model, modelKey, where, update }) {
            mutable(update);
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
            const assignments = sql.assignments(update);
            if (!assignments.length) return 0;
            return affected(
              await command(
                `UPDATE ${identifier(model)} SET ${assignments.join(", ")}${sql.where(where)}`,
                sql,
              ),
            );
          },
          async delete({ model, modelKey, where }) {
            if (!where.length) return;
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
            await command(
              `DELETE FROM ${identifier(model)}${sql.where(where)} LIMIT 1`,
              sql,
            );
          },
          async deleteMany({ model, modelKey, where }) {
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
            return affected(
              await command(
                `DELETE FROM ${identifier(model)}${sql.where(where)}`,
                sql,
              ),
            );
          },
          async consumeOne({ model, modelKey, where }) {
            if (!where.length) return null;
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
            const statement = `DELETE FROM ${identifier(model)} RETURN BEFORE${sql.where(where)} LIMIT 1`;
            return write(async () =>
              clean(rows(await command(statement, sql))[0]),
            );
          },
          async incrementOne({ model, modelKey, where, increment, set }) {
            if (!where.length) return null;
            mutable(set ?? {});
            const key = canonical(model, modelKey);
            where = predicate(key, where);
            const sql = sqlFor(key);
            const assignments = sql.assignments(set ?? {});
            for (const [field, delta] of Object.entries(increment)) {
              if (
                serial &&
                (field === "id" ||
                  attributes(key, field).references?.field === "id")
              )
                throw new TypeError(
                  "Cannot increment serial IDs or references",
                );
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
              code: generateSchema(tables, getModelName, serial),
              path: file ?? "arcadedb-schema.sql",
              overwrite: true,
            };
          },
        };
      },
    })(options);
    if (options.advanced?.database?.generateId === "serial") {
      // Scope the uncoerced predicate to this invocation, including asynchronous
      // factory transformations. Nested calls and concurrent requests are isolated.
      for (const method of [
        "findOne",
        "findMany",
        "count",
        "update",
        "updateMany",
        "delete",
        "deleteMany",
        "consumeOne",
        "incrementOne",
      ] as const) {
        const original = adapter[method].bind(adapter);
        Object.assign(adapter, {
          [method]: (input: {
            model: string;
            where?: Where[];
            update?: Row;
            set?: Row;
          }) => {
            if (
              (method === "update" ||
                method === "updateMany" ||
                method === "incrementOne") &&
              (input.update?.id !== undefined || input.set?.id !== undefined)
            )
              return Promise.reject(new TypeError("Serial IDs are immutable"));
            return filterContext.run(
              { model: input.model, where: input.where ?? [] },
              () => original(input as never),
            );
          },
        });
      }
    }
    return adapter;
  };
  return (options) => build(db, options, false);
}
