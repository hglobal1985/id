// The member data an App can be allowed to use (ADR 0022): every profile field and every Amway field, hidden or not,
// plus the avatar and the public member number. Pure data (no database).
import { fieldDefinitions } from "../profile/definitions";
import { AMWAY_FIELDS } from "../amway/fields";

export interface DataFieldOption {
  key: string;
  label: string;
  group: "基本資料" | "學歷" | "聯絡與地區" | "生日" | "Amway 專區" | "其他";
}

const GROUP: Record<string, DataFieldOption["group"]> = { basic: "基本資料", education: "學歷", contact: "聯絡與地區", birthday: "生日" };

export const MEMBER_DATA_FIELDS: readonly DataFieldOption[] = [
  { key: "avatar", label: "頭像", group: "其他" },
  { key: "member_number", label: "會員編號（公開網址代碼）", group: "其他" },
  ...fieldDefinitions().map((f) => ({ key: f.key, label: f.label, group: GROUP[f.group] ?? ("其他" as const) })),
  ...AMWAY_FIELDS.map((f) => ({ key: f.key, label: f.label, group: "Amway 專區" as const })),
];

export const MEMBER_DATA_KEYS: readonly string[] = MEMBER_DATA_FIELDS.map((f) => f.key);
/** Why an App reads other members' data: 處理＝only inside the App's own server; 顯示＝shown to other members in the App. */
export const DATA_USES = ["process", "display"] as const;
