import type { Content } from "@google/genai";
import { CONFIG } from "./config";
import { events as allEvents, persona, songs as allSongs, type Song } from "./data";
import { formatUpcoming, todayJst, upcomingEvents } from "./events";
import type { Member } from "./members";

export type ChatTurn = { role: "user" | "model"; text: string };

function songLine(s: Song): string {
  const credit = s["作詞・作曲"]
    ? `作詞・作曲 ${s["作詞・作曲"]}`
    : [s.作詞 && `作詞 ${s.作詞}`, s.作曲 && `作曲 ${s.作曲}`].filter(Boolean).join("・");
  const extra = [s.category, credit, s.初披露 && `初披露 ${s.初披露}`, `ライブ披露 ${s.plays} 回`].filter(Boolean);
  return `- ${s.name}（${extra.join("／")}）`;
}

/**
 * system instruction。メンバーごとに固定の接頭辞になるよう、利用者ごとに変わるもの（名前・資料・履歴）は入れない。
 * 並び順は「変わりにくいもの → 変わりやすいもの」（Gemini の implicit caching が先頭一致で効くため）。
 */
export function buildSystemInstruction(member: Member, today: string = todayJst()): string {
  const common = persona.common.replaceAll("{member_name}", member.name);
  return [
    common,
    `【ろりぽっぷ!!!!!!! の曲（全 ${allSongs.length} 曲）】\n${allSongs.map(songLine).join("\n")}`,
    `【メンバー一覧】\n${persona.membersProfile}`,
    persona.members[member.id],
    `【今後の公演】（今日は ${today}。この一覧だけが公演予定の根拠）\n${formatUpcoming(upcomingEvents(allEvents, today))}`,
  ].join("\n\n");
}

/** 利用者から来た値は信用せず、ここで切り詰める。 */
export function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is ChatTurn =>
        !!t && typeof t === "object" && (t.role === "user" || t.role === "model") && typeof t.text === "string",
    )
    .map((t) => ({ role: t.role, text: t.text.slice(0, CONFIG.historyCharsPerTurn) }))
    .filter((t) => t.text.trim().length > 0)
    .slice(-CONFIG.historyTurns);
}

export function sanitizeUserName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\r\n\t{}【】<>`]/g, "")
    .trim()
    .slice(0, CONFIG.userNameMaxChars);
}

export function buildContents(args: {
  history: ChatTurn[];
  message: string;
  userName: string;
  context: string;
}): Content[] {
  const contents: Content[] = args.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
  // Gemini は user から始まり user/model が交互である必要がある
  while (contents.length && contents[0].role !== "user") contents.shift();

  const name = args.userName
    ? `{user_name} は「${args.userName}」と読み替えてください。`
    : "相手の名前はわかりません。{user_name} の部分は省いて、名前を呼ばずに話してください。";
  const turn = [
    `【資料】（ろりぽっぷ!!!!!!! のファン資料から、このメッセージに関係しそうな部分を抜き出したもの。関係なければ使わない）`,
    args.context || "（該当する資料はありません）",
    `【相手】${name}`,
    `【メッセージ】\n${args.message}`,
  ].join("\n\n");

  const last = contents.at(-1);
  if (last && last.role === "user") contents.pop(); // 同じ役割が続かないように
  contents.push({ role: "user", parts: [{ text: turn }] });
  return contents;
}
