/**
 * A D1 wrapper that counts queries per request so tests can enforce the query budget
 * (≤ 6 per request, docs/architecture.md §API). Batches count each statement.
 */
export function countingDb(db: D1Database, counter: { n: number }): D1Database {
  const wrapStmt = (stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(target, prop, receiver) {
        if (prop === 'bind') return (...args: unknown[]) => wrapStmt(target.bind(...args));
        if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') {
          const fn = Reflect.get(target, prop, target) as (...a: unknown[]) => unknown;
          return (...a: unknown[]) => {
            counter.n++;
            return fn.apply(target, a);
          };
        }
        if (prop === '__raw') return target;
        return Reflect.get(target, prop, receiver);
      },
    });
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrapStmt(target.prepare(sql));
      if (prop === 'batch')
        return (stmts: D1PreparedStatement[]) => {
          counter.n += stmts.length;
          return target.batch(
            stmts.map((s) => (s as unknown as { __raw?: D1PreparedStatement }).__raw ?? s),
          );
        };
      const val = Reflect.get(target, prop, target);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

export const bool = (n: unknown) => n === 1 || n === true;
export const nullableBool = (n: unknown) => (n === null || n === undefined ? null : bool(n));
