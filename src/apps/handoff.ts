// "給開發 AI 的串接指令" generator (framework-free). The text carries only public values, never a key.
import type { AppEntry } from "./registry";

/**
 * Version of the instruction text. Bump both whenever the text below changes (a unit test fails until you do),
 * so the owner can tell at a glance whether the copy an App's AI received is the latest one.
 * Format: YYYY-MM-DD.N (the earlier hand-written transitional copy for app_id learn was 2026-11-10.1).
 */
export const HANDOFF_VERSION = "2026-11-10.2";
export const HANDOFF_UPDATED = "2026-11-10 18:30（台灣時間）";
export const HANDOFF_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/;

const REPO_RAW = "https://raw.githubusercontent.com/hglobal1985/id/main";
const GUIDE_URL = `${REPO_RAW}/docs/integration-guide.md`;
const OPENAPI_URL = `${REPO_RAW}/openapi/hglobal-id.v1.json`;

const list = (values: readonly string[]) => (values.length ? values.join("、") : "（無）");

/** True when `reported` is the current version (an App is up to date only on an exact match). */
export function isUpToDate(reported: string | null | undefined): boolean {
  return reported === HANDOFF_VERSION;
}

/**
 * The instruction the owner pastes to the AI that builds an App. `origin` is this central member system's
 * address (https://id.hglobal1985.com in production).
 */
export function buildHandoff(app: AppEntry, origin: string): string {
  const id = app.app_id;
  const web = app.web_origins[0] ?? `https://${id}.hglobal1985.com`;
  const deep = app.return_urls[0] ?? `${id.replace(/-/g, "")}://auth/google`;
  const lines = [
    `【串接指令版本 ${HANDOFF_VERSION}｜更新時間 ${HANDOFF_UPDATED}】`,
    `你是 H-Global1985 App「${app.name}」的開發者 AI。H-Global1985 中央會員系統（以下稱「中央會員」）已經替這款 App 登記完成，請照下面的資料串接。不需要、也不可以修改中央會員的程式碼、資料庫或設定。`,
    "如果這款 App 已經串接過：不要重做。請直接跳到「六、已串接 App 的更新檢查清單」，逐項檢查現有程式，只補上缺少或過時的部分，開 PR 後回報差異。",
    "",
    "【最重要的規則：每次更新，只補差異】已經串接過的 App 拿到新版串接指令時，禁止整份重做或重寫。先比對現有程式與新版指令，只改缺少或過時的部分；已經正常運作的程式一行都不要動。回報時只列「差異」：補了哪幾項、沒動哪些。",
    "",
    "## 一、已登記的資料（都不是秘密）",
    `- app_id：${id}（iOS、Android、網頁三個平台共用這一個）`,
    `- 名稱：${app.name}`,
    `- iOS Bundle ID：${app.ios_bundle_id ?? "（無）"}`,
    `- Android 套件名稱：${app.android_package ?? "（無）"}`,
    `- 網頁版來源（CORS 與登入回傳網址）：${list(app.web_origins)}`,
    `- App 深層連結回傳網址：${list(app.return_urls)}`,
    `- 這款 App 的權限範圍（scope）：${list(app.scopes)}`,
    `- 最低版本：${app.min_version}`,
    `- 中央會員網址：${origin}`,
    `- 驗證登記是否生效：GET ${origin}/v1/apps/${id}/config（應回傳 status 為 active）`,
    "",
    "## 二、先讀這兩份文件",
    `- 串接說明：${GUIDE_URL}`,
    `- API 契約（OpenAPI 3.1）：${OPENAPI_URL}（請用它產生型別，不要手寫；請容忍回應中多出的欄位）`,
    '- 所有 /v1 API 的錯誤格式固定為 {"error":{"code","message","request_id","details"}}，code 是小寫 snake_case；時間一律是 ISO 8601 並帶 +08:00。',
    "",
    "## 三、要完成的事",
    `1. 啟動檢查：App 啟動時、以及每次回到前景，呼叫 GET ${origin}/v1/apps/${id}/config。status 是 paused 顯示「維護中」；killed 停止使用並顯示說明；App 版本低於 min_version 要求更新。中央會員連不上時，不需要登入的畫面照常使用，需要登入或資格的功能一律拒絕。`,
    "2. 登入：只用中央會員，不要自己建立會員系統，也不要自己接 Google。App 不持有任何密碼或用戶端密鑰（沒有 client secret）。iOS、Android、網頁三個平台一律走「登入中繼」（瀏覽器登入），不要使用原生 Google 登入 SDK，這樣完全不必到 Google 後台為這款 App 做任何設定。目前登入方式只有 Google。",
    `   - 第 1 步：POST ${origin}/v1/auth/nonce，body {"app_id":"${id}"} → {"nonce","expires_in"}。nonce 單次有效、10 分鐘、綁定這款 App；原值只留在 App（網頁版放 sessionStorage，因為整頁跳轉後還要用）。`,
    `   - 第 2 步：開啟中繼網址 ${origin}/auth/google/start?app_id=${id}&nonce=<nonce 的 SHA-256 十六進位小寫>&return=<回傳網址>&state=<自己產生的隨機字串>。`,
    `   - iOS 與 Android：用系統的登入瀏覽器視窗開啟（Expo 用 expo-web-browser 的 openAuthSessionAsync），回傳網址用上面登記的深層連結 ${deep}，App 要宣告對應的 URL scheme。登入完成後回到 ${deep}?id_token=…&state=…（取消或失敗為 ?error=…&state=…）。`,
    `   - 網頁版：整頁導向中繼網址，回傳網址必須在登記的網頁版來源底下且不能帶 #（例如 ${web}/auth/done，路徑自訂）。登入完成後回到 <回傳網址>#id_token=…&state=…（失敗為 #error=…&state=…）；結果放在 # 之後，不會送到任何伺服器。讀取後立刻用 history.replaceState 清掉網址中的 #。`,
    "   - 沒登記過的回傳網址會被拒絕。需要增加回傳網址或網頁版來源時，回報業主到後台修改，不要自己想辦法繞過。",
    `   - 第 3 步：核對 state 與自己產生的相同，然後 POST ${origin}/v1/auth/google，body {"app_id":"${id}","id_token":"…","nonce":"<nonce 原值>","device_label":"<裝置名稱，選填>"} → {"token_type":"Bearer","access_token","expires_in","refresh_token","refresh_expires_in","scope","user":{"member_id","status","is_new"}}。交給 Google 的只有雜湊；攔截到回傳網址的人沒有 nonce 原值，無法登入。`,
    "   - Token：Access Token 15 分鐘，Refresh Token 30 天。手機把兩個 Token 存在系統安全儲存（Expo：expo-secure-store），不要放 AsyncStorage。網頁版 Access Token 只放記憶體，Refresh Token 放 sessionStorage，不要放 localStorage。",
    `   - 換發：每個請求帶 Authorization: Bearer <access_token>。收到 401 unauthenticated 時 POST ${origin}/v1/auth/refresh，body {"refresh_token"}，新的 refresh_token 要立刻覆蓋舊的。舊的再用一次會撤銷整個登入（401 refresh_reused），此時回到登入畫面。同一時間只讓一個請求執行換發（加鎖），避免並發換發被誤判為重用。403 app_unavailable 表示這款 App 被暫停，顯示維護畫面。429 rate_limited 依 Retry-After 稍後重試。`,
    `   - 登出：POST ${origin}/v1/auth/logout（帶 Access Token）結束這次登入，然後清除本機 Token。登出所有裝置與所有 App：POST ${origin}/v1/auth/logout-all。`,
    `3. 會員身分：只用登入回應的 user.member_id（也是 Access Token 的 sub）當會員的主鍵。不可以用信箱、姓名或會員編號辨識或合併會員；會員編號可能重複，也可能被會員修改。App 自己的資料庫只存 member_id 當外鍵，不複製會員主檔。`,
    `4. App 後端驗證會員：用 GET ${origin}/oauth/jwks 的公鑰驗證 Access Token（RS256，標頭 typ 為 at+jwt）：iss 必須是 ${origin}、aud 必須是 ${origin}、app_id 必須是 "${id}"、檢查 exp。快取 JWKS，遇到不認得的 kid 就重新抓取。需要即時確認停用或登出時，改用這個 Token 呼叫中央會員的任一 API（例如 GET ${origin}/v1/me/profile），401 就當作未登入。`,
    `5. 會員資料：GET ${origin}/v1/me/profile（需要 profile.read）讀取會員允許這款 App 看到的基本資料。會員要修改基本資料時，用瀏覽器開啟 ${origin}/me，不要在 App 內重做編輯畫面，也不要另存一份會員資料。`,
    "6. 資格查詢（哪些內容只給符合資格的會員看）：",
    `   - POST ${origin}/v1/eligibility/check，body {"rule":{"audience":"hglobal_verified"|"everyone","min_rank":"<獎銜代碼，選填，只能搭配 hglobal_verified>"}} → {"allowed":true|false,"reason":"…"}。列表頁一次查多筆用 POST ${origin}/v1/eligibility/check-batch，body {"rules":[…最多 50 筆]}，回傳 results 與 rules 順序相同。兩支都需要 amway.read。`,
    `   - 獎銜代碼不要寫死：一律從 GET ${origin}/v1/amway/field-definitions 取得（rank 欄位的選項，由低到高）。`,
    "   - Fail closed：查不到、逾時、非 200、連不上，一律當作「不符合資格」並拒絕，不可以放行，也不可以沿用過期的結果。",
    "   - 快取：查詢結果最多快取 1 日，只能放記憶體或短時效快取服務，不可以寫進 App 的資料庫或檔案；會員登出時清除。",
    "   - reason 只給 App 內部記錄用，絕對不要顯示給會員。不符合資格時只顯示一般的說明（例如「此內容需要符合資格才能觀看」）。",
    "7. Amway 資料不得被 App 保存：會員編號、獎銜、上手、資格查詢結果等 Amway 相關資料，App 與 App 後端都不可以寫入資料庫、檔案、日誌、分析工具或錯誤回報；需要時即時向中央會員查詢。日誌也不可以記錄 Token、信箱、姓名。",
    "8. 對會員顯示的文字：品牌只用 starry.phd、H-Global1985、Amway 這三個寫法，不要使用它們的中文名稱。畫面上不要提到其他系統的名稱，需要時一律寫「合作營運單位」。",
    `9. 隱私與刪除：設定頁放「隱私權政策」連結 ${origin}/privacy 與「完整隱私說明」${origin}/privacy/amway。App Store 與 Google Play 要求 App 內有刪除帳號入口：放一個按鈕用瀏覽器開啟 ${origin}/me，會員在那裡申請刪除。`,
    "10. 網頁版網址：每一頁都要有自己的網址路徑，用 History API 切換；重新整理、上一頁、分享網址都停留在同一頁。需要登入的頁面，未登入時先記下目前路徑，登入完成後導回原本那一頁（回傳網址必須在已登記的網頁版來源底下）。",
    "",
    "## 四、規則",
    "- 不要自行改用原生 Google 登入或舊的 OIDC（/oauth/authorize）流程；這款 App 不需要也不應持有 client secret。如果現有程式或 Worker 設定裡還有 HGLOBAL_ID_CLIENT_SECRET 之類的機密，改用本指令的登入方式後就不再讀取它，並回報業主（移除機密需要業主核准，不要自己刪）。",
    "- 不要在 App、Repo、日誌、Issue、PR 放任何 token、金鑰、.env、Cloudflare 帳戶 ID。機密只放 Workers Secrets、GitHub Actions Secrets 或 EAS Secrets，由業主自己設定，不要向業主索取密碼或請業主把金鑰貼進對話。",
    "- 每個請求都要在 App 後端驗證身分與權限；前端隱藏按鈕不算權限控制。",
    "- 下列事項必須先取得業主核准：付費方案或可能產生費用的操作、App Store／Google Play 送審與正式發布、正式環境部署、刪除或還原正式資料、刪除既有的 GitHub 或 Cloudflare 資源、建立新的雲端或商店帳號。",
    "- 需要業主親自登入 Google、Cloudflare 或商店後台時，停下來，把「要填什麼值、填在哪個頁面」一步一步寫清楚回報。",
    "",
    "## 五、完成後回報",
    `- 你依據的串接指令版本（目前最新是 ${HANDOFF_VERSION}；版本較舊請回報業主重新取得）。把這個版本寫成 App 內的一個常數，每次依新版指令更新完才改它。`,
    `- 回報版本給中央會員：超級管理員登入這款 App 後，由 App 呼叫 GET ${origin}/v1/apps/${id}/handoff?integrated=<採用的版本>（帶 Access Token；只有超級管理員、而且只有這款 App 自己的登入可以呼叫）。回應的 up_to_date 為 false 時，text 就是最新的串接指令：只補差異。`,
    "- 每個 PR 與 CI 結果、已部署的環境。",
    `- 用 GET ${origin}/v1/apps/${id}/config 驗證的結果。`,
    "- 還需要業主處理的事項清單（只列確實需要業主的）。",
    "",
    "## 六、已串接 App 的更新檢查清單",
    "逐項檢查，已符合的略過，只補缺少或過時的：",
    "1. 登入走登入中繼（三、2），沒有使用 client secret、原生 Google SDK 或 /oauth/authorize。",
    "2. 啟動與回到前景時讀取 config，依 status 與 min_version 處理（三、1）。",
    "3. 換發有加鎖，新的 Refresh Token 立刻覆蓋舊的；refresh_reused 與 invalid_refresh 回到登入畫面（三、2）。",
    "4. 會員主鍵只用 member_id（三、3）；App 後端以 JWKS 驗證並核對 iss、aud、app_id（三、4）。",
    "5. 資格查詢 fail closed、快取最長 1 日且不落地、獎銜代碼來自 field-definitions、reason 不顯示給會員（三、6）。",
    "6. 沒有保存任何 Amway 資料，日誌沒有 Token、信箱、姓名（三、7）。",
    "7. 對會員顯示的品牌與用語（三、8）；隱私權政策與刪除帳號入口（三、9）。",
    "8. 檢查完回報：每一項是「已符合」或「已補上（PR 連結）」，以及需要業主處理的事項。更新一律只補差異，不要重做已正常的部分。",
  ];
  return lines.join("\n");
}
