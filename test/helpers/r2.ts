// In-memory stand-in for an R2 bucket (only what the code uses).
export interface FakeR2 {
  store: Map<string, { bytes: Uint8Array; mime?: string; uploaded: Date }>;
  put(key: string, value: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<{ size: number } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(o: { prefix?: string; limit?: number; cursor?: string }): Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>;
}
export function fakeR2(opts: { failPut?: boolean } = {}): FakeR2 {
  const store: FakeR2["store"] = new Map();
  return {
    store,
    async put(key, value, o) {
      if (opts.failPut) throw new Error("r2 down");
      store.set(key, { bytes: Uint8Array.from(value), mime: o?.httpMetadata?.contentType, uploaded: new Date() });
      return {};
    },
    async get(key) {
      const f = store.get(key);
      return f ? { arrayBuffer: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer } : null;
    },
    async head(key) {
      const f = store.get(key);
      return f ? { size: f.bytes.length } : null;
    },
    async delete(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(o) {
      const all = [...store].filter(([k]) => k.startsWith(o.prefix ?? "")).map(([key, v]) => ({ key, uploaded: v.uploaded }));
      return { objects: all, truncated: false };
    },
  };
}
