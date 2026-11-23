// Proof of a fresh sign-in for deleting an account from inside an App (ADR 0037). The App signs the member in again through the
// sign-in relay, sends the Google ID token to POST /v1/auth/reauth, and gets this short-lived token back; POST /v1/me/delete-account
// accepts it together with the member's own App access token. It is bound to the member, the App and the App session, and it
// is useless anywhere else (its own `typ`, so it can never be used as an access token).
import type { Env } from "../env";
import { randomToken } from "../lib/crypto";
import { JwtError, signJwt, verifyJwt } from "../lib/jwt";
import { epochSeconds } from "../lib/time";
import { REAUTH_MAX_AGE } from "../admin/roles";
import { getSigningKeys } from "../oidc/config";

export const REAUTH_TYP = "reauth+jwt";
export const REAUTH_PURPOSE = "delete_account";
export const REAUTH_TTL = REAUTH_MAX_AGE;

export interface ReauthSubject {
  memberId: string;
  appId: string;
  sessionId: string;
}

export async function signReauthToken(env: Env, issuer: string, who: ReauthSubject, now: Date): Promise<string> {
  const iat = epochSeconds(now);
  const { current } = await getSigningKeys(env);
  return signJwt({ iss: issuer, aud: issuer, sub: who.memberId, app_id: who.appId, sid: who.sessionId, purpose: REAUTH_PURPOSE, iat, exp: iat + REAUTH_TTL, jti: randomToken(16) }, current, REAUTH_TYP);
}

/** True only for a token this system issued for exactly this member, App and App session, still inside its 10 minutes. */
export async function checkReauthToken(env: Env, issuer: string, token: string, who: ReauthSubject, now: Date): Promise<boolean> {
  try {
    const { publicKeys } = await getSigningKeys(env);
    const c = (await verifyJwt(token, publicKeys, { issuer, audience: issuer, now: epochSeconds(now), typ: REAUTH_TYP, clockSkew: 0 })) as Record<string, unknown>;
    return c.sub === who.memberId && c.app_id === who.appId && c.sid === who.sessionId && c.purpose === REAUTH_PURPOSE;
  } catch (e) {
    if (e instanceof JwtError) return false;
    throw e;
  }
}
