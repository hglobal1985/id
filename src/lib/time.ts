/** ISO 8601 string in Asia/Taipei (+08:00). All API timestamps use this form. */
export function taipeiIso(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().replace("Z", "+08:00");
}

export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
