# ADR 0030：App 內的獎銜與中心審核佇列

日期：2026-11-17　狀態：採用（杜杜龍 2026-11-17 指示）

## 背景
審核「獎銜、教育中心」新申請原本只能在中央後台（Cookie 登入）。行動大學要在通知頁的「審核」分類同步顯示，並讓有權限的審核人員直接處理。後台 `/v1/admin/*` 只接受中央網站本身的 Cookie，App Token 一律被拒。

## 決定
新增 `GET /v1/eligibility/reviews` 與 `POST /v1/eligibility/reviews/{id}/decision`（`src/api/app-reviews.ts`），用呼叫者本人的 App 會員 Token（`amway.read`）。

- 權限與範圍沿用後台 `/v1/admin/reviews` 的規則：有 `review` 權限才可用；`super_admin`、`secretary` 全部；`reviewer` 只有自己已審核教育中心的申請。判斷全在中央伺服器，App 不做權限判斷。
- 只回審核所需的最少欄位（顯示名稱、欄位、目前值、申請值、中心、時間）；沒有信箱、電話、會員編號。需要 App 已被授權使用 `display_name`（ADR 0022）。
- 處理沿用 `decideReview`：申請人收到通知、審核員的等待通知標成已完成；每次列出與處理都寫稽核（App、人、結果）。

## 後果
- 新功能屬平台規範：已寫進串接指令包（三、16；檢查清單 28）、`docs/integration-guide.md` 6.14，升版 `2026-11-17.1`。
- 不新增資料表。
