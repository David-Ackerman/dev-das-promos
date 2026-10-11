/**
 * Tiny database seam. The Worker talks to Neon over HTTP (see worker.ts);
 * Node jobs and tests use a normal TCP connection (see db-node.ts). All SQL
 * lives in repo.ts and only depends on this interface.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}
