// 網站自動巡檢的判斷規則（不依賴框架）：何時該巡檢、連續失敗幾次才算掛了、何時要通知。

/** 連續失敗幾次才通知（避免一次網路抖動就吵杜杜龍）。 */
export const FAILURES_BEFORE_ALERT = 2;
/** 單一網址等待回應的上限（毫秒）。 */
export const PROBE_TIMEOUT_MS = 8000;

export type SiteStatus = "up" | "down";

export interface SiteState {
  status: SiteStatus;
  consecutive_failures: number;
}

export interface ProbeResult {
  ok: boolean;
  /** 簡短原因（HTTP 狀態碼或錯誤種類），不含內容。 */
  note: string;
}

/** 排程每 5 分鐘醒一次；距離上次巡檢已達設定頻率（容許 30 秒誤差）才巡檢。從沒巡檢過就立刻巡檢。 */
export function isProbeDue(intervalMinutes: number, lastCheckedEpoch: number | null, nowEpoch: number): boolean {
  if (lastCheckedEpoch === null) return true;
  return nowEpoch - lastCheckedEpoch >= intervalMinutes * 60 - 30;
}

export type Alert = "down" | "recovered" | null;

/** 依上一次的狀態與這次結果，算出新的狀態，以及要不要通知（掛了只通知一次，恢復通知一次）。 */
export function nextState(prev: SiteState | null, r: ProbeResult): { state: SiteState; alert: Alert } {
  if (r.ok) {
    return { state: { status: "up", consecutive_failures: 0 }, alert: prev && prev.status === "down" ? "recovered" : null };
  }
  const failures = (prev?.consecutive_failures ?? 0) + 1;
  const wasDown = prev?.status === "down";
  const down = wasDown || failures >= FAILURES_BEFORE_ALERT;
  return { state: { status: down ? "down" : "up", consecutive_failures: failures }, alert: down && !wasDown ? "down" : null };
}

/** 把網路錯誤整理成不含細節的原因。 */
export function describeError(e: unknown): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "逾時";
  return "連不上";
}
