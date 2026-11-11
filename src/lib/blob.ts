/** A BLOB column as bytes. The real D1 hands BLOBs back as an array of numbers (the test stand-in mimics that); other
 * runtimes give an ArrayBuffer or a typed array. Sending the raw array as a response body would be empty. */
export function blobBytes(v: unknown): Uint8Array<ArrayBuffer> {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return new Uint8Array(0);
}
