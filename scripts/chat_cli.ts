// 端末から会話を試す（なりきりの試聴と、1 通あたりのトークン量の実測）。
//
//   npm run chat -- --size                         プロンプトの文字数だけ出す（API キー不要）
//   npm run chat -- --member mau "やほす〜"          1 人に 1 問
//   npm run chat -- --all --out <file.md>            5 人 × 8 問を投げて Markdown に書き出す
//
// API キーは .env.local の GEMINI_API_KEY（このスクリプトが読み込む）。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { CONFIG } from "../lib/config";
import { countTokens, streamReply, type StreamMeta } from "../lib/gemini";
import { MEMBERS, getMember } from "../lib/members";
import { buildContents, buildSystemInstruction } from "../lib/prompt";
import { search } from "../lib/search";
import { SuggestionSplitter } from "../lib/suggestions";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const QUESTIONS = [
  "おはよう！",
  "昨日のライブ行ってきた！めっちゃ楽しかった",
  "次のライブっていつ？",
  "前回のセトリ教えて",
  "シーソーゲームってどんな曲？",
  "彼氏いるの？",
  "来月のワンマンのチケットっていくら？",
  "Hi! I'm from Singapore. What's your favorite song?",
];

async function ask(memberId: string, message: string, userName = "テスト") {
  const member = getMember(memberId);
  if (!member) throw new Error(`unknown member: ${memberId}`);
  const found = search(message);
  const systemInstruction = buildSystemInstruction(member);
  const contents = buildContents({ history: [], message, userName, context: found.context });
  const meta: StreamMeta = { model: "" };
  const splitter = new SuggestionSplitter();
  let text = "";
  const started = Date.now();
  for await (const delta of streamReply({ systemInstruction, contents, meta })) text += splitter.push(delta);
  const { rest, suggestions } = splitter.finish();
  text += rest;
  return { text, suggestions, meta, ms: Date.now() - started, sources: found.sources, contextChars: found.context.length };
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

  if (flag("--size")) {
    for (const m of MEMBERS) {
      const sys = buildSystemInstruction(m);
      console.log(`${m.id.padEnd(16)} system ${sys.length.toLocaleString()} 字`);
    }
    const r = search("前回のセトリ教えて");
    console.log(`検索差し込みの例（前回のセトリ）: ${r.context.length.toLocaleString()} 字 / 上限 ${CONFIG.searchBudgetChars}`);
    return;
  }

  if (flag("--all")) {
    const out = value("--out") ?? "試聴.md";
    const lines: string[] = [`# 試聴 5 人 × ${QUESTIONS.length} 問（${new Date().toISOString()}）`, ""];
    for (const m of MEMBERS) {
      lines.push(`## ${m.fullName}（AI${m.name}）`, "");
      const tokenSample = await countTokens(
        CONFIG.models[0].id,
        buildSystemInstruction(m),
        buildContents({ history: [], message: QUESTIONS[3], userName: "テスト", context: search(QUESTIONS[3]).context }),
      ).catch((e) => `計測失敗: ${e}`);
      lines.push(`- 入力トークン（「${QUESTIONS[3]}」の場合、countTokens）: ${tokenSample}`, "");
      for (const q of QUESTIONS) {
        try {
          const r = await ask(m.id, q);
          const u = r.meta.usage;
          lines.push(
            `### Q. ${q}`,
            "",
            r.text,
            "",
            `- 返信候補: ${r.suggestions.join(" ／ ") || "（なし）"}`,
            `- 出典: ${r.sources.map((s) => s.title).join(" ／ ") || "（なし）"}`,
            `- ${r.meta.model} / ${r.ms}ms / 入力 ${u?.promptTokenCount ?? "?"}（キャッシュ ${u?.cachedContentTokenCount ?? 0}）/ 出力 ${u?.candidatesTokenCount ?? "?"} / 思考 ${u?.thoughtsTokenCount ?? 0} / 資料 ${r.contextChars} 字`,
            "",
          );
          console.log(`${m.id} ✓ ${q.slice(0, 20)}`);
        } catch (e) {
          lines.push(`### Q. ${q}`, "", `エラー: ${e}`, "");
          console.log(`${m.id} ✗ ${q.slice(0, 20)}: ${e}`);
        }
      }
    }
    writeFileSync(out, lines.join("\n"), "utf-8");
    console.log(`→ ${out}`);
    return;
  }

  const memberId = value("--member") ?? "mau";
  const message = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--member").join(" ") || "やほす〜";
  const r = await ask(memberId, message);
  console.log(r.text);
  console.log(`\n返信候補: ${r.suggestions.join(" ／ ")}`);
  console.log(`出典: ${r.sources.map((s) => s.title).join(" ／ ")}`);
  console.log(`${r.meta.model} ${r.ms}ms`, r.meta.usage);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
