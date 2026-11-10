// 「完整隱私說明」: section 三 (full version) of 《跨系統資料互通：隱私同意文字（第二版）》, reviewed by an
// expert and adopted 2026-11-10. Only sections 二 (short, served by /v1/amway/consent) and 三 (this page) are
// published; the document's internal notes (differences, decisions, questions for the expert, reminders) are not.
// This page is separate from the general privacy policy. Do not edit the wording without the owner.

export const PRIVACY_VERSION = "2";
export const PRIVACY_TITLE = "Amway 會員資料之蒐集與跨系統利用告知";

export interface PrivacySection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    heading: "1. 蒐集者",
    items: [
      "資料保管單位：成就寰宇股份有限公司（顯示名稱 H-Global1985，下稱「H-Global1985」），統一編號 80365086，地址台北市建國北路二段 3 巷 15 號 4 樓之 2，聯絡信箱 hglobal1985@gmail.com。",
      "資料查詢單位：starry.phd（個人獨立開發，下稱「starry.phd」），聯絡信箱 starry.phd@gmail.com。",
    ],
  },
  {
    heading: "2. 蒐集目的",
    items: [
      "會員身分資格與權限管理。",
      "獎銜與教育體系之審核與驗證。",
      "依資格提供或限制內容與功能的存取。",
      "稽核與安全（例如防止冒用、記錄審核過程）。",
      "重複編號比對與夫妻綁定。",
    ],
  },
  {
    heading: "3. 個人資料類別",
    paragraphs: [
      "Amway 會員編號（可多組，含所屬國家）、教育體系與教育中心、獎銜與審核狀態、推薦人、上手皇冠大使／鑽石／白金資訊、夫妻綁定關係、審核與異動紀錄。另外包含您在基本資料中已提供之登入識別資料（以 Google 帳號識別碼綁定兩邊帳號）。",
      "本說明不包含醫療、健康、犯罪前科等特種個人資料。",
    ],
  },
  {
    heading: "4. 利用期間、地區、對象與方式",
    items: [
      "期間：自您同意起，至您取消勾選並提出刪除，或帳號終止後 1 年為止。法令要求保存者從其規定。",
      "地區：台灣；資料存放於雲端服務供應商之伺服器，可能位於台灣以外地區（目前使用 Cloudflare），已採取傳輸加密與存取控管。",
      "對象：H-Global1985、starry.phd，以及經您主動授權或因審核需要而參與的管理人員；另包括輸入相同編號的其他會員與您的綁定對象（僅限第 5 節所述內容）。",
      "方式：資料以資格查詢方式提供，starry.phd 僅在需要判斷您是否能存取特定內容時查詢，且只取得結果與必要資訊，不另行長期複製保存。查詢時效性快取最長 5 分鐘。",
    ],
  },
  {
    heading: "5. 重複編號比對與夫妻綁定",
    items: [
      "適用對象：所有會員，不限是否勾選「我是Amway會員」。每位會員都有「會員編號」，用於查找公開基本資料與售後服務。",
      "比對時機：會員儲存會員編號或 Amway 會員編號時。",
      "顯示內容：發現編號與其他會員重複時，向正在輸入的會員顯示對方的姓名、頭像與獎銜（對方若有已審核獎銜），並詢問是否綁定為夫妻。",
      "綁定效力：任一方單方同意即立即生效，不需對方確認；最多只能綁定一人；任一方可隨時解除。被綁定的一方會收到站內通知，並可一鍵解除。",
      "綁定後：雙方共用獎銜與編號，維持相同的公開基本資料網址，訪客可在該頁面切換查看兩人的基本資料；不共用上手資料，各自保留。",
      "解除後的處理：獎銜維持不變；主動提出解除的一方，其編號改為由系統隨機產生（國家代碼加 0 開頭的 7 位隨機數字），另一方維持原編號。例外：若主動解除的一方是被對方綁定的那一方，則改由發起綁定的一方換成隨機編號，主動解除者維持原編號。",
    ],
  },
  {
    heading: "6. 您的權利",
    paragraphs: [
      "依個人資料保護法第 3 條，您可以：查詢或請求閱覽、請求製給複製本、請求補充或更正、請求停止蒐集處理利用、請求刪除。",
      "行使方式：寄信至 hglobal1985@gmail.com，我們會在 15 日內處理。為避免他人冒用，刪除與重大異動需經您重新登入驗證確認。",
    ],
  },
  {
    heading: "7. 不同意或不提供的影響",
    paragraphs: ["您可以選擇不勾選「我是Amway會員」。不提供這些資料不影響您使用一般功能，但需要 Amway 會員資格的內容與功能將無法使用。"],
  },
  {
    heading: "8. 資料正確性與責任",
    paragraphs: ["獎銜與教育體系為會員自行填寫，以經審核通過者為準。提供不實資料者，管理人員得駁回或暫停資格。"],
  },
];
