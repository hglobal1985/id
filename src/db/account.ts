// Member-site account data: signed-in devices and "download my data". Nothing here returns token hashes or secrets.
import { epochSeconds, taipeiIso } from "../lib/time";

export interface DeviceRow {
  id: string;
  kind: "web" | "app";
  app_id: string;
  device_label: string | null;
  last_used_at: string;
}

/** Every live sign-in of the member: the member site's own sessions and each App's sessions. */
export async function listDevices(db: D1Database, memberId: string, now: Date): Promise<DeviceRow[]> {
  const t = epochSeconds(now);
  const [web, apps] = await Promise.all([
    db.prepare("SELECT id, created_at FROM login_sessions WHERE member_id = ? AND revoked_epoch IS NULL AND expires_epoch > ? ORDER BY created_at DESC LIMIT 50").bind(memberId, t).all<{ id: string; created_at: string }>(),
    db
      .prepare("SELECT id, app_id, device_label, last_used_epoch FROM app_sessions WHERE member_id = ? AND revoked_epoch IS NULL AND expires_epoch > ? ORDER BY last_used_epoch DESC LIMIT 100")
      .bind(memberId, t)
      .all<{ id: string; app_id: string; device_label: string | null; last_used_epoch: number }>(),
  ]);
  return [
    ...(web.results ?? []).map((r): DeviceRow => ({ id: r.id, kind: "web", app_id: "central", device_label: null, last_used_at: r.created_at })),
    ...(apps.results ?? []).map((r): DeviceRow => ({ id: r.id, kind: "app", app_id: r.app_id, device_label: r.device_label, last_used_at: taipeiIso(new Date(r.last_used_epoch * 1000)) })),
  ];
}

const parse = (v: string | null): unknown => {
  if (v === null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** Everything the system holds about the member, as one JSON document (the member's own data). */
export async function exportMemberData(db: D1Database, memberId: string, now: Date): Promise<Record<string, unknown>> {
  const [member, fields, visibility, numbers, amway, consents, apps, links] = await Promise.all([
    db
      .prepare("SELECT id, google_email, google_email_verified, display_name, registration_country, status, created_at, last_login_at FROM members WHERE id = ?")
      .bind(memberId)
      .first<Record<string, unknown>>(),
    db.prepare("SELECT field_key, value, updated_at FROM profile_field_values WHERE member_id = ? ORDER BY field_key").bind(memberId).all<{ field_key: string; value: string; updated_at: string }>(),
    db.prepare("SELECT field_key, visibility FROM profile_visibility WHERE member_id = ? ORDER BY field_key").bind(memberId).all<{ field_key: string; visibility: string }>(),
    db.prepare("SELECT position, country, number FROM member_numbers WHERE member_id = ? ORDER BY position").bind(memberId).all<Record<string, unknown>>(),
    db
      .prepare("SELECT field_key, value, pending_value, status, updated_at FROM amway_field_values WHERE member_id = ? ORDER BY field_key")
      .bind(memberId)
      .all<{ field_key: string; value: string | null; pending_value: string | null; status: string; updated_at: string }>(),
    db.prepare("SELECT document, version, action, occurred_at FROM consent_records WHERE member_id = ? ORDER BY occurred_at").bind(memberId).all<Record<string, unknown>>(),
    db.prepare("SELECT app_id, first_seen_at, last_seen_at FROM member_apps WHERE member_id = ? ORDER BY app_id").bind(memberId).all<Record<string, unknown>>(),
    db.prepare("SELECT platform_key, url, label, created_at FROM social_links WHERE member_id = ? ORDER BY sort_order").bind(memberId).all<Record<string, unknown>>(),
  ]);
  return {
    exported_at: taipeiIso(now),
    member,
    profile: Object.fromEntries((fields.results ?? []).map((f) => [f.field_key, { value: parse(f.value), updated_at: f.updated_at }])),
    visibility: Object.fromEntries((visibility.results ?? []).map((v) => [v.field_key, v.visibility])),
    member_numbers: numbers.results ?? [],
    amway: (amway.results ?? []).map((a) => ({ field_key: a.field_key, value: parse(a.value), pending_value: parse(a.pending_value), status: a.status, updated_at: a.updated_at })),
    consents: consents.results ?? [],
    apps: apps.results ?? [],
    social_links: links.results ?? [],
  };
}
