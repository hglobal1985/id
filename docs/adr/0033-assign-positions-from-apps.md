# ADR 0033：App 內指派職務

日期：2026-11-21　狀態：採用（業主 2026-11-21 決定，行動大學需求）

## 背景
行動大學要讓管理者在 App 內直接指定會員擔任職務。原本只有中央後台的 `PUT /v1/admin/staff/{member_id}`（網站 Cookie），App 的會員 Token 一律被拒；`eligibility/context` 只回呼叫者自己的職務。

## 決定（業主 2026-11-21 選定）
- **誰能指派**：與中央後台一樣，要有 `staff.manage` 權限（目前只有超級管理員；日後有人被額外開這個權限，會自動一起開放）。判斷全在中央伺服器。
- **能指派哪些**：只有一般職務 `reviewer`、`president`、`course`、`sound`、`ticket`、`activity`。`super_admin`、`secretary` 只能在後台設定，避免從 App 內升到最高權限。
- **額外權限**：先只做職務；對象的額外權限（`staff_grants`）一律不動。
- 新增 `GET /v1/eligibility/staff`（列出有職務的人；帶 `q` 搜尋啟用會員的顯示名稱）與 `PUT /v1/eligibility/staff/{member_id}`（`roles` ＝ 對象事後應有的可指派職務完整清單；對象原本的 `super_admin`、`secretary` 保留）。App 需要業主勾選 `display_name`（ADR 0022）。
- 沿用後台規則：只能給出自己權限涵蓋的職務；對象需存在且啟用；至少保留一位超級管理員（因為不能動超級管理員，實際不會觸發）。
- 稽核沿用 `staff.roles.set`，新增記錄 App（`setRoles` 多一個 `appId`）；查詢記 `app_staff.list`（筆數與模式，不記搜尋字、姓名）。
- 規則寫成不依賴框架的 `src/admin/assign.ts` 並附單元測試。

## 後果
- 平台規範：已寫進串接指令包（三、17；檢查清單 31）與 `docs/integration-guide.md` 6.16，升版 `2026-11-21.1`。
- 不新增資料表、不需 migration。查詢往返次數固定（職務表 2 次、會員資料 1 次，與人數無關）。
