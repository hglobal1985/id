export interface TestD1 extends D1Database {
  raw: { prepare(sql: string): { get(...p: unknown[]): Record<string, unknown> | undefined; all(...p: unknown[]): Record<string, unknown>[]; run(...p: unknown[]): unknown }; exec(sql: string): void };
}
export function createTestD1(): TestD1;
