# AIろりぽっぷ（非公式ファン制作）

アイドルグループ「ろりぽっぷ!!!!!!!」のメンバー 5 人をモデルにした、ファンが作っている非公式の AI チャットです。
AI の発言はメンバー本人の発言ではありません。

- 公開先: https://lollpop-ai.lolipop-now.app （ロリポップ！デプロイナウ）
- 前身: [ai-mau-bot](https://github.com/kawada612-bit/ai-mau-bot)（AIまう）

## しくみ

| 部分 | 中身 |
|---|---|
| 画面・API | Next.js（App Router）。`app/api/chat/route.ts` が Gemini の返答を 1 行 1 JSON でストリーミングする |
| AI | Gemini の Flash-Lite 系を順に試す（`lib/config.ts`）。全モデルが枠切れなら「今日はおしまい」 |
| なりきり | `persona/_common.md`（全員共通）＋ `persona/<メンバー>.md`（X 投稿の実数から作成） |
| 知識 | [lollpop_docs](https://github.com/devhitoshi/lollpop_docs) の記事・メンバー資料・セトリを `scripts/build_data.py` で断片にし、質問ごとに検索して最大 4,000 字を渡す（`lib/search.ts`） |
| ライブ情報 | lollpop_docs の `events/data_event.csv`。今日以降の行を「今後の公演」として扱う |
| データ更新 | `.github/workflows/sync-data.yml` が毎日 lollpop_docs を読み直して `data/` を push |

## 開発

```bash
npm install
npm run data -- --docs ../lollpop_docs   # data/*.json を作る（lollpop_docs の main を展開したディレクトリ）
npm test                                  # 検索・プロンプト・返信候補の単体テスト
npm run chat -- --size                    # プロンプトの文字数（API キー不要）
npm run chat -- --member mau "やほす〜"   # 端末から会話を試す（.env.local に GEMINI_API_KEY）
npm run dev
```

本番の API キーは `lolipop env` で設定する（デプロイナウは `.env` を読まない）。

## 設計

- 画面ラフと部品番号: `design/design.html`
- 要件: `docs/requirements.md`
