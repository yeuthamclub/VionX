import postgres from 'postgres';

export type Sql = postgres.Sql;
export type TxSql = postgres.TransactionSql;

let shared: Sql | undefined;

/** One small pool per isolate. `prepare: false` keeps it compatible with the transaction pooler. */
export function getSql(dbUrl: string): Sql {
  shared ??= postgres(dbUrl, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
  return shared;
}
