import { CONFIG } from "./config";
import type { EventRow } from "./data";

/** 日本時間の日付（YYYY-MM-DD）。サーバーの時刻帯に依存させない。 */
export function todayJst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** data_event.csv では「未来の公演」と「セトリ未入力の過去公演」を区別できないので、日付で分ける。 */
export function upcomingEvents(all: EventRow[], today: string, days: number = CONFIG.upcomingDays): EventRow[] {
  const until = addDays(today, days);
  return all.filter((e) => e.date >= today && e.date <= until);
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function formatEventDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}

export function formatUpcoming(rows: EventRow[]): string {
  if (rows.length === 0) return "（登録されている公演はありません）";
  return rows.map((e) => `- ${e.date} ${e.event}（${e.venue}）`).join("\n");
}

/** 公演 1 件の状態。過去日付でセトリが無いものは「未登録」であって「歌っていない」ではない。 */
export function eventStatus(e: EventRow, today: string): "upcoming" | "setlist" | "unregistered" {
  if (e.date >= today) return "upcoming";
  return e.songs.length > 0 ? "setlist" : "unregistered";
}
