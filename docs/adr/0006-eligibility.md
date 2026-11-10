# ADR 0006：資格查詢 API

狀態：已採用（2026-11-10，PR 6）

## 決定
- API（串接指令包第 5 節）：`POST /v1/eligibility/check`、`POST /v1/eligibility/check-batch`（最多 50 條，結果順序與規則相同），scope `amway.read`。
- 規則：`audience` 為 `everyone`（一律允許）或 `hglobal_verified`；`min_rank` 只能搭配 `hglobal_verified`，否則 422 `invalid_field`。
- `hglobal_verified` 需同時滿足：「我是Amway會員」開啟、已同意目前版本的說明、教育體系生效值為 `hglobal` 且經審核。
- `min_rank`：會員已審核的獎銜在階梯上 ≥ 要求的獎銜（向下相容）；階梯由獎銜選項的排序決定，`12%` 與 `12%初階` 是不同兩級。比較只在本系統進行。
- fail closed：查不到會員、獎銜代碼不存在或已停用、獎銜未經審核，一律不允許；token、session、會員或 app 失效回 401。
- `reason` 只有 `ok`／`not_verified`／`rank_too_low`／`amway_disabled`，只供 app 內部紀錄，不得顯示給會員。
- 新增 `amway_field_values.value_approved`：記錄「生效值」是否經審核。修改審核中或被駁回時，舊的已審核值仍有效。
- 夫妻共用獎銜，任一方的已審核獎銜對兩人都有效。
- 中央不快取資格結果（每次即時判斷）；app 端依規定可快取最長 1 日、登出或重新登入清除。

## 後續
- 繁星中央會員系統代查（雙向簽章）在階段 2。
- 限流（每位會員每分鐘查詢 120 次）在部署前補上。
