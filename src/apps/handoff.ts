// "給開發 AI 的串接指令" generator (framework-free). The text carries only public values, never a key.
import type { AppEntry } from "./registry";

/**
 * Version of the instruction text. Bump both whenever the text below changes (a unit test fails until you do),
 * so the owner can tell at a glance whether the copy an App's AI received is the latest one.
 * Format: YYYY-MM-DD.N (the earlier hand-written transitional copy for app_id learn was 2026-11-10.1).
 */
export const HANDOFF_VERSION = "2026-11-12.4";
export const HANDOFF_UPDATED = "2026-11-12 14:00（台灣時間）";
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
    `5. 會員資料（App 內原地修改）：GET ${origin}/v1/profile/field-definitions 取得欄位定義，GET ${origin}/v1/me/profile 取得會員目前的值；每個欄位用 PUT ${origin}/v1/me/profile/fields/<field_key>（body {"value":…}，null 清除）單獨儲存，公開／隱藏用 PUT ${origin}/v1/me/profile/visibility。所有 App 都擁有全部權限範圍，不需要另外申請。畫面請完全依欄位定義產生，不要寫死欄位、名稱或選項；不認得的欄位類型顯示「請更新 App」。`,
    "   - 欄位型態：text、textarea、url、email、phone、date 用一般輸入框；tags 是多項輸入（職業、公司／單位、興趣與專長、使用語言），值是文字陣列；select 是固定選項；country（居住國家／地區）是手動輸入並從建議中選擇。每個欄位旁都要有「公開／隱藏」切換（眼睛圖示），聯絡與地區、生日、Amway 欄位預設全部隱藏。",
    `   - 關聯詞：定義裡有 suggest 的欄位（職業、公司／單位、興趣與專長、大學／碩士／博士的校名與系名、直銷商培訓系統、上手鑽石、上手白金、皇冠大使）是「直接打字＋關聯詞」：會員自由輸入，輸入時呼叫 GET ${origin}/v1/vocab/suggestions?pool=<suggest>&q=<已輸入的字> 顯示建議（只要包含輸入的任一個字就會出現，不分順序），點選後填入；不用強迫會員一定要選。推薦人沒有關聯詞。`,
    "   - 電腦版的 Enter 鍵：電腦（滑鼠加鍵盤）上輸入法選字要按 Enter，所以所有可自訂輸入的欄位（職業、公司、興趣與專長、大學系名、地區教育中心…）按 Enter 都不要有任何動作（不送出、不確認標籤、不選建議）；用逗號等符號、空格、點選建議、按「儲存」來完成。手機上才保留 Enter 確認標籤。輸入法組字中（isComposing）也不要處理分隔符號。",
    `   - 多項欄位（tags）：輸入時遇到 , ; : - # * / \\ ' ， 、 ； ： 。 . 或空白字元或按 Enter，就確認為一個項目（變成可移除的標籤）。`,
    "   - 頭像區：上傳圖片、Google頭像、移除頭像三個按鈕排成一整列，放在頭像正下方（再下面才是社群連結圖示列）。會員編號欄位的「公開網址」最左邊放一個超大的分享按鈕，呼叫手機的原生分享選單（navigator.share，不支援時複製連結）；按鈕圖示依裝置不同：iPhone／iPad 用方框加向上箭頭，Android 用三點相連的分享符號（符合各平台原生圖示）。",
    "   - 生日欄位（date 型態）：不要用日期選擇器或年曆，改成年、月、日三個各自獨立的自訂下拉選單並排一列；月份顯示阿拉伯數字加英文縮寫（1 Jan、2 Feb … 12 Dec）；欄位說明不再寫「格式：YYYY-MM-DD」。",
    "   - 生日與生命靈數是同一個區塊（block 是 birthday）：區塊大標題寫成「xxx生命靈數 x年x月x日」（沒有「的」、沒有括號，生命靈數與日期之間一個空格），xxx 是顯示名稱，年月日是會員的生日（例如「小美生命靈數 1985年7月3日」）；標題強制一行不換行，字太多就自動縮小字體；會員把生日設為隱藏時，對外只寫「xxx生命靈數」，不要露出日期。檢視畫面不要再另外顯示「生日」列和「生命靈數」小標題（日期已在大標題）；只有編輯畫面保留生日輸入欄。GET /v1/profile/field-definitions 的 blocks 只有 avatar、amway、basic、education、contact、birthday 六個，依 order 排列。",
    `   - 社群連結（取代原本的「個人網站」欄位，一律顯示）：名片照片下方一列置中的小圖示，每列 5 個；圖示總數超過兩排時改縮小，每列 7 個。最後一個是「＋」圖示，下方寫「新增連結」。每個圖示下方有「複製」小標籤（複製該網址），點圖示在新視窗開啟連結。可選平台與圖示由 GET ${origin}/v1/social/platforms 取得（順序與圖示由後台決定，不要寫死；custom 為 true 的是「自定義」）；GET／POST ${origin}/v1/me/social-links（body {"platform_key","url","label"?}，網址沒打 http:// 或 https:// 時由中央補上 https://、打了就照會員輸入的保留（只收這兩種開頭），最多 30 個，同一平台可重複新增）、DELETE ${origin}/v1/me/social-links/{id}；「自定義」連結可用 PUT ${origin}/v1/me/social-links/{id}/icon 直接送圖片位元組（先縮成約 64 px 的小圖，不超過 16 KB）。`,
    "   - 審核規則：選「直銷商培訓系統」＝寰宇不需審核，立刻生效。只有「寰宇＋同時填了地區教育中心」時，「中心」與「獎銜」才需審核：送出後欄位 status 為 pending（顯示「等待審核中」），原本的值維持有效，由相同中心的審核員核准後才換成新值；駁回則維持原值。App 只顯示 status，不要自己判斷。",
    "   - 一律公開的欄位（顯示名稱、居住國家／地區、生命靈數九宮格，以及會員編號、頭像）：沒有填寫就不顯示；欄位定義的 visibility.configurable 為 false，畫面上仍顯示和其他欄位一樣的圓角方框與眼睛圖案「公開」，但不能按（沒有切換）；PUT /v1/me/profile/visibility 對這些欄位回 422 always_public。所有 Amway 欄位（直銷商培訓系統、地區教育中心、獎銜、推薦人、上手、皇冠大使）都有公開／隱藏切換，預設值看欄位定義的 visibility.default（皇冠大使預設隱藏，其餘預設公開）。暱稱欄位已刪除。",
    "   - 名字旁的方框：名字右邊依序顯示「系統」（直銷商培訓系統）、「中心」（地區教育中心）、「獎銜」（只顯示已審核的，「創辦人」三個字改寫成 F）三個小方框，只在勾選「我是Amway會員」且有填寫時出現；GET /v1/me/profile 的 badges 已算好文字與字級（size 0–3，字多自動縮小到固定五個中文字寬）；訪客看到的公開頁，被隱藏的欄位就沒有對應方框。系統方框直接顯示會員填的詞（例如「寰宇」）。頁首名字固定一行顯示，字多時自動縮小字級；「會員編號」文字加國碼的完整編號（例如 TW9475831）也固定在同一行。",
    "   - 學歷：大學、碩士、博士各一列，每列「校名＋系名」放在同一行，只顯示「大學」「碩士」「博士」三個名稱（不要顯示欄位全名）。碩士、博士預設整列隱藏：大學列下方放「新增碩士學歷」按鈕，按了才顯示碩士列；有碩士列才出現「新增博士學歷」。已經有資料的列一律顯示。欄位定義的 row 資訊（key、label、optional_after）就是用來分列的。",
    "   - 會員編號（member_number）與公開網址：公開網址是 ${origin}/<國碼二碼緊接編號>，例如 TW9475831（二碼國碼＋編號，中間沒有空格）；欄位值的 country、number 組成這個代碼（編號本身已含國碼的不重複加）。國家選單照欄位定義 options 的順序（台灣、鄰近國家，其餘依國際電話區碼）。尚未勾選「我是Amway會員」時，欄位旁顯示「隨機產生，不可修改」且不提供編輯；勾選後改顯示「建議修改會員編號」並可編輯（文字取自 GET /v1/me/profile 的 member_number.note；會員自己改過一次編號後，note 就永久消失，不再提醒）。每次取消勾選「我是Amway會員」，系統會重新隨機產生一組編號（國碼＋0 開頭的 7 位亂數，不夠用時自動加位數），PUT /v1/me/amway/enabled 的回應帶 member_number；取消勾選時若已綁定夫妻會先解除綁定。",
    `   - 勾選「我是Amway會員」：PUT ${origin}/v1/me/amway/enabled {"enabled":true|false}，打勾或取消立即生效，不要有二次確認，也沒有同意畫面或隱私說明確認頁；打勾後立刻顯示 Amway 欄位（GET ${origin}/v1/amway/field-definitions 與 GET ${origin}/v1/me/amway），每個 Amway 欄位也有「公開／隱藏」切換。「地區教育中心」（education_center）永遠顯示、是自由輸入的文字；只有 GET /v1/me/amway 的 hglobal 為 true（直銷商培訓系統填了代表 H-Global1985 的詞，例如「寰宇」）時，才依欄位定義的 suggest_when_hglobal 顯示專屬清單：點進欄位不用打字就直接列出整份清單（GET /v1/vocab/suggestions?pool=education_center&q= 空字串回傳全部），打字時自動篩選；這個「點開就顯示全部」的規則只適用地區教育中心，不要套用在其他欄位。不是寰宇的話維持純文字、不要有任何關聯詞。`,
    `   - 其他：座右銘欄位要有「隨機提案」按鈕（GET ${origin}/v1/profile/suggestions/motto，只填入輸入框，由會員自己儲存）；頭像用 POST ${origin}/v1/me/profile/avatar 直接送圖片位元組（先縮成約 256 px 的方形 JPEG，不超過 128 KB），或 POST ${origin}/v1/me/profile/avatar/google 使用 Google 頭像；生日設定後 GET /v1/me/profile 的 life_chart 提供生命靈數九宮格的繪圖資料。每個欄位的編輯按鈕，在編輯狀態要原地變成「磁碟片圖示＋儲存」。`,
    "   - 【畫面控制項規則】整個資料頁不要使用瀏覽器或系統原生的下拉選單（select／Picker）與原生勾選框（checkbox），一律用自訂元件：下拉用自訂的彈出清單（可搜尋），勾選用和文字同樣大小的自訂方框（打勾圖示與文字等高），建議清單與多項輸入也都是自訂元件。不要為了省事改回原生控制項。",
    "   - 【視覺規範】以手機閱讀舒適度優先排版：單欄、觸控區域至少 44 px、亮色系（不做深色模式、不使用星空特效）。顏色、字體、圓角、方框、按鈕、名字旁方框、九宮格的標準全部寫在視覺規範文件，要點：背景暖白 #f8f6ef、卡片白底 1 px #e2dfd2 邊線 16 px 圓角、主色深綠 #0c603c（按下 #094a2e、淺綠底 #e7f1ea）、橘 #cc6c0c、危險 #b3261e；系統字型 16 px 行高 1.65；按鈕與輸入框 10 px 圓角、高度至少 40／44；名稱與標籤用全圓角；名字旁的系統／中心／獎銜方框在頁首寬度隨文字、字級固定 .78 rem 不縮小（主選單內才縮小）；會員編號不加框，與「會員編號」文字同一行同字體。",
    `   - 頭像上傳：選好圖片後先出現裁切視窗（圓形範圍，可拖曳移動、縮放），按「使用這張」才縮成約 256 px 方形 JPEG 上傳。置頂按鈕列固定三格：自己的頁面是「編輯｜分享｜預覽公開頁」，編輯畫面是「上一頁｜分享｜預覽公開頁」，位置與高度一致；分享一律分享公開網址（${origin}/<代碼>）。`,
    `   - 社群連結的名稱：圖示下方的名稱框固定兩行高，字多自動縮小到放得下；名稱預設是平台名稱，會員新增時可自訂（label，最多 30 字，例如「健管」）。在編輯畫面點名稱可編輯該連結（PUT /v1/me/social-links/{id}，body {"url","label"}，label 空字串＝改回平台名稱）；在公開畫面點名稱是複製連結，點圖示才在新視窗開啟。`,
    "   - 生命靈數九宮格：GET /v1/me/profile 的 life_chart 提供 rings（數字 0–9；0 放在第四欄、最下面一列、9 的右邊，次序 1 2 3｜4 5 6｜7 8 9｜0，畫在 288×240 的向量圖裡，每個數字固定 72×80 的格子、欄與欄靠近、數字字級 26，0 的圈數是日期與天賦數中 0 出現的次數）、lines（主線，三個數字都有圈或三角形的橫／直／斜線，畫實線；0 只有一種連線：最下面一列 3-6-9 都有標記且 0 也有標記時，線延伸成 3-6-9-0，陣列裡是四個數字）、sub_lines（副線，2-4、4-8、8-6、6-2 兩個數字都有圈或三角形，畫虛線）。每個數字固定一格，圈再多也不可擠壓排版；天賦數：rings 裡 talent 是幾，就畫幾個空心線條三角形（線寬 2.5、亮綠 #7ccf1b、無填色，由內往外一個比一個大，例如天賦數 33 的 3 畫兩個），可以和圓圈重疊；加總命數（life 為 true 的數字）畫小的實心紅色正方形（#e5303a）墊在數字下層、數字改白色；圈只剩先天數（黑）、生日數（黃）、星座數（紫）。圖例的主線、副線只畫一條實線／虛線，頭尾不要畫圓圈（否則虛線看不見）；連線藍色、線寬與圈線相同。九宮格下方的圖例（先天數生日數字、生日數、星座數、天賦數、加總命數、主線、副線、橫線、直線、斜線，每一項前面畫對應的圈或線）只在會員自己的頁面（已登入、自己看自己）顯示；對外顯示的公開頁（別人看到的）一律不顯示全部圖例。細節與色碼見視覺規範。",
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
    "9. 會員資料頁（三、5）：一律公開欄位只顯示「公開」不能切換、名字旁的系統／中心／獎銜方框、電腦版 Enter 不動作、地區教育中心點開顯示全部、App 內原地修改、關聯詞、多項欄位確認符號、學歷分列（空白的碩士、博士列會自動消失）、會員編號提示與公開網址格式、Amway 勾選立即生效、地區教育中心的條件式關聯詞、不使用原生下拉與勾選框、亮色系配色。（2026-11-11.1 新增，.2 補充）",
    "10. 視覺規範（視覺規範文件）：顏色只用規範內的色碼、theme 集中管理、圓角與方框尺寸、名字旁方框與會員編號的樣式、不使用原生下拉與勾選框。（2026-11-11.9 新增）",
    "11. 2026-11-11.9 新增的資料頁項目：頭像上傳前的裁切視窗、置頂三格按鈕、社群連結名稱框（兩行高、可自訂、編輯畫面點名稱可編輯）、九宮格主線／副線／天賦數空心三角形（出現幾次畫幾個）／加總命數實心正方形／圖例只在自己的頁面顯示（對外公開頁不顯示）、區塊大標題「xxx生命靈數 x年x月x日」（一行、字多縮小）、審核規則（寰宇不需審核，寰宇＋中心才審核中心與獎銜）。",
    "12. 檢查完回報：每一項是「已符合」或「已補上（PR 連結）」，以及需要業主處理的事項。更新一律只補差異，不要重做已正常的部分。",
  ];
  return lines.join("\n");
}
