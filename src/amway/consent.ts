// Consent text for the Amway area: 《跨系統資料互通：隱私同意文字（第二版）》, section 二 (short version),
// reviewed by an expert and adopted 2026-11-10. Internal notes of that document are never shown to members.
// Apps must render this text from GET /v1/amway/consent and never hard-code it.

export const CONSENT_DOCUMENT = "amway_data_sharing";
export const CONSENT_VERSION = "2";

export const CONSENT_SHORT = {
  title: "提供 Amway 會員資料並同意授權查詢",
  intro:
    "為了讓您使用需要 Amway 會員資格的內容與功能，您將提供下列資料：Amway 會員編號（可多組）、教育體系、教育中心、獎銜、推薦人、上手相關資訊。",
  items: [
    "這些資料會儲存在由 H-Global1985 營運的會員系統，用於確認您的身分資格與獎銜，並由 starry.phd 的服務在需要時查詢您是否符合資格。",
    "查詢只會取得「是否符合」的結果與必要的獎銜資訊，不會取得其他個人資料。",
    "部分資料（教育體系為「寰宇」者）需由管理人員審核，審核通過前不會生效。",
    "您可以新增多組編號（最多 50 組，可屬不同國家）；第一組會作為您公開基本資料的網址與客服識別碼。",
    "如果您輸入的編號與其他會員重複，系統會顯示對方的姓名、頭像與獎銜，詢問是否綁定為夫妻。您同意綁定即立即生效，不需對方確認；綁定後雙方共用獎銜與編號，不共用上手資料；任一方可隨時解除。",
    "您可以隨時取消勾選。取消後，您的資格會暫停，服務不會再查詢這些資料。",
    "您可以查詢、更正、請求停止使用或刪除這些資料，方式見下方「您的權利」。",
  ],
  checkbox_label: "我已閱讀並同意以上內容",
  full_privacy_label: "完整隱私說明",
  full_privacy_path: "/privacy/amway",
} as const;
