// File storage for avatars: R2 when the bucket is bound, otherwise D1 (the old way).
//
// The D1 row keeps the metadata (mime type, who owns it). When the bytes live in R2 the row's data column holds an EMPTY
// blob as the marker "the bytes are in R2 under the key of this row". Rows written before R2 existed still hold the bytes;
// src/jobs/files.ts moves them over a few at a time. Reading works for both, so nothing breaks while that happens.
import { blobBytes } from "./blob";

/** Stored in the D1 data column when the bytes are in R2. */
export const IN_R2 = new Uint8Array(0);

export const avatarKey = (memberId: string) => `avatars/${memberId}`;

/** Puts the bytes where they belong and returns what to write into the D1 data column. A failed R2 write falls back to D1. */
export async function storeFile(bucket: R2Bucket | undefined, key: string, mime: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!bucket) return bytes;
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: mime } });
    return IN_R2;
  } catch {
    return bytes;
  }
}

/** The bytes of a stored file: from the D1 column when it holds them, else from R2. null when they are nowhere. */
export async function loadFile(bucket: R2Bucket | undefined, key: string, column: unknown): Promise<Uint8Array<ArrayBuffer> | null> {
  const inline = blobBytes(column);
  if (inline.length > 0) return inline;
  if (!bucket) return null;
  try {
    const o = await bucket.get(key);
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function dropFiles(bucket: R2Bucket | undefined, keys: string[]): Promise<void> {
  if (!bucket || !keys.length) return;
  try {
    await bucket.delete(keys);
  } catch {
    /* the daily sweep removes whatever is left */
  }
}
