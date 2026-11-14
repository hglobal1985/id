// "給開發 AI 的串接指令" generator (framework-free). The text carries only public values, never a key.
import type { AppEntry } from "./registry";

/**
 * Version of the instruction text. Bump both whenever the text below changes (a unit test fails until you do),
 * so the owner can tell at a glance whether the copy an App's AI received is the latest one.
 * Format: YYYY-MM-DD.N (the earlier hand-written transitional copy for app_id learn was 2026-11-10.1).
 */
export const HANDOFF_VERSION = "2026-11-14.4";
export const HANDOFF_UPDATED = "2026-11-14 23:00（台灣時間）";
export const HANDOFF_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d{1,3}$/;

const REPO_RAW = "https://raw.githubusercontent.com/hglobal1985/id/main";
const GUIDE_URL = `${REPO_RAW}/docs/integration-guide.md`;
const OPENAPI_URL = `${REPO_RAW}/openapi/hglobal-id.v1.json`;
const DESIGN_URL = `${REPO_RAW}/docs/design-standard.md`;

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
    "## 二、先讀這三份文件",
    `- 串接說明：${GUIDE_URL}`,
    `- API 契約（OpenAPI 3.1）：${OPENAPI_URL}（請用它產生型別，不要手寫；請容忍回應中多出的欄位）`,
    `- 視覺規範（顏色、字體、方框、九宮格的標準，含 React Native 的 theme 範本）：${DESIGN_URL}。畫面一律照它做，顏色只用裡面列的，不要自己加色或寫死色碼。`,
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
    "   - 共用登入（單一登入，必做）：所有 H-Global1985 App 的登入狀態共用——在任一款 App 登入，同一支手機上的其他 H-Global1985 App 自動登入；登出或換會員，所有 App 跟著變。登出按鈕文字請寫「登出所有 App」。",
    `   - 共用登入（手機）：登入成功後 POST ${origin}/v1/auth/sso/start（帶 Access Token；body 可帶 {"previous_sso_token":"<共用儲存裡原有的>"}）→ {"sso_token"}，存進所有 H-Global1985 App 共用的儲存。iPhone（必做）：Keychain 群組固定為 $(AppIdentifierPrefix)com.hglobal1985.shared，鍵名 hglobal.sso（同一個 Apple 開發者帳號即可，業主不必在 Apple 後台另外設定；在專案的 keychain-access-groups 加上這個群組，並用支援 access group 的鑰匙圈套件）。Android 為選做，目前請略過，不要為此阻擋上架。App 啟動與每次回到前景：共用儲存裡有 sso_token 而自己還沒登入 → POST ${origin}/v1/auth/sso/exchange {"app_id":"${id}","sso_token","device_label"}（回應與 Google 登入相同）；自己已登入 → POST ${origin}/v1/auth/sso/status {"sso_token"} → {"active","member_id"}，active 為 false 或 member_id 與自己不同就清除本機 Token（不同會員時再用 exchange 換成新會員）。登出：POST ${origin}/v1/auth/sso/logout {"sso_token"}（登出這支裝置上所有 App，可重複呼叫），再清除共用儲存與本機 Token。401 invalid_sso 表示共用登入已失效：清掉共用儲存，回到登入畫面。`,
    `   - 共用登入（網頁版，同一個瀏覽器內連動）：瀏覽器不能跨網站共用儲存，改由中央會員記住這個瀏覽器，用整頁導向詢問。（1）登入完成後：POST ${origin}/v1/auth/sso/start → POST ${origin}/v1/auth/sso/web-code {"sso_token"} → {"code"}（單次、2 分鐘）→ 整頁導向 ${origin}/auth/sso/adopt?c=<code>&app_id=${id}&return=<回傳頁>，回到 <回傳頁>#sso_adopted=1。（2）每次載入頁面（自己加 5 分鐘節流）：先 POST /v1/auth/nonce 取得 nonce 並存 sessionStorage，整頁導向 ${origin}/auth/sso/check?app_id=${id}&nonce=<SHA-256 十六進位小寫>&return=<回傳頁>&state=<隨機字串> → 回到 <回傳頁>#sso_code=…&sso_member=…&state=…（沒人登入是 #sso_none=1&state=…）。核對 state；sso_member 與目前登入的會員相同就不用動；不同或尚未登入就 POST ${origin}/v1/auth/sso/web-exchange {"app_id":"${id}","code":"<sso_code>","nonce":"<原值>"}（回應與 Google 登入相同）；收到 sso_none 而自己是登入狀態就登出。（3）登出：清除本機 Token 後整頁導向 ${origin}/auth/sso/logout?app_id=${id}&return=<回傳頁>，會登出這個瀏覽器所有 H-Global1985 網頁版。回傳頁必須在登記的網頁版來源底下、不能帶 #；讀完 # 之後的結果立刻用 history.replaceState 清掉。限制：網頁版只在同一個瀏覽器內連動，手機 App 與網頁版之間不連動；網頁版在下一次載入頁面時才會跟上登出或換人。`,
    `3. 會員身分：只用登入回應的 user.member_id（也是 Access Token 的 sub）當會員的主鍵。不可以用信箱、姓名或會員編號辨識或合併會員；會員編號可能重複，也可能被會員修改。App 自己的資料庫只存 member_id 當外鍵，不複製會員主檔。`,
    `4. App 後端驗證會員：用 GET ${origin}/oauth/jwks 的公鑰驗證 Access Token（RS256，標頭 typ 為 at+jwt）：iss 必須是 ${origin}、aud 必須是 ${origin}、app_id 必須是 "${id}"、檢查 exp。快取 JWKS，遇到不認得的 kid 就重新抓取。需要即時確認停用或登出時，改用這個 Token 呼叫中央會員的任一 API（例如 GET ${origin}/v1/me/profile），401 就當作未登入。`,
    `5. 會員資料（App 內原地修改）：GET ${origin}/v1/profile/field-definitions 取得欄位定義，GET ${origin}/v1/me/profile 取得會員目前的值；每個欄位用 PUT ${origin}/v1/me/profile/fields/<field_key>（body {"value":…}，null 清除）單獨儲存，公開／隱藏用 PUT ${origin}/v1/me/profile/visibility。這款 App 能呼叫哪些功能由業主在後台核准（見三、11 最小權限）。畫面請完全依欄位定義產生，不要寫死欄位、名稱或選項；不認得的欄位類型顯示「請更新 App」。編輯方式（平台標準，業主 2026-11-13）：不要有每個欄位各自的「編輯」按鈕；所有欄位一進頁面就是可編輯狀態（下拉選單直接顯示、文字欄位有編輯外框），改了不會自動儲存，欄位旁只顯示「尚未儲存」，要按浮動的「儲存」鈕才一次存全部（依頁面由上到下的順序逐欄呼叫 PUT；獎銜要等系統與中心存好，所以放在後面；有失敗的欄位要在欄位下方顯示原因並停留在頁面，全部成功才回到自己的頁面）。頁面上方三顆按鈕「分享公開頁｜儲存｜預覽」浮動固定（檢視模式同樣位置，中間那顆文字改成「編輯」，編輯與儲存二選一），頁面內容從按鈕下方穿過；所有「編輯」「儲存」按鈕用同一組黃色系、顏色反向（視覺規範有色碼）：儲存＝#f2dc27 實心填滿＋淡色外框 #e6c48c＋深色字；編輯＝淺色填滿 #fdf0e3＋亮色外框 #f2dc27；不是綠色。離開頁面時如果還有沒存的變更，要提醒。生日：年、月、日三個都選好的當下就重畫生命靈數（用 GET ${origin}/v1/profile/life-chart?birthday=YYYY-MM-DD 取預覽，不會儲存），按「儲存」才真的寫入；日期沒選完整就不能儲存。聯絡信箱欄位一開始預設帶入會員自己的 Google 信箱（GET /v1/me/profile 的 info.google_email），會員按「儲存」就存入。直銷商培訓系統與地區教育中心是下拉選單（選項來自 GET /v1/vocab/suggestions?pool=education_system 或 education_center，q 留空就回完整清單；中心的清單只在所選系統是 GET /v1/me/amway 的 hglobal_systems 其中之一時使用，否則是一般輸入框），最後一個選項是「其他」，選了就出現可自訂文字的輸入框；「無」是和輸入框或下拉選單並排在同一行的勾選框：系統、中心的「無」存成文字「無」；獎銜的「無」存成選項代碼 none，且不放在下拉選單裡。系統與中心都還沒有值（也沒勾「無」）時，獎銜的下拉選單與「無」勾選框要停用並提示先填系統與中心。座右銘輸入框高度是兩行。已經人工審核通過的欄位（地區教育中心、獎銜）被會員改了新的值時，欄位下方要立刻顯示橘色提示「變更已審核欄位，需重新等待人工審核」（改回原值就收起；中心改成「無」不用審核，所以不顯示）。必填欄位（暱稱；勾選 Amway 會員後的系統、中心、獎銜）在標題旁有橘色「必填」標籤（欄位已經有值就隱藏；地區教育中心與獎銜一旦經人工審核通過，同一個位置改顯示同外觀同配色的「審核通過」標籤，會員改了值就隱藏）（字 #cc6c0c、底 #fdf0e3、邊 #e6c48c，全圓角，.84 rem 粗體；色碼與未填時的 2 px 橘框見視覺規範）；按「儲存」時如果有必填欄位沒填，什麼都不存，畫面自動捲到第一個沒填的必填欄位、用橘色框標示所有沒填的，並提示欄位名稱。`,
    "   - 欄位型態：text、textarea、url、email、phone、date 用一般輸入框；tags 是多項輸入（行業與工作、職稱、公司／單位、興趣與專長、使用語言），值是文字陣列；select 是固定選項；country（居住國家／地區）是手動輸入並從建議中選擇。每個欄位旁都要有「公開／隱藏」切換（眼睛圖示），聯絡與地區、生日、Amway 欄位預設全部隱藏。",
    `   - 關聯詞：定義裡有 suggest 的欄位（行業與工作、職稱、公司／單位、興趣與專長、大學／碩士／博士的校名與系名、直銷商培訓系統、上手鑽石、上手白金、皇冠大使）是「直接打字＋關聯詞」：會員自由輸入，輸入時呼叫 GET ${origin}/v1/vocab/suggestions?pool=<suggest>&q=<已輸入的字> 顯示建議（只要包含輸入的任一個字就會出現，不分順序），點選後填入；不用強迫會員一定要選。推薦人沒有關聯詞。`,
    "   - 電腦版的 Enter 鍵：電腦（滑鼠加鍵盤）上輸入法選字要按 Enter，所以所有可自訂輸入的欄位（行業與工作、職稱、公司、興趣與專長、大學系名、地區教育中心…）按 Enter 都不要有任何動作（不送出、不確認標籤、不選建議）；用逗號等符號、空格、點選建議、按「儲存」來完成。手機上才保留 Enter 確認標籤。輸入法組字中（isComposing）也不要處理分隔符號。",
    `   - 職稱（2026-11-14 新增，欄位 job_title；2026-11-14.4 起改為多項 tags，與「行業與工作」「公司／單位」「興趣與專長」同一種自動標籤格式）：基本資料區塊，順序在「行業與工作」之後、「公司／單位」之前；最多 10 項、每項最長 50 字、預設公開、寫入範圍 profile.basic.write。輸入時遇到逗號、頓號等分隔符號或空白（電腦版不用 Enter）就確認一項變成可移除的標籤；輸入時用 GET ${origin}/v1/vocab/suggestions?pool=job_title&q=<已輸入的字> 顯示關聯詞（定義裡的 suggest 就是 "job_title"），可點選也可自己打。值是文字陣列：寫入走 PUT ${origin}/v1/me/profile/fields/job_title，body {"value":["經理","講師"]}；讀取在 GET ${origin}/v1/me/profile 的 fields.job_title.value。若 App 先前把職稱當成單一文字，請改成 tags 並容忍舊的文字值（顯示時當成一項）。會員輸入過的職稱自動進入關聯詞庫，由業主在後台「詞庫」編輯、合併、刪除（會連帶更新所有會員已存的職稱，App 不用處理）。畫面照欄位定義產生，標籤用定義的 label，不要寫死。「職業」欄位已改名為「行業與工作」（欄位代碼 occupation 不變），標籤同樣跟著欄位定義。`,
    `   - 多項欄位（tags）：輸入時遇到 , ; : - # * / \\ ' ， 、 ； ： 。 . 或空白字元或按 Enter，就確認為一個項目（變成可移除的標籤）。`,
    "   - 頭像區：上傳圖片、Google頭像、移除頭像三個按鈕排成一整列，放在頭像正下方（再下面才是社群連結圖示列）。會員編號欄位的「公開網址」最左邊放一個超大的分享按鈕，呼叫手機的原生分享選單（navigator.share，不支援時複製連結）；按鈕圖示依裝置不同：iPhone／iPad 用方框加向上箭頭，Android 用三點相連的分享符號（符合各平台原生圖示）。",
    "   - 生日欄位（date 型態）：不要用日期選擇器或年曆，改成年、月、日三個各自獨立的自訂下拉選單並排一列；月份顯示阿拉伯數字加英文縮寫（1 Jan、2 Feb … 12 Dec）；欄位說明不再寫「格式：YYYY-MM-DD」。",
    "   - 生日與生命靈數是同一個區塊（block 是 birthday）：區塊大標題寫成「xxx生命靈數 x年x月x日」（沒有「的」、沒有括號，生命靈數與日期之間一個空格），xxx 是暱稱，年月日是會員的生日（例如「小美生命靈數 1985年7月3日」）；標題強制一行不換行，字太多就自動縮小字體；會員把生日設為隱藏時，對外只寫「xxx生命靈數」，不要露出日期。檢視畫面不要再另外顯示「生日」列和「生命靈數」小標題（日期已在大標題）；只有編輯畫面保留生日輸入欄。GET /v1/profile/field-definitions 的 blocks 只有 avatar、amway、basic、education、contact、birthday 六個，依 order 排列。",
    `   - 社群連結（取代原本的「個人網站」欄位，一律顯示）：名片照片下方一列置中的小圖示，每列 5 個；圖示總數超過兩排時改縮小，每列 7 個。最後一個是「＋」圖示，下方寫「新增連結」。每個圖示下方有「複製」小標籤（複製該網址），點圖示在新視窗開啟連結。可選平台與圖示由 GET ${origin}/v1/social/platforms 取得（順序與圖示由後台決定，不要寫死；custom 為 true 的是「自定義」）；GET／POST ${origin}/v1/me/social-links（body {"platform_key","url","label"?}，網址沒打 http:// 或 https:// 時由中央補上 https://、打了就照會員輸入的保留（只收這兩種開頭），最多 30 個，同一平台可重複新增）、DELETE ${origin}/v1/me/social-links/{id}；「自定義」連結可用 PUT ${origin}/v1/me/social-links/{id}/icon 直接送圖片位元組（先縮成約 64 px 的小圖，不超過 16 KB）。`,
    "   - 審核規則：選「直銷商培訓系統」＝寰宇不需審核，立刻生效。只有「寰宇＋同時填了地區教育中心」時，「中心」與「獎銜」才需審核：送出後欄位 status 為 pending（顯示「等待審核中」），原本的值維持有效，由相同中心的審核員核准後才換成新值；駁回則維持原值。App 只顯示 status，不要自己判斷。",
    "   - 本名（2026-11-14 起標籤由「本姓」改稱「本名」，舊稱「真實姓名」，欄位 legal_name，基本資料區塊，預設隱藏；欄位旁備註「（窗口對賬用途）」）：只用於付費課程報名與對帳，不要顯示在公開畫面。要辨識繳款人時，只在「報名付費課程」與「對帳」的當下，用會員本人的 Access Token 呼叫 GET /v1/me/profile 讀 fields.legal_name.value；沒有填就請會員到中央會員的編輯頁填寫，不要在 App 內另建一份姓名欄位，也不要把它存進 App 的資料庫、日誌或分析工具（對帳需要留存時只留訂單與 member_id 的對應，姓名每次現讀）。舊的 primary_name 已永久刪除，不會恢復。",
    "   - 獎銜「無」：獎銜選項（含「無」）一律來自 GET /v1/amway/field-definitions 的 rank.options，不要自己複製或寫死。會員的值在 GET /v1/me/amway 的 fields.rank.value：null（從未填寫）與 \"none\"（選了「無」）兩種都代表「無」，App 要一視同仁；各 App 對「無」要顯示什麼文字由該 App 自己決定，不要回寫中央會員。",
    `   - 會員資料的使用範圍（業主 2026-11-13 決定）：會員的「公開／隱藏」開關只管對外的公開頁，**不限制寰宇生態系內的 App**。業主在後台「平台設定」替這款 App 勾選可使用的欄位（含會員設為隱藏的，所有基本資料與 Amway 欄位都可以勾），不必再問會員。App 用 POST ${origin}/v1/apps/<app_id>/members/lookup 讀取（服務 Token；{"member_ids":[最多 50 個],"fields":["欄位代碼"],"use":"process 或 display"}），只能讀在這款 App 登入過的會員、只能讀被勾選的欄位（沒勾回 403 field_not_allowed）；use=process 是只在你們伺服器內處理，use=display 是顯示給生態系內其他會員看。限制：只取功能需要的欄位；只放記憶體或必要的短暫快取，不長期保存、不寫日誌與分析工具；不可轉給寰宇生態系以外的任何人；需要審核的 Amway 欄位（獎銜、中心）只有已審核的才會回傳；對外公開頁（不屬於生態系的訪客）仍然只顯示會員設為公開的欄位。中央每次讀取都有稽核（App、筆數、欄位名稱、用途；不含內容）。會員本人在 App 內看自己的資料，仍用會員自己的 Token 讀 GET /v1/me/profile、GET /v1/me/amway。`,
    "   - 測試環境：正式前一律用 staging（https://hglobal-id-staging.hglobal1985-static.workers.dev，兩個環境的會員、簽章金鑰、App 登記各自獨立）。網頁版來源只能登記 https 網址、回傳網址只能是自訂 scheme，所以 http://localhost 不能登記；手機用 Expo dev build 搭配已登記的深層連結，網頁用 https 預覽網址（請業主通知中央會員在 staging 補登記）。測試版 App 的共用登入鍵名建議用 hglobal.sso.staging，避免與正式版互相覆蓋。",
    "   - 深色模式：跟隨系統設定自動切換。配色以視覺規範 1.5 的深色色表為準；經業主明確核准保留自己配色的 App（目前：行動大學）除外，仍須跟隨系統、對比至少 4.5:1。",
    "   - 一律公開的欄位（暱稱、居住國家／地區、生命靈數九宮格，以及會員編號、頭像）：沒有填寫就不顯示；欄位定義的 visibility.configurable 為 false，畫面上仍顯示和其他欄位一樣的圓角方框與眼睛圖案「公開」，但不能按（沒有切換）；PUT /v1/me/profile/visibility 對這些欄位回 422 always_public。所有 Amway 欄位（直銷商培訓系統、地區教育中心、獎銜、推薦人、上手、皇冠大使）都有公開／隱藏切換，預設值看欄位定義的 visibility.default（皇冠大使預設隱藏，其餘預設公開）。暱稱欄位已刪除。",
    "   - 勾選「我是Amway會員」後，直銷商培訓系統、地區教育中心、獎銜三欄都是必填：系統與中心旁各有一個「無」勾選框，勾了就送出值 \"無\"（算已填，不審核、不顯示方框、不影響資格）；獎銜要等系統與中心都有值（或為無）才能送出，否則 PUT /v1/me/amway/fields/rank 回 422 invalid_field（reason system_center_required）。畫面上三欄標示「（必填）」，缺的時候提示請填寫。",
    "   - 名字旁的方框：名字右邊依序顯示「系統」（直銷商培訓系統）、「中心」（地區教育中心）、「獎銜」（只顯示已審核的，「創辦人」三個字改寫成 F）三個小方框，只在勾選「我是Amway會員」且有填寫時出現；GET /v1/me/profile 的 badges 已算好文字與字級（size 0–3，字多自動縮小到固定五個中文字寬）；訪客看到的公開頁，被隱藏的欄位就沒有對應方框。系統方框直接顯示會員填的詞（例如「寰宇」）。頁首名字固定一行顯示，字多時自動縮小字級；「會員編號」文字加國碼的完整編號（例如 TW9475831）也固定在同一行。",
    "   - 學歷：大學、碩士、博士各一列，每列「校名＋系名」放在同一行，只顯示「大學」「碩士」「博士」三個名稱（不要顯示欄位全名）。碩士、博士預設整列隱藏：大學列下方放「新增碩士學歷」按鈕，按了才顯示碩士列；有碩士列才出現「新增博士學歷」。已經有資料的列一律顯示。欄位定義的 row 資訊（key、label、optional_after）就是用來分列的。",
    "   - 會員編號（member_number）與公開網址：公開網址是 ${origin}/<國碼二碼緊接編號>，例如 TW9475831（二碼國碼＋編號，中間沒有空格）；欄位值的 country、number 組成這個代碼（編號本身已含國碼的不重複加）。國家選單照欄位定義 options 的順序（台灣、鄰近國家，其餘依國際電話區碼）。尚未勾選「我是Amway會員」時，欄位旁顯示「隨機產生，不可修改」且不提供編輯；勾選後改顯示「建議修改會員編號」並可編輯（文字取自 GET /v1/me/profile 的 member_number.note；會員自己改過一次編號後，note 就永久消失，不再提醒）。每次取消勾選「我是Amway會員」，系統會重新隨機產生一組編號（國碼＋0 開頭的 7 位亂數，不夠用時自動加位數），PUT /v1/me/amway/enabled 的回應帶 member_number；取消勾選時若已綁定夫妻會先解除綁定。",
    `   - 勾選「我是Amway會員」：PUT ${origin}/v1/me/amway/enabled {"enabled":true|false}，打勾或取消立即生效，不要有二次確認，也沒有同意畫面或隱私說明確認頁；打勾後立刻顯示 Amway 欄位（GET ${origin}/v1/amway/field-definitions 與 GET ${origin}/v1/me/amway），每個 Amway 欄位也有「公開／隱藏」切換。「地區教育中心」（education_center）永遠顯示、是自由輸入的文字；只有 GET /v1/me/amway 的 hglobal 為 true（直銷商培訓系統填了代表 H-Global1985 的詞，例如「寰宇」）時，才依欄位定義的 suggest_when_hglobal 顯示專屬清單：點進欄位不用打字就直接列出整份清單（GET /v1/vocab/suggestions?pool=education_center&q= 空字串回傳全部），打字時自動篩選；這個「點開就顯示全部」的規則只適用地區教育中心，不要套用在其他欄位。不是寰宇的話維持純文字、不要有任何關聯詞。`,
    `   - 其他：座右銘欄位要有「隨機提案」按鈕（GET ${origin}/v1/profile/suggestions/motto，只填入輸入框，由會員自己儲存）；頭像用 POST ${origin}/v1/me/profile/avatar 直接送圖片位元組（先縮成約 256 px 的方形 JPEG，不超過 128 KB），或 POST ${origin}/v1/me/profile/avatar/google 使用 Google 頭像；生日設定後 GET /v1/me/profile 的 life_chart 提供生命靈數九宮格的繪圖資料。每個欄位的編輯按鈕，在編輯狀態要原地變成「磁碟片圖示＋儲存」。`,
    "   - 【畫面控制項規則】整個資料頁不要使用瀏覽器或系統原生的下拉選單（select／Picker）與原生勾選框（checkbox），一律用自訂元件：下拉用自訂的彈出清單（可搜尋），勾選用和文字同樣大小的自訂方框（打勾圖示與文字等高），建議清單與多項輸入也都是自訂元件。不要為了省事改回原生控制項。",
    "   - 【視覺規範】以手機閱讀舒適度優先排版：單欄、觸控區域至少 44 px、亮色系為主、深色模式跟隨系統自動切換（顏色表見視覺規範 1.5，App 的 dark 色階要與它一致；不使用星空特效）。顏色、字體、圓角、方框、按鈕、名字旁方框、九宮格的標準全部寫在視覺規範文件，要點：背景暖白 #f8f6ef、卡片白底 1 px #e2dfd2 邊線 16 px 圓角、主色深綠 #0c603c（按下 #094a2e、淺綠底 #e7f1ea）、橘 #cc6c0c、危險 #b3261e；系統字型 16 px 行高 1.65；按鈕與輸入框 10 px 圓角、高度至少 40／44；名稱與標籤用全圓角；名字旁的系統／中心／獎銜方框在頁首寬度隨文字、字級固定 .78 rem 不縮小（主選單內才縮小）；會員編號不加框，與「會員編號」文字同一行同字體。",
    `   - 頭像上傳：選好圖片後先出現裁切視窗（圓形範圍，可拖曳移動、縮放），按「使用這張」才縮成約 256 px 方形 JPEG 上傳。置頂按鈕列固定三格：自己的頁面是「編輯｜分享｜預覽公開頁」，編輯畫面是「上一頁｜分享｜預覽公開頁」，位置與高度一致；分享一律分享公開網址（${origin}/<代碼>）。`,
    `   - 社群連結的名稱：圖示下方的名稱框固定兩行高，字多自動縮小到放得下；名稱預設是平台名稱，會員新增時可自訂（label，最多 30 字，例如「健管」）。在編輯畫面點名稱可編輯該連結（PUT /v1/me/social-links/{id}，body {"url","label"}，label 空字串＝改回平台名稱）；在公開畫面點名稱是複製連結，點圖示才在新視窗開啟。`,
    "   - 生命靈數九宮格：GET /v1/me/profile 的 life_chart 提供 rings（數字 0–9；0 放在第四欄、最下面一列、9 的右邊，次序 1 2 3｜4 5 6｜7 8 9｜0，畫在 288×240 的向量圖裡，每個數字固定 72×80 的格子、欄與欄靠近、數字字級 26，0 的圈數是日期與天賦數中 0 出現的次數）、lines（主線，三個數字都有圈或三角形的橫／直／斜線，畫實線；0 只有一種連線：最下面一列 3-6-9 都有標記且 0 也有標記時，線延伸成 3-6-9-0，陣列裡是四個數字）、sub_lines（副線，2-4、4-8、8-6、6-2 兩個數字都有圈或三角形，畫虛線）。每個數字固定一格，圈再多也不可擠壓排版；天賦數：rings 裡 talent 是幾，就畫幾個空心線條三角形（亮綠 #7ccf1b、無填色，由內往外一個比一個大，例如天賦數 33 的 3 畫兩個；三角形與三角形之間的距離和兩個圓圈之間一樣，都是 4.5：每一邊向外平移 4.5）；加總命數（life 為 true 的數字）畫空心紅色正方形（#e5303a，28×28、圓角 2），不填色、數字不改白色；圓圈、三角形、正方形全部都是線寬 1.5 的細框線，三種形狀可以互相重疊；圈只剩先天數（黑）、生日數（黃）、星座數（紫）。圖例的主線、副線只畫一條實線／虛線，頭尾不要畫圓圈（否則虛線看不見）；連線改水藍色 #0ea5e9（和紫色星座圈區分）、線寬 1.5（與圈線相同）。九宮格下方的圖例（先天數生日數字、生日數、星座數、天賦數、加總命數、主線、副線、橫線、直線、斜線，每一項前面畫對應的圈或線）只在會員自己的頁面（已登入、自己看自己）顯示；對外顯示的公開頁（別人看到的）一律不顯示全部圖例。細節與色碼見視覺規範。",
    `   - 只在中央會員網站、App 不需要做：「是否同意讓搜尋引擎為你打知名度？」勾選（GET／PUT /v1/me/search-indexing 只開放給中央會員網站）、每頁底部的「網站設計 杜杜龍」署名、公開頁 /<代碼> 的純淨版面（沒有選單、頁尾、分享與編輯按鈕）。自己的頁面網址是 ${origin}/my/<代碼>，編輯頁是 ${origin}/my/edit。`,
    "6. 資格查詢（哪些內容只給符合資格的會員看）：",
    `   - POST ${origin}/v1/eligibility/check，body {"rule":{"audience":"hglobal_verified"|"everyone","min_rank":"<獎銜代碼，選填，只能搭配 hglobal_verified>"}} → {"allowed":true|false,"reason":"…"}。列表頁一次查多筆用 POST ${origin}/v1/eligibility/check-batch，body {"rules":[…最多 50 筆]}，回傳 results 與 rules 順序相同。兩支都需要 amway.read。`,
    `   - 獎銜代碼不要寫死：一律從 GET ${origin}/v1/amway/field-definitions 取得（rank 欄位的選項，由低到高）。`,
    "   - Fail closed：查不到、逾時、非 200、連不上，一律當作「不符合資格」並拒絕，不可以放行，也不可以沿用過期的結果。",
    "   - 快取：查詢結果最多快取 1 日，只能放記憶體或短時效快取服務，不可以寫進 App 的資料庫或檔案；會員登出時清除。",
    "   - reason 只給 App 內部記錄用，絕對不要顯示給會員。不符合資格時只顯示一般的說明（例如「此內容需要符合資格才能觀看」）。",
    "7. Amway 資料不得被 App 保存：會員編號、獎銜、上手、資格查詢結果等 Amway 相關資料，App 與 App 後端都不可以寫入資料庫、檔案、日誌、分析工具或錯誤回報；需要時即時向中央會員查詢。日誌也不可以記錄 Token、信箱、姓名。",
    "8. 對會員顯示的文字：品牌只用 starry.phd、Amway 這兩個寫法，不要使用它們的中文名稱；畫面上不要出現「寰宇」「H-Global1985」「hglobal」字樣（App 選單裡的選項與隱私權文件除外），網頁標題統一寫「會員中心」。不要提到其他系統的名稱，需要時一律寫「合作營運單位」。",
    `9. 隱私與刪除：設定頁放「隱私權政策」連結 ${origin}/privacy（完整隱私說明已合併在同一份文件，只有這一個網址）。App Store 與 Google Play 要求 App 內有刪除帳號入口：放一個按鈕用瀏覽器開啟 ${origin}/my/edit，會員在那裡按「刪除帳號」（重新登入確認後立即生效，沒有申請流程，也沒有「刪除 Amway 資料」）。`,
    "10. 網頁版網址：每一頁都要有自己的網址路徑，用 History API 切換；重新整理、上一頁、分享網址都停留在同一頁。需要登入的頁面，未登入時先記下目前路徑，登入完成後導回原本那一頁（回傳網址必須在已登記的網頁版來源底下）。",
    "11. 平台資料標準（所有 App 一體適用，先從寰宇行動大學驗收）：",
    "   - 原則 1：個人資料的正本只在中央；App 只存 member_id。複製資料只限必要，並且要有同步（收事件重讀）與刪除（收刪除事件就刪）的機制。",
    "   - 原則 2：交易紀錄（報名、付款）存「當時快照」（當時的姓名、金額、課程），不跟著會員改名；對帳靠付款代碼或金流交易編號，不靠姓名。",
    "   - 原則 3：會員不在線上時 App 需要聯絡方式，一律走中央的聯絡查詢（下方），用完不長期保存副本。",
    "   - 原則 4：資料變動與刪除由中央用 webhook 通知，App 要照辦。原則 5：每個 App 只拿到需要的最小權限，中央留稽核紀錄。",
    `   - 事件通知（webhook）：業主在後台「平台設定」替這款 App 設定 webhook 網址（https）與簽章金鑰（金鑰只存在中央與 App 的伺服器環境變數，不要貼到對話、Issue、PR）。事件：member.profile_changed（fields＝變動的欄位名稱陣列，例如 display_name、contact_email、legal_name，不含值）、member.deleted（會員已刪除帳號）、webhook.test（後台測試）。每則事件是 POST 的 JSON：{"id","type","created_at","app_id","member_id","fields"?}，標頭有 X-HG-Event-Id、X-HG-Timestamp（秒）、X-HG-Attempt、X-HG-Signature：v1=<十六進位>，值是 HMAC-SHA256(金鑰, 時間戳 + "." + 原始請求內容)。App 必須：用原始內容（不要重新序列化）驗簽並用常數時間比較、時間戳與現在相差超過 5 分鐘就拒絕、用事件 id 去重（至少送達一次，可能重複、不保證順序）、在 5 秒內回 2xx；失敗中央會在 1 分鐘、5 分鐘、30 分鐘、2 小時、6 小時、24 小時後重試，共 7 次，之後標為失敗（紀錄保存 30 天，業主在後台看得到）。收到 member.deleted：刪除這位會員在 App 內的所有副本（個人資料、聯絡方式、登入與快取）；交易與付款紀錄依法定保存義務保留快照、不再更新、不用於其他用途。收到 member.profile_changed：只在需要時，用會員本人的 Token 或下方查詢重新讀取，不要自己猜新值。`,
    `   - 聯絡查詢（取代 App 長期保存會員信箱）：業主在後台建立這款 App 的服務金鑰（只顯示一次，只放在 App 的伺服器環境變數，絕不放在手機或網頁用戶端）並核准「用途」（payment_notice、course_notice、account_security）。App 伺服器先 POST ${origin}/v1/service/token {"app_id","client_secret"} 取得 10 分鐘的服務 Token，再 POST ${origin}/v1/apps/<app_id>/contacts/lookup {"member_ids":[最多 50 個],"purpose":"<用途>"}（Authorization: Bearer <服務 Token>）→ {"contacts":[{"member_id","email","email_verified"}],"not_found":[…]}。email 是會員自己填的聯絡信箱（email_verified 為 false），沒有就是已驗證的 Google 信箱。只能查在這款 App 登入過的會員、只能用核准的用途；信箱只用來寄當次通知，不寫進資料庫、日誌或分析工具；每次查詢中央都有稽核（App、筆數、用途，不記信箱）。`,
    "   - 最小權限：新登記的 App 預設只有登入與資格查詢（amway.read）；要更多權限，由業主在後台「平台設定」勾選並留下紀錄。App 只使用被授權的功能，收到 403 forbidden（缺 scope）不要自己想辦法繞過，回報業主。（既有 App 目前仍是舊制的全部權限，業主確認後才收緊。）",
    `   - 標準符合度回報：App 的管理頁呼叫 GET ${origin}/v1/apps/<app_id>/handoff?integrated=<版本>&standards=<逗號分隔，只列已做到的>，標準代碼：webhook（收通知並驗簽）、delete_copy（收到刪除就刪副本）、no_email_copy（不長期存聯絡信箱）、snapshot_reconcile（交易存快照、靠付款代碼對帳）、least_scope（只用被授權的權限）。業主在後台 App 清單一眼看得出哪款 App 還沒符合；沒做到的就不要列。`,
    "12. 下拉重新整理（平台標準，業主 2026-11-14；所有 App、所有頁面一體適用）：每一個畫面都要支援「在頁面最上方往下拉 = 重新整理」，用來取代網頁版沒有重新整理按鈕的缺陷（手機瀏覽器、加到主畫面的網頁、App 內嵌網頁都一樣）。",
    "   - 範圍：App 的每一個畫面都要有（列表、詳情、會員資料頁、通知頁、設定頁…），不可只做首頁。",
    "   - 手勢：頁面捲到最頂端時，手指往下拖超過約 70 px 再放開才觸發。拖動時要有跟手的指示：未過門檻顯示「下拉重新整理」，過了門檻變「放開重新整理」，載入中轉圈；顏色用視覺規範的主色，不新增顏色。沒過門檻就放開，彈回原位、什麼都不做。",
    "   - 觸發後：重新讀取這一頁用到的資料（重新呼叫這頁的 API，必要時先換發 Access Token），並順便重讀 GET config（status、min_version）。不要整個 App 重新載入、不要登出、不要清掉共用登入。完成後指示消失；失敗時用 toast 顯示一行錯誤，可再拉一次。",
    "   - 有未儲存的修改時（例如資料頁顯示「尚未儲存」）：先問「放棄尚未儲存的修改並重新整理？」，確認才重新讀取，取消就不動。",
    "   - 不可誤觸發：頁面不在最頂端時不觸發；手指在輸入框、下拉清單、彈出視窗、裁切視窗、可橫向捲動的區域內拖動時不觸發；正在載入時不重複觸發；連續兩次觸發至少間隔 2 秒（中央有每分鐘 120 次的讀取限制）。",
    "   - 網頁版做法：用 touchstart／touchmove／touchend 自己實作，並在 CSS 設定 overscroll-behavior-y: contain，避免和瀏覽器內建的下拉重新整理重複觸發；不用外部套件。電腦（滑鼠）不需要。",
    "   - 原生 App（Expo／React Native）做法：用 ScrollView／FlatList 的 RefreshControl（onRefresh、refreshing），tintColor 用主色；內容不夠長的畫面也要放在可捲動的容器裡，才能下拉。",
    "   - 驗收：每個畫面都在手機上實際拉一次，確認資料真的重新讀取了（例如在中央會員網站改了暱稱，下拉後 App 顯示新暱稱）。",
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
    "8. 共用登入（三、2）：手機用共用 Keychain 群組保存 sso_token，啟動與回到前景時 exchange／status；網頁版登入後 adopt、載入頁面時 check、登出走 /auth/sso/logout；登出按鈕寫「登出所有 App」。（2026-11-10.3 新增）",
    "9. 會員資料頁（三、5，含浮動儲存鈕、「無」勾選框、生日即時預覽）：一律公開欄位只顯示「公開」不能切換、名字旁的系統／中心／獎銜方框、電腦版 Enter 不動作、地區教育中心點開顯示全部、App 內原地修改、關聯詞、多項欄位確認符號、學歷分列（空白的碩士、博士列會自動消失）、會員編號提示與公開網址格式、Amway 勾選立即生效、地區教育中心的條件式關聯詞、不使用原生下拉與勾選框、亮色系配色。（2026-11-11.1 新增，.2 補充）",
    "10. 視覺規範（視覺規範文件）：顏色只用規範內的色碼、theme 集中管理、圓角與方框尺寸、名字旁方框與會員編號的樣式、不使用原生下拉與勾選框。（2026-11-11.9 新增）",
    "11. 2026-11-11.9 新增的資料頁項目：頭像上傳前的裁切視窗、置頂三格按鈕、社群連結名稱框（兩行高、可自訂、編輯畫面點名稱可編輯）、九宮格主線／副線／天賦數空心三角形（出現幾次畫幾個）／加總命數空心正方形／圖例只在自己的頁面顯示（對外公開頁不顯示）、區塊大標題「xxx生命靈數 x年x月x日」（一行、字多縮小）、審核規則（寰宇不需審核，寰宇＋中心才審核中心與獎銜）。",
    "12. 本名（欄位 legal_name，標籤原稱「本姓」「真實姓名」，三、5；畫面上的標籤跟著欄位定義的 label，不要寫死）：只在報名付費課程與對帳當下用會員本人的 token 讀 fields.legal_name，沒有保存、沒有寫日誌、沒有另建姓名欄位；舊 primary_name 不可再使用。",
    "13. 獎銜選項來自 field-definitions，null 與 \"none\" 都視為「無」，沒有自己複製的獎銜資料表（三、5）。",
    "14. 讀取其他會員的資料只透過 members/lookup、只取需要的欄位、不長期保存、不轉給生態系以外；本人的資料用本人的 Token（三、11）。",
    "15. 深色模式跟隨系統，配色符合視覺規範 1.5 或有業主核准的例外；測試用 staging，測試版共用登入鍵名分開（三、5）。",
    "16. webhook（三、11）：有接收端點，驗簽（原始內容、常數時間、5 分鐘時間窗）、事件 id 去重、5 秒內回 2xx；後台「送一則測試」成功。",
    "17. 收到 member.deleted 會刪除會員在 App 內的副本，交易快照依法保留；收到 member.profile_changed 只在需要時重讀。",
    "18. 沒有長期保存會員聯絡信箱的副本；需要寄通知時用聯絡查詢，用完即丟（三、11）。",
    "19. 報名與付款存當時快照；對帳用付款代碼或金流交易編號，不用姓名（三、11）。",
    "20. 只使用被授權的 scope，沒有自己繞過 403；服務金鑰只在伺服器環境變數（三、11）。",
    "21. 回報標準符合度：handoff?integrated=<版本>&standards=…（只列已做到的）。",
    "22. 職稱（欄位 job_title，三、5）：已出現在資料頁（照欄位定義產生）、輸入時顯示 suggest=job_title 的關聯詞、是 tags 多項標籤格式（2026-11-14.4 起，原為單一文字）、在「行業與工作」之後；其他 App 與本 App 用同一個欄位，不要自己另建職稱欄位或詞庫。（2026-11-14.2 新增）",
    "23. 下拉重新整理（三、12）：每一個畫面都支援在最上方往下拉重新整理；有未儲存修改時先確認；不重載整個 App、不登出；網頁版有 overscroll-behavior-y: contain，原生用 RefreshControl。（2026-11-14.3 新增）",
    "24. 檢查完回報：每一項是「已符合」或「已補上（PR 連結）」，以及需要業主處理的事項。更新一律只補差異，不要重做已正常的部分。",
  ];
  return lines.join("\n");
}
