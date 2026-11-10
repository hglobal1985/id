// Traffic lights on the back-office home: green is fine, yellow needs a look, red needs action now (framework-free).
export type LightColor = "green" | "yellow" | "red";
export interface Light {
  key: "apps" | "reviews" | "deletions" | "invalid_apps";
  label: string;
  color: LightColor;
  text: string;
}

export interface LightInput {
  /** Effective status of every registered App (after the status switch). */
  appStatuses: readonly string[];
  /** App registrations that could not be read (damaged rows; never used). */
  invalidApps: number;
  pendingReviews: number;
  /** Age of the oldest pending review, in days (null when none). */
  oldestReviewDays: number | null;
  openDeletions: number;
  /** Open deletion requests already past their due date. */
  overdueDeletions: number;
}

export const REVIEW_YELLOW_DAYS = 3;
export const REVIEW_RED_DAYS = 7;

export function trafficLights(i: LightInput): Light[] {
  const killed = i.appStatuses.filter((s) => s === "killed").length;
  const paused = i.appStatuses.filter((s) => s === "paused").length;
  const apps: Light =
    killed > 0
      ? { key: "apps", label: "App 狀態", color: "red", text: `${killed} 款已停用${paused > 0 ? `、${paused} 款暫停` : ""}` }
      : paused > 0
        ? { key: "apps", label: "App 狀態", color: "yellow", text: `${paused} 款暫停中` }
        : { key: "apps", label: "App 狀態", color: "green", text: "全部正常" };

  const age = i.oldestReviewDays ?? 0;
  const reviews: Light =
    i.pendingReviews === 0
      ? { key: "reviews", label: "待審核", color: "green", text: "沒有待審" }
      : age >= REVIEW_RED_DAYS
        ? { key: "reviews", label: "待審核", color: "red", text: `${i.pendingReviews} 件待審，最久超過 ${REVIEW_RED_DAYS} 天` }
        : age >= REVIEW_YELLOW_DAYS
          ? { key: "reviews", label: "待審核", color: "yellow", text: `${i.pendingReviews} 件待審，最久超過 ${REVIEW_YELLOW_DAYS} 天` }
          : { key: "reviews", label: "待審核", color: "green", text: `${i.pendingReviews} 件待審，都在 ${REVIEW_YELLOW_DAYS} 天內` };

  const deletions: Light =
    i.overdueDeletions > 0
      ? { key: "deletions", label: "刪除申請", color: "red", text: `${i.overdueDeletions} 件已逾期` }
      : i.openDeletions > 0
        ? { key: "deletions", label: "刪除申請", color: "yellow", text: `${i.openDeletions} 件待處理` }
        : { key: "deletions", label: "刪除申請", color: "green", text: "無待處理" };

  const invalid: Light =
    i.invalidApps > 0 ? { key: "invalid_apps", label: "App 登記", color: "red", text: `${i.invalidApps} 筆登記資料損壞` } : { key: "invalid_apps", label: "App 登記", color: "green", text: "正常" };

  return [apps, reviews, deletions, invalid];
}
