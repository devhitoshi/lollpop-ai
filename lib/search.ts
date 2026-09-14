import MiniSearch from "minisearch";
import { CONFIG } from "./config";
import { knowledge as allChunks, events as allEvents, songs as allSongs, type Chunk, type EventRow, type Song } from "./data";
import { eventStatus, todayJst } from "./events";
import { MEMBERS } from "./members";

// ---- 文字の正規化と 2 文字刻み ----------------------------------------------

/** 照合用に、全角半角・大小文字・記号・空白の違いを消す。 */
export function squash(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s!！?？♪☆★♀♂︎〜~・、。「」『』（）()【】\[\]:：,，.．\-―ー_*#>|/]+/g, "");
}

/** 日本語は単語の区切りが無いので、辞書を使わず 2 文字ずつに刻む（「主人公」→「主人」「人公」）。 */
export function bigrams(text: string): string[] {
  const s = squash(text);
  if (s.length <= 1) return s ? [s] : [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

// ---- 質問から手がかりを抜き出す ------------------------------------------------

export type QueryHints = {
  songs: string[]; // 正表記
  members: string[]; // MemberId
  month?: number;
  day?: number;
  year?: number;
  recent: boolean; // 「前回」「最近」など
  aboutShows: boolean; // 公演そのものを聞いている（いつ・何回・セトリ）
};

const RECENT = /(前回|この前|こないだ|最近|直近|最後|最新|昨日|先週|さっき|この間)/;
const ABOUT_SHOWS = /(何回|なんかい|セトリ|セットリスト|披露|歌った|やった|公演|ライブ)/;
// 「いつ」だけでは公演の質問とは限らない（「誕生日いつ？」）。曲名と一緒のときだけ公演の質問とみなす
const WHEN = /(いつ|何日|何月)/;

export function extractHints(query: string, songs: Song[] = allSongs): QueryHints {
  const flat = squash(query);
  const hitSongs = songs
    .filter((s) => s.aliases.some((a) => squash(a).length >= 2 && flat.includes(squash(a))))
    .map((s) => s.name);
  const hitMembers = MEMBERS.filter((m) => m.aliases.some((a) => query.includes(a))).map((m) => m.id);

  const hints: QueryHints = {
    songs: hitSongs,
    members: hitMembers,
    recent: RECENT.test(query),
    aboutShows: ABOUT_SHOWS.test(query) || (hitSongs.length > 0 && WHEN.test(query)),
  };
  const normalized = query.normalize("NFKC");
  const full = normalized.match(/(20\d{2})[年\/\-.](\d{1,2})[月\/\-.](\d{1,2})/);
  const md = normalized.match(/(\d{1,2})[月\/](\d{1,2})日?/);
  const mOnly = normalized.match(/(\d{1,2})月/);
  if (full) {
    hints.year = Number(full[1]);
    hints.month = Number(full[2]);
    hints.day = Number(full[3]);
  } else if (md) {
    hints.month = Number(md[1]);
    hints.day = Number(md[2]);
  } else if (mOnly) {
    hints.month = Number(mOnly[1]);
  }
  return hints;
}

// ---- 索引 ---------------------------------------------------------------------

let index: MiniSearch<Chunk> | null = null;

function getIndex(): MiniSearch<Chunk> {
  if (index) return index;
  index = new MiniSearch<Chunk>({
    fields: ["title", "heading", "text"],
    storeFields: [],
    tokenize: (text) => bigrams(text),
    processTerm: (term) => term,
    searchOptions: { boost: { title: 2, heading: 1.5 }, combineWith: "OR" },
  });
  index.addAll(allChunks);
  return index;
}

function matchesDate(date: string, h: QueryHints): boolean {
  if (!date || h.month === undefined) return false;
  const [y, m, d] = date.split("-").map(Number);
  if (h.year !== undefined && y !== h.year) return false;
  if (m !== h.month) return false;
  return h.day === undefined || d === h.day;
}

// ---- 検索本体 -------------------------------------------------------------------

export type SearchResult = {
  context: string; // AI に渡す【資料】
  sources: { title: string; url: string }[];
  chunkIds: string[];
  hints: QueryHints;
};

export function search(
  query: string,
  opts: { today?: string; budget?: number; chunks?: Chunk[]; events?: EventRow[] } = {},
): SearchResult {
  const today = opts.today ?? todayJst();
  const budget = opts.budget ?? CONFIG.searchBudgetChars;
  const chunks = opts.chunks ?? allChunks;
  const rows = opts.events ?? allEvents;
  const hints = extractHints(query);
  const byId = new Map(chunks.map((c) => [c.id, c]));

  // 第 2 段: 言葉の重なり（BM25）で点数を付ける
  const scores = new Map<string, number>();
  for (const r of getIndex().search(query)) scores.set(String(r.id), r.score);
  const maxScore = Math.max(1, ...scores.values());

  // 第 1 段: 札で絞る。絞った結果が空なら絞り込みを諦める（取りこぼしより、関係の薄い資料のほうがまし）
  let pool = chunks.filter((c) => c.date <= today || c.kind === "doc");
  if (hints.songs.length) {
    const narrowed = pool.filter((c) => c.songs.some((s) => hints.songs.includes(s)));
    if (narrowed.length) pool = narrowed;
  }
  if (hints.month !== undefined) {
    const narrowed = pool.filter((c) => c.kind === "event" && matchesDate(c.date, hints));
    if (narrowed.length) pool = narrowed;
  }

  const ranked = pool
    .map((c) => {
      let score = (scores.get(c.id) ?? 0) / maxScore;
      if (hints.members.some((m) => c.members.includes(m))) score += 0.3;
      if (hints.songs.some((s) => c.songs.includes(s))) score += 0.3;
      if (c.kind === "event") {
        // 「いつ歌った」「前回のセトリ」のように公演を聞いているときは、記事より公演データを優先する
        if (hints.aboutShows || hints.recent) score += 1;
        // 新しい公演ほど上に（「どんな曲？」のように曲そのものを聞いているときは記事を優先したいので、公演の質問のときだけ）
        if (hints.recent || hints.aboutShows) {
          const age = (Date.parse(today) - Date.parse(c.date)) / 86_400_000;
          score += Math.max(0, 1 - age / 365);
        }
      }
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.c.date.localeCompare(a.c.date));

  // 日付の質問では、セトリの無い公演（未来・未登録）も資料として明示する
  const dateNotes: string[] = [];
  if (hints.month !== undefined && hints.day !== undefined) {
    for (const e of rows.filter((r) => matchesDate(r.date, hints))) {
      const status = eventStatus(e, today);
      if (status === "upcoming") dateNotes.push(`- ${e.date} ${e.event}（${e.venue}）: これからの公演`);
      if (status === "unregistered") dateNotes.push(`- ${e.date} ${e.event}（${e.venue}）: セトリは未登録`);
    }
  }

  const parts: string[] = [];
  const picked: Chunk[] = [];
  let used = 0;
  if (dateNotes.length) {
    const note = `【公演データ】\n${dateNotes.join("\n")}`;
    parts.push(note);
    used += note.length;
  }
  for (const { c } of ranked) {
    if (picked.length >= CONFIG.searchMaxChunks) break;
    const label = c.kind === "event" ? "公演データ" : [c.title, c.heading].filter(Boolean).join(" > ");
    const block = `【${label}】\n${c.text}`;
    if (used + block.length > budget) continue;
    parts.push(block);
    picked.push(byId.get(c.id)!);
    used += block.length;
  }

  const seen = new Set<string>();
  const sources = picked
    .filter((c) => c.kind === "doc")
    .map((c) => ({ title: c.title, url: c.url }))
    .filter((s) => (seen.has(s.title) ? false : (seen.add(s.title), true)));

  return { context: parts.join("\n\n"), sources, chunkIds: picked.map((c) => c.id), hints };
}
