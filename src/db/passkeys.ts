// Passkey 的資料存取：公鑰與計數器、單次挑戰碼、登入階段的「已用 passkey 確認」時間。
import { uuidv7 } from "../lib/crypto";
import { epochSeconds, taipeiIso } from "../lib/time";

export const CHALLENGE_TTL = 300;
export const MAX_PASSKEYS = 10;

export interface PasskeyRow { id: string; member_id: string; credential_id: string; public_key: string; alg: number; sign_count: number; name: string; created_at: string; last_used_at: string | null }

export async function newChallenge(db: D1Database, memberId: string, purpose: "register" | "authenticate", challenge: string, now: Date): Promise<void> {
  const t = epochSeconds(now);
  await db.batch([
    db.prepare("DELETE FROM passkey_challenges WHERE expires_epoch < ?").bind(t),
    db.prepare("INSERT INTO passkey_challenges (challenge, member_id, purpose, expires_epoch) VALUES (?, ?, ?, ?)").bind(challenge, memberId, purpose, t + CHALLENGE_TTL),
  ]);
}

/** 單次使用：取走就刪；不是這位會員、用途不對或過期都回 false。 */
export async function consumeChallenge(db: D1Database, memberId: string, purpose: "register" | "authenticate", challenge: string, now: Date): Promise<boolean> {
  const r = await db.prepare("DELETE FROM passkey_challenges WHERE challenge = ? AND member_id = ? AND purpose = ? AND expires_epoch >= ?").bind(challenge, memberId, purpose, epochSeconds(now)).run();
  return (r.meta?.changes ?? 0) > 0;
}

export async function listPasskeys(db: D1Database, memberId: string): Promise<PasskeyRow[]> {
  return (await db.prepare("SELECT * FROM passkeys WHERE member_id = ? ORDER BY created_at").bind(memberId).all<PasskeyRow>()).results ?? [];
}
export async function passkeyCount(db: D1Database, memberId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE member_id = ?").bind(memberId).first<{ n: number }>())?.n ?? 0;
}
export async function findPasskey(db: D1Database, memberId: string, credentialId: string): Promise<PasskeyRow | null> {
  return db.prepare("SELECT * FROM passkeys WHERE member_id = ? AND credential_id = ?").bind(memberId, credentialId).first<PasskeyRow>();
}
export async function addPasskey(db: D1Database, memberId: string, credentialId: string, publicKey: string, alg: number, signCount: number, name: string, now: Date): Promise<string> {
  const id = uuidv7(now.getTime());
  await db.prepare("INSERT INTO passkeys (id, member_id, credential_id, public_key, alg, sign_count, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, memberId, credentialId, publicKey, alg, signCount, name.slice(0, 40), taipeiIso(now)).run();
  return id;
}
export async function deletePasskey(db: D1Database, memberId: string, id: string): Promise<boolean> {
  return ((await db.prepare("DELETE FROM passkeys WHERE id = ? AND member_id = ?").bind(id, memberId).run()).meta?.changes ?? 0) > 0;
}
/** 驗證成功：更新計數器與最後使用時間，並把這個登入階段標為「剛用 passkey 確認過」。 */
export async function markStepUp(db: D1Database, passkeyId: string, signCount: number, sessionId: string, now: Date): Promise<void> {
  await db.batch([
    db.prepare("UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE id = ?").bind(signCount, taipeiIso(now), passkeyId),
    db.prepare("UPDATE login_sessions SET stepup_epoch = ? WHERE id = ?").bind(epochSeconds(now), sessionId),
  ]);
}
