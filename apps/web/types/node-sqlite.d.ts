/** Node 24's built-in SQLite API; this repository retains @types/node 20. */
declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | NodeJS.ArrayBufferView;
  export interface StatementSync {
    get(...params: SQLInputValue[]): Record<string, unknown> | undefined;
    all(...params: SQLInputValue[]): Record<string, unknown>[];
    iterate(...params: SQLInputValue[]): IterableIterator<Record<string, unknown>>;
    run(...params: SQLInputValue[]): {changes: number | bigint; lastInsertRowid: number | bigint};
  }
  export class DatabaseSync {
    constructor(path: string, options?: {readOnly?: boolean; allowExtension?: boolean});
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
