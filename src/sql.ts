import type { CleanedWhere } from "better-auth/adapters";

/** Backticks and control characters are rejected rather than ambiguously escaped. */
export function identifier(name: string): string {
  if (!name || /[`\u0000-\u001f\u007f]/u.test(name) || name.startsWith("@")) {
    throw new TypeError(
      `Unsupported ArcadeDB identifier: ${JSON.stringify(name)}`,
    );
  }
  return `\`${name}\``;
}

export class SQLBuilder {
  readonly params: Record<string, unknown> = {};

  bind(value: unknown): string {
    const key = `p${Object.keys(this.params).length}`;
    this.params[key] = value;
    return `:${key}`;
  }

  assignments(data: Record<string, unknown>): string[] {
    return Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => `${identifier(field)} = ${this.bind(value)}`);
  }

  where(clauses: CleanedWhere[] = []): string {
    const expressions = clauses.map((clause) => this.condition(clause));
    if (!expressions.length) return "";
    // Better Auth connectors are evaluated from left to right.
    const expression = expressions
      .slice(1)
      .reduce((previous, current, index) => {
        const connector = clauses[index + 1]?.connector === "OR" ? "OR" : "AND";
        return `(${previous} ${connector} ${current})`;
      }, expressions[0]!);
    return ` WHERE ${expression}`;
  }

  private condition({ field, value, operator, mode }: CleanedWhere): string {
    let column = identifier(field);
    if (value === null && (operator === "eq" || operator === "ne")) {
      return `${column} IS ${operator === "ne" ? "NOT " : ""}NULL`;
    }
    const insensitive =
      mode === "insensitive" &&
      (typeof value === "string" ||
        (Array.isArray(value) && value.every((v) => typeof v === "string")));
    if (insensitive) {
      column = `${column}.toLowerCase()`;
      value = Array.isArray(value)
        ? value.map((v) => String(v).toLowerCase())
        : String(value).toLowerCase();
    }
    if (operator === "in" || operator === "not_in") {
      if (!Array.isArray(value))
        throw new TypeError(`${operator} requires an array`);
      if (!value.length) return operator === "in" ? "1 = 0" : "1 = 1";
      return `${column} ${operator === "not_in" ? "NOT IN" : "IN"} ${this.bind(value)}`;
    }
    if (["contains", "starts_with", "ends_with"].includes(operator)) {
      if (typeof value !== "string")
        throw new TypeError(`${operator} requires a string`);
      // Java Pattern quoting: literal input, including %, _, regex and embedded \E.
      const literal = `\\Q${value.replaceAll("\\E", "\\E\\\\E\\Q")}\\E`;
      const pattern = `(?s)${operator === "starts_with" ? "" : ".*"}${literal}${operator === "ends_with" ? "" : ".*"}`;
      return `${column} MATCHES ${this.bind(pattern)}`;
    }
    const operators = {
      eq: "=",
      ne: "<>",
      lt: "<",
      lte: "<=",
      gt: ">",
      gte: ">=",
    };
    const sqlOperator = operators[operator as keyof typeof operators];
    if (!sqlOperator) throw new TypeError(`Unsupported operator: ${operator}`);
    return `${column} ${sqlOperator} ${this.bind(value)}`;
  }
}

export function pagination(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}
