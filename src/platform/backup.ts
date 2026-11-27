// 每週備份的規則（生態系統功能 weekly_backup，杜杜龍 2026-11-27）。不依賴框架，附單元測試。
// 中央備份自己的「永久資料」到 R2（bucket 的 backups/ 底下）。App 各自備份自己的資料，規則見串接指令三、18 (4)。
// 硬性規定：不含 Amway 資料、Token／密碼的雜湊、登入與暫存資料、頭像圖檔；備份檔只放 R2，不放公開程式庫。
import { taipeiParts } from "./error-digest";

/** 要備份的資料表與欄位（明確列出；新資料表預設不備份，要備份就加進來並更新測試）。 */
export const BACKUP_TABLES: Readonly<Record<string, readonly string[]>> = {
  members: ["id", "google_sub", "google_email", "google_email_verified", "display_name", "registration_country", "status", "avatar_source", "number_customized", "search_indexable", "created_at", "updated_at", "last_login_at"],
  member_numbers: ["member_id", "position", "country", "number", "updated_at"],
  member_apps: ["member_id", "app_id", "first_seen_at", "last_seen_at"],
  profile_field_values: ["member_id", "field_key", "value", "updated_at", "updated_by_app"],
  profile_visibility: ["member_id", "field_key", "visibility", "updated_at"],
  profile_layout: ["field_key", "sort_order", "updated_at", "updated_by"],
  social_platforms: ["key", "name", "sort_order", "builtin_icon", "custom", "created_at", "updated_at"],
  social_links: ["id", "member_id", "platform_key", "url", "label", "sort_order", "created_at"],
  spouse_bindings: ["id", "initiator_id", "partner_id", "created_at", "ended_at", "ended_by"],
  spouse_members: ["member_id", "binding_id"],
  consent_records: ["id", "member_id", "document", "version", "action", "occurred_at", "app_id"],
  staff_roles: ["member_id", "role", "granted_at", "granted_by"],
  staff_grants: ["member_id", "permission", "scope", "granted_at", "granted_by"],
  vocab_terms: ["pool", "norm", "term", "uses", "hglobal", "created_at", "updated_at"],
  rank_badges: ["value", "version", "width", "height", "art_top", "art_bottom", "updated_at"],
  registered_apps: ["app_id", "definition", "created_at", "created_by", "updated_at", "updated_by"],
  app_status_overrides: ["app_id", "status", "reason", "updated_at", "updated_by"],
  eco_features: ["feature_key", "settings", "updated_at", "updated_by"],
  eco_feature_apps: ["feature_key", "app_id", "participating", "updated_at"],
  audit_log: ["id", "occurred_at", "actor_type", "actor_id", "action", "target_type", "target_id", "result", "app_id", "request_id", "detail"],
};

export const BACKUP_PREFIX = "backups/";
/** 每個備份檔最多幾列（Worker 記憶體有限，大表分成多個檔）。 */
export const ROWS_PER_FILE = 5000;

/** 備份在設定的星期、台北 03:00～03:04 之間執行（排程每 5 分鐘醒一次）。 */
export function isBackupDue(weekday: number, now: Date): boolean {
  const p = taipeiParts(now);
  return p.weekday === weekday && p.hour === 3 && p.minute < 5;
}

export const backupFolder = (date: string): string => `${BACKUP_PREFIX}${date}/`;
export const BACKUP_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 從 R2 列出的資料夾名稱（backups/2026-11-29/）挑出該刪除的舊備份：只留最近 keep 份（依日期）。 */
export function backupsToDelete(folders: readonly string[], keep: number): string[] {
  const dates = folders
    .map((f) => f.slice(BACKUP_PREFIX.length).replace(/\/$/, ""))
    .filter((d) => BACKUP_DATE.test(d))
    .sort()
    .reverse();
  return dates.slice(Math.max(keep, 1)).map(backupFolder);
}

export interface BackupManifest {
  version: 1;
  created_at: string;
  tables: Record<string, { rows: number; files: string[] }>;
}

/** 備份內附的還原說明（放在每份備份的 README.txt）。 */
export function restoreReadme(date: string): string {
  return [
    `會員中心備份 ${date}`,
    "",
    "內容：每個資料表一組 NDJSON 檔（每行一列 JSON），manifest.json 列出所有檔案與列數；manifest.json 最後才寫入，沒有它代表這份備份不完整，不要使用。",
    "不含：Amway 資料、登入與授權的暫存資料、Token 與密碼的雜湊、頭像與自訂圖示的圖檔（頭像本來就在 R2 的 avatars/）。",
    "",
    "還原步驟（需杜杜龍核准；正式資料的還原不可自行動手）：",
    "1. 先在測試環境（staging）還原並驗證，確認會員數、管理員、App 登記都對。",
    "2. 依 manifest.json 的順序讀入各檔；每一列用 INSERT OR REPLACE 寫回同名資料表與同名欄位。",
    "3. 順序：members → member_numbers、member_apps、profile_*、social_*、spouse_*、consent_records、staff_* → vocab_terms、rank_badges → registered_apps、app_status_overrides、eco_* → audit_log。",
    "4. 還原後請所有會員重新登入（登入資料本來就不在備份裡）。",
    "5. Amway 專區資料不在備份內，需會員重新勾選與填寫。",
    "",
    "備份只存在 R2，不可放進公開程式庫、不可貼進對話或 Issue。",
  ].join("\n");
}
