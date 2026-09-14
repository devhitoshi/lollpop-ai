// 調整値はここに集める（設計書の M 表・計測の前提と値をそろえるため）。

export type ModelSpec = {
  id: string;
  // 3 系 Flash-Lite は thinkingLevel、2.5 系は thinkingBudget で思考を切る
  thinking: { thinkingLevel: "MINIMAL" } | { thinkingBudget: number };
};

const DEFAULT_MODELS: ModelSpec[] = [
  { id: "gemini-3.5-flash-lite", thinking: { thinkingLevel: "MINIMAL" } },
  { id: "gemini-3.1-flash-lite", thinking: { thinkingLevel: "MINIMAL" } },
  { id: "gemini-2.5-flash-lite", thinking: { thinkingBudget: 0 } },
];

// 本番でモデルの提供状況が変わったときに、コードを直さず差し替えられるようにする（例: GEMINI_MODELS=gemini-3.1-flash-lite,gemini-2.5-flash-lite）
function modelsFromEnv(): ModelSpec[] {
  const raw = process.env.GEMINI_MODELS;
  if (!raw) return DEFAULT_MODELS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({
      id,
      thinking: id.startsWith("gemini-2.") ? { thinkingBudget: 0 } : { thinkingLevel: "MINIMAL" as const },
    }));
}

export const CONFIG = {
  models: modelsFromEnv(),
  maxOutputTokens: 400,
  temperature: 0.8,

  // 入力の切り詰め（プロンプトの肥大とインジェクションを防ぐ）
  historyTurns: 12,
  historyCharsPerTurn: 500,
  messageMaxChars: 500,
  userNameMaxChars: 20,

  // 検索で差し込む資料の上限
  searchBudgetChars: 4000,
  searchMaxChunks: 8,

  // 常駐させる「今後の公演」の範囲
  upcomingDays: 28,

  // 端末側の連打防止（サーバー側の回数制限は初版では入れない）
  clientRateLimit: { count: 10, windowMs: 60_000 },

  suggestionsMarker: "===SUGGESTIONS===",
  officialX: "https://x.com/lollipop_1116",
} as const;
