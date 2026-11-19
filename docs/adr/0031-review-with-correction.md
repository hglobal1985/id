# ADR 0031：審核時直接修改後通過

日期：2026-11-20　狀態：採用（業主 2026-11-19 指示，行動大學需求）

## 背景
行動大學通知頁的「審核」要讓有權限的人（超級管理員、秘書、審核員）替申請人修改「獎銜／中心／系統」後再通過。ADR 0030 的處理只有 approve／reject；後台的「代調整」（`PUT /v1/admin/members/{id}/amway/{field}`）只收中央網站的 Cookie，App Token 不能用；審核名單也沒回 `member_id`，App 無法通知申請人。

## 決定
- `POST /v1/eligibility/reviews/{id}/decision` 多一個選填 `value`：只有 `approve` 可帶，格式與欄位定義相同，由伺服器用 `validateAmwayValue` 驗證（不在選項、空白、過長回 422）；只限 `education_system`、`education_center`、`rank`（與後台代調整相同）。`value` 與申請值相同視為一般通過。
- 權限與中心範圍與一般處理相同；另外，只有自己中心權限的審核員不能把中心改成別的中心（403），否則申請會跳出他的負責範圍。
- 留紀錄：新增欄位 `amway_review_requests.approved_value`（migration 0030）。`requested_value` 保留原申請，`approved_value` 存審核者實際核准的值（沒修改為 NULL）。**欄位的值不放進稽核日誌**（AGENTS.md 規則 2），稽核只記 `modified: true`、審核者、申請 id、欄位名稱；原申請值、修改後的值、審核者可由該筆申請列加上稽核對照。
- 通知：申請人收到「審核通過」，內容改為「經審核者修改後已通過」。
- 列表每筆與處理回應都回 `member_id`、`field_key`（處理回應：`{id, member_id, field_key, decided, modified}`），讓 App 可通知申請人。`member_id` 是中央會員識別碼，不含信箱、電話、會員編號。

## 後果
- 平台規範：已寫進串接指令包（三、16；檢查清單 29）與 `docs/integration-guide.md` 6.14，升版 `2026-11-20.1`。
- 修正 ADR 0030「列表沒有會員識別碼」的說法；測試改為驗證 `member_id` 會回傳、信箱與電話不會。
