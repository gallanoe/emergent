/**
 * Minimal type declarations for bun:sqlite.
 * These are only needed when @types/bun is not installed;
 * Bun itself provides full types at runtime.
 */
declare module "bun:sqlite" {
  interface DatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
  }

  interface Statement<T = unknown> {
    all(...params: unknown[]): T[];
    get(...params: unknown[]): T | undefined;
    run(...params: unknown[]): void;
    finalize(): void;
  }

  export class Database {
    constructor(filename: string, options?: DatabaseOptions);
    query<T = unknown>(sql: string): Statement<T>;
    exec(sql: string): void;
    close(): void;
  }
}
