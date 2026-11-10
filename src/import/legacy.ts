// Import of the 77 legacy members from the old site's `users` table (framework-free, unit tested).
// Owner decisions (2026-11-10):
// - Rank ladder = RANK_LADDER below, low to high; 「無」 = no rank.
// - All legacy members belong to the hglobal education system and count as reviewed.
// - Members without a Google subject are NOT imported.
// - All member fields move; 加入原因／留下原因／備註 are merged into 自我介紹; 天賦數字 becomes a read-only field;
//   legacy admins become super admins. 回聲 app data (upload rights, contributor flag, play count) and the old
//   site's internal counters are not imported.
// Output is SQL text; no values are ever written to logs. Real member data never goes into the repository.

import { validateFieldValue, getFieldDefinition, type FieldValue } from "../profile/definitions";

export interface LegacyUser {
  id: string;
  name: string | null;
  email: string | null;
  amwayId: string | null;
  phone: string | null;
  center: string | null;
  rank: string | null;
  approvedRank: string | null;
  rankApproved: number | null;
  rankAuditStatus: string | null;
  avatar: string | null;
  googleAvatar: string | null;
  joinReason: string | null;
  stayReason: string | null;
  notes: string | null;
  sponsor: string | null;
  platinumUpline: string | null;
  diamondUpline: string | null;
  birthDate: string | null;
  birthday: string | null;
  residence: string | null;
  motto: string | null;
  registerDate: string | null;
  isAdminUser: number | null;
  isBlocked: number | null;
  talentNumber: number | null;
  googleSubject: string | null;
}

export interface LegacyUplineName {
  kind: string; // 'diamond' | 'platinum'
  name: string;
}

/** Owner-confirmed ladder, low to high. Codes are stable (apps store them as min_rank). */
export const RANK_LADDER: [code: string, label: string][] = [
  ["r03", "3%"],
  ["r09", "9%"],
  ["r12a", "12%初階"],
  ["r12", "12%"],
  ["r15", "15%"],
  ["r15b", "15%銅章"],
  ["r18", "18%"],
  ["r21", "21%"],
  ["silver", "銀章"],
  ["gold", "金章"],
  ["platinum", "白金"],
  ["f_platinum", "創辦人白金"],
  ["ruby", "紅寶石"],
  ["f_ruby", "創辦人紅寶石"],
  ["sapphire", "藍寶石"],
  ["f_sapphire", "創辦人藍寶石"],
  ["emerald", "翡翠"],
  ["diamond_plus", "鑽石級以上"],
];
const RANK_BY_LABEL = new Map(RANK_LADDER.map(([c, l]) => [l, c]));
const NO_VALUE = new Set(["", "無", "-", "—"]);

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").normalize("NFC").trim();
  return NO_VALUE.has(t) ? null : t;
};

export interface ImportReport {
  imported: number;
  skippedNoGoogle: number;
  skippedDuplicateGoogle: number;
  invalidValuesDropped: Record<string, number>; // field key → count (never the values)
  unknownRanks: string[]; // rank labels (not personal data)
  superAdmins: number;
}

export interface Plan {
  sql: string[];
  report: ImportReport;
}

const q = (v: string | number | null): string => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

function taipei(d: Date): string {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().replace("Z", "+08:00");
}

function toDate(s: string | null): string | null {
  const t = clean(s);
  if (!t) return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (!m) return null;
  return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
}

function uuidLike(seed: string): string {
  // Deterministic member id from the legacy id, so re-running the import is idempotent.
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (const ch of seed) {
    h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
    h2 = Math.imul(h2 + ch.charCodeAt(0), 2246822519) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  const a = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h2, 3266489917) >>> 0);
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-7${a.slice(13, 16)}-8${a.slice(17, 20)}-${a.slice(20, 32)}`;
}

/** Builds the full import as SQL statements. `now` fixes timestamps; `randomNumber` assigns numbers to members without one. */
export function planImport(users: LegacyUser[], uplineNames: LegacyUplineName[], now: Date, randomNumber: (i: number) => string): Plan {
  const ts = taipei(now);
  const sql: string[] = [];
  const report: ImportReport = { imported: 0, skippedNoGoogle: 0, skippedDuplicateGoogle: 0, invalidValuesDropped: {}, unknownRanks: [], superAdmins: 0 };
  const drop = (k: string) => (report.invalidValuesDropped[k] = (report.invalidValuesDropped[k] ?? 0) + 1);

  // ---- options: ranks, centers, uplines ----
  RANK_LADDER.forEach(([code, label], i) =>
    sql.push(`INSERT INTO amway_options (field_key, value, label, sort_order, active) VALUES ('rank', ${q(code)}, ${q(label)}, ${(i + 1) * 10}, 1) ON CONFLICT (field_key, value) DO UPDATE SET label = excluded.label, sort_order = excluded.sort_order, active = 1;`),
  );
  const centers = [...new Set(users.map((u) => clean(u.center)).filter((x): x is string => !!x))].sort();
  const centerCode = new Map(centers.map((c, i) => [c, `center_${String(i + 1).padStart(2, "0")}`]));
  centers.forEach((c, i) =>
    sql.push(`INSERT INTO amway_options (field_key, value, label, sort_order, active) VALUES ('education_center', ${q(centerCode.get(c)!)}, ${q(c)}, ${(i + 1) * 10}, 1) ON CONFLICT (field_key, value) DO NOTHING;`),
  );
  const uplineCode = new Map<string, string>();
  for (const kind of ["platinum", "diamond"] as const) {
    const field = kind === "platinum" ? "upline_platinum" : "upline_diamond";
    const names = [...new Set(uplineNames.filter((u) => u.kind === kind).map((u) => clean(u.name)).filter((x): x is string => !!x))].sort();
    names.forEach((n, i) => {
      const code = `${kind === "platinum" ? "up" : "ud"}_${String(i + 1).padStart(2, "0")}`;
      uplineCode.set(`${field}:${n}`, code);
      sql.push(`INSERT INTO amway_options (field_key, value, label, sort_order, active) VALUES ('${field}', ${q(code)}, ${q(n)}, ${(i + 1) * 10}, 1) ON CONFLICT (field_key, value) DO NOTHING;`);
    });
  }

  const seenSubs = new Set<string>();
  let n = 0;
  for (const u of users) {
    const sub = clean(u.googleSubject);
    if (!sub) {
      report.skippedNoGoogle++;
      continue;
    }
    if (seenSubs.has(sub)) {
      report.skippedDuplicateGoogle++;
      continue;
    }
    seenSubs.add(sub);
    const id = uuidLike(`legacy:${u.id}`);
    const created = (() => {
      const d = toDate(u.registerDate);
      return d ? `${d}T00:00:00.000+08:00` : ts;
    })();
    const email = clean(u.email);
    const avatar = [clean(u.avatar), clean(u.googleAvatar)].find((x) => x?.startsWith("https://")) ?? null;
    const avatarSource = avatar ? (avatar === clean(u.avatar) ? "upload" : "google") : "none";
    const status = u.isBlocked === 1 ? "disabled" : "active";
    sql.push(
      `INSERT INTO members (id, google_sub, google_email, google_email_verified, display_name, registration_country, status, created_at, updated_at, avatar_url, avatar_source, amway_enabled)
VALUES (${q(id)}, ${q(sub)}, ${q(email)}, 0, ${q(clean(u.name)?.slice(0, 100) ?? null)}, 'TW', '${status}', ${q(created)}, ${q(ts)}, ${q(avatar)}, '${avatarSource}', 1)
ON CONFLICT (google_sub) DO NOTHING;`,
    );

    // ---- profile fields (validated with the same rules as the API) ----
    const bioParts = [
      clean(u.joinReason) && `加入原因：${clean(u.joinReason)}`,
      clean(u.stayReason) && `留下原因：${clean(u.stayReason)}`,
      clean(u.notes) && `備註：${clean(u.notes)}`,
    ].filter(Boolean) as string[];
    const bio = bioParts.length ? [...bioParts.join("\n")].slice(0, 1000).join("") : null;
    const fields: [string, FieldValue][] = [
      ["display_name", clean(u.name)],
      ["contact_email", email],
      ["phone", clean(u.phone)],
      ["birthday", toDate(u.birthday) ?? toDate(u.birthDate)],
      ["city", clean(u.residence)],
      ["motto", clean(u.motto)],
      ["bio", bio],
    ];
    for (const [key, raw] of fields) {
      if (raw === null) continue;
      const v = validateFieldValue(getFieldDefinition(key)!, raw, now);
      if (!v.ok || v.value === null) {
        drop(key);
        continue;
      }
      sql.push(`INSERT INTO profile_field_values (member_id, field_key, value, updated_at, updated_by_app) VALUES (${q(id)}, '${key}', ${q(JSON.stringify(v.value))}, ${q(ts)}, 'legacy_import') ON CONFLICT DO NOTHING;`);
    }
    if (typeof u.talentNumber === "number" && Number.isInteger(u.talentNumber) && u.talentNumber > 0 && u.talentNumber < 100) {
      sql.push(`INSERT INTO profile_field_values (member_id, field_key, value, updated_at, updated_by_app) VALUES (${q(id)}, 'talent_number', ${q(JSON.stringify(String(u.talentNumber)))}, ${q(ts)}, 'legacy_import') ON CONFLICT DO NOTHING;`);
    }

    // ---- member number: Amway id (TW) or a fresh random one ----
    const amwayId = clean(u.amwayId)?.toUpperCase().replace(/\s+/g, "") ?? null;
    let number = amwayId && /^[A-Z0-9-]{1,20}$/.test(amwayId) ? amwayId : null;
    if (amwayId && !number) drop("member_number");
    number ??= randomNumber(n);
    sql.push(`INSERT INTO member_numbers (member_id, position, country, number, updated_at) VALUES (${q(id)}, 0, 'TW', ${q(number)}, ${q(ts)}) ON CONFLICT DO NOTHING;`);

    // ---- Amway area: hglobal approved; reviewed rank; center; referrer; uplines ----
    const amway = (key: string, value: unknown) =>
      sql.push(
        `INSERT INTO amway_field_values (member_id, field_key, value, pending_value, status, value_approved, updated_at, reviewed_at, reviewed_by) VALUES (${q(id)}, '${key}', ${q(JSON.stringify(value))}, NULL, 'approved', 1, ${q(ts)}, ${q(ts)}, 'legacy_import') ON CONFLICT DO NOTHING;`,
      );
    amway("education_system", { option: "hglobal", custom_text: null });
    const rankLabel = clean(u.approvedRank) ?? (u.rankApproved === 1 || u.rankAuditStatus === "approved" ? clean(u.rank) : null);
    if (rankLabel) {
      const code = RANK_BY_LABEL.get(rankLabel);
      if (code) amway("rank", code);
      else if (!report.unknownRanks.includes(rankLabel)) report.unknownRanks.push(rankLabel);
    }
    const center = clean(u.center);
    if (center) amway("education_center", centerCode.get(center));
    const sponsor = clean(u.sponsor);
    if (sponsor) {
      if ([...sponsor].length <= 50) amway("referrer", sponsor);
      else drop("referrer");
    }
    for (const [field, raw] of [["upline_platinum", u.platinumUpline], ["upline_diamond", u.diamondUpline]] as const) {
      const name = clean(raw);
      if (!name) continue;
      const code = uplineCode.get(`${field}:${name}`);
      if (code) amway(field, { option: code, custom_text: null });
      else if ([...name].length <= 50) amway(field, { option: "other", custom_text: name });
      else drop(field);
    }

    if (u.isAdminUser === 1) {
      report.superAdmins++;
      sql.push(`INSERT INTO staff_roles (member_id, role, granted_at, granted_by) VALUES (${q(id)}, 'super_admin', ${q(ts)}, NULL) ON CONFLICT DO NOTHING;`);
    }
    sql.push(
      `INSERT INTO audit_log (id, occurred_at, actor_type, action, target_type, target_id, result, detail) VALUES (${q(uuidLike(`audit:${u.id}`))}, ${q(ts)}, 'system', 'legacy.import', 'member', ${q(id)}, 'success', '{"source":"echoes_db"}') ON CONFLICT DO NOTHING;`,
    );
    report.imported++;
    n++;
  }
  return { sql, report };
}
