// General privacy policy (/privacy), approved by the owner 2026-11-10; real-name wording added 2026-11-12 (owner approved, ADR 0020); ecosystem-App use of hidden data added 2026-11-13 (owner approved, ADR 0022). Separate from the Amway notice
// (/privacy/amway, src/web/privacy.ts). Do not edit the wording without the owner.
// Text is escaped when rendered; the token {{amway}} becomes a link to /privacy/amway.
import type { PrivacySection } from "./privacy";

export const POLICY_TITLE = "隱私權政策";
export const POLICY_UPDATED = "2026 年 11 月 13 日";

export const POLICY_SECTIONS: PrivacySection[] = [
  {
    heading: "1. 營運單位",
    paragraphs: [
      "本網站（id.hglobal1985.com，下稱「本網站」）由成就寰宇股份有限公司（顯示名稱 H-Global1985）營運，統一編號 80365086，地址：台北市建國北路二段 3 巷 15 號 4 樓之 2，聯絡信箱：hglobal1985@gmail.com。",
    ],
  },
  {
    heading: "2. 本網站的用途",
    paragraphs: ["本網站是 H-Global1985 的會員帳號中心。您可以用 Google 帳號登入，管理自己的基本資料，並用同一個帳號登入合作營運單位的網站或 app。"],
  },
  {
    heading: "3. 我們收集的資料",
    items: [
      "Google 登入資料：Google 帳號識別碼、Google 信箱與信箱是否已驗證、Google 大頭貼網址、名稱。我們只用 Google 帳號識別碼辨識您，不會用信箱或姓名合併帳號。我們不會取得您的 Google 密碼。",
      "您自己填寫的基本資料：例如顯示名稱、暱稱、真實姓名、頭像、座右銘、自我介紹、職業、公司、學歷、興趣、專長、聯絡信箱、手機、居住地區、生日。這些都由您自己選擇是否填寫。",
      "會員編號：系統會配發一組會員編號，您也可以自行設定。",
      "Amway 會員資料：只有在您勾選「我是Amway會員」並同意《Amway 會員資料之蒐集與跨系統利用告知》後才會收集，詳見{{amway}}。",
      "系統自動產生的資料：註冊國家（由註冊時的連線位置判斷，只記錄國家）、登入紀錄、站內通知，以及操作紀錄（用於安全與稽核，不含您的姓名、信箱與 Amway 欄位內容）。",
    ],
  },
  {
    heading: "4. 使用目的",
    items: [
      "提供登入與帳號管理。",
      "依您的設定顯示公開基本資料頁。",
      "在寰宇生態系內的 App 提供服務、處理報名與付款、顯示會員之間的資訊。",
      "讓您用同一個帳號登入合作營運單位的網站或 app，並依您的授權提供必要資料。",
      "會員資格審核、內容存取權限判斷、重複編號比對與夫妻綁定。",
      "辨識付費課程報名的繳款人並進行對帳（您填寫的真實姓名；由寰宇生態系內的 App 在報名付費課程與對帳時使用，不會顯示在公開頁）。",
      "防止冒用、維護系統安全。",
    ],
  },
  {
    heading: "5. 公開與分享",
    items: [
      "公開基本資料頁：頭像與會員編號一律公開；其他欄位由您自己設定是否公開。您設定的「公開／隱藏」只決定本網站對外公開頁顯示的內容。",
      "寰宇生態系內的 App：您註冊或登入的寰宇生態系 App（由成就寰宇股份有限公司營運或授權，並經本網站登記）為了提供服務、處理報名與付款、顯示會員之間的資訊，可以使用您的基本資料與 Amway 會員資料，包括您設定為「隱藏」的欄位，不需另外取得您的同意。這些 App 只會取得其功能所需的欄位，不得長期保存、不得提供給寰宇生態系以外的人；本網站會留下每次使用的紀錄（哪一款 App、哪些欄位、幾筆，不含內容）。",
      "合作營運單位：您用本網站帳號登入合作營運單位時，對方只會取得您授權的資料。Amway 會員資料以資格查詢方式提供，詳見{{amway}}。真實姓名預設不在公開頁顯示；寰宇生態系內的 App 使用您的資料，依上一點辦理。",
      "服務供應商：Google（登入驗證）、Cloudflare（網站與資料存放，伺服器可能位於台灣以外地區）。",
      "除上述情況與法令要求外，我們不會把您的個人資料提供給其他人，也不會出售。",
    ],
  },
  {
    heading: "6. Cookie",
    paragraphs: ["本網站只使用維持登入所必需的 Cookie，不使用廣告或追蹤用的 Cookie。"],
  },
  {
    heading: "7. 保存期間",
    items: [
      "帳號資料保存到您申請刪除帳號為止。",
      "取消勾選「我是Amway會員」滿 1 年，系統會自動刪除您的 Amway 資料。",
      "刪除帳號後，您的基本資料、編號、通知與角色都會移除，帳號會做匿名化處理。為了安全與稽核，操作紀錄會保留，但裡面不含您的姓名、信箱與 Amway 欄位內容。",
    ],
  },
  {
    heading: "8. 您的權利",
    paragraphs: ["依個人資料保護法第 3 條，您可以查詢或請求閱覽、請求製給複製本、請求補充或更正、請求停止蒐集處理利用、請求刪除。"],
    items: [
      "多數資料可以直接在「基本資料」頁修改。",
      "您也可以在「編輯基本資料」頁直接刪除帳號，按下確認後立即生效。",
      "其他請求請寄信至 hglobal1985@gmail.com。為避免他人冒用，刪除與重大異動需要您重新登入確認。",
    ],
  },
  {
    heading: "9. 安全措施",
    paragraphs: ["資料傳輸全程加密，並有存取權限控管；管理人員的操作都會記錄。"],
  },
  {
    heading: "10. 政策修改",
    paragraphs: ["本政策修改時會更新本頁的「最後更新」日期；重大變更會另外以站內通知告知。"],
  },
  {
    heading: "11. 聯絡我們",
    paragraphs: ["hglobal1985@gmail.com"],
  },
];
