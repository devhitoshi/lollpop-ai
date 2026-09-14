import { ApiError, GoogleGenAI, type Content, type GenerateContentResponseUsageMetadata } from "@google/genai";
import { CONFIG, type ModelSpec } from "./config";

export class QuotaExhaustedError extends Error {
  constructor() {
    super("all models are rate limited");
  }
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

// 次のモデルに逃がしてよいエラー（枠切れ・混雑・モデルが存在しない）
function isRetryable(err: unknown): boolean {
  return err instanceof ApiError && [404, 429, 500, 503].includes(err.status);
}

export type StreamMeta = { model: string; usage?: GenerateContentResponseUsageMetadata };

/**
 * モデルを順に試してストリーミングする。1 文字でも返し始めたら、途中で別モデルに切り替えない（文章が二重になるため）。
 * 全モデルが 429 のときは QuotaExhaustedError。
 */
export async function* streamReply(args: {
  systemInstruction: string;
  contents: Content[];
  models?: readonly ModelSpec[];
  meta?: StreamMeta;
}): AsyncGenerator<string> {
  const models = args.models ?? CONFIG.models;
  let allQuota = true;
  let lastError: unknown;

  for (const spec of models) {
    let started = false;
    try {
      const stream = await getClient().models.generateContentStream({
        model: spec.id,
        contents: args.contents,
        config: {
          systemInstruction: args.systemInstruction,
          maxOutputTokens: CONFIG.maxOutputTokens,
          temperature: CONFIG.temperature,
          thinkingConfig: spec.thinking as never,
        },
      });
      for await (const chunk of stream) {
        if (chunk.usageMetadata && args.meta) args.meta.usage = chunk.usageMetadata;
        const text = chunk.text;
        if (text) {
          if (!started && args.meta) args.meta.model = spec.id;
          started = true;
          yield text;
        }
      }
      if (started) return;
      lastError = new Error(`empty response from ${spec.id}`);
      allQuota = false;
    } catch (err) {
      if (started || !isRetryable(err)) throw err;
      if (!(err instanceof ApiError && err.status === 429)) allQuota = false;
      lastError = err;
      console.warn(`[gemini] ${spec.id} failed: ${err instanceof ApiError ? err.status : err}`);
    }
  }
  if (allQuota) throw new QuotaExhaustedError();
  throw lastError ?? new Error("no model responded");
}

export async function countTokens(model: string, systemInstruction: string, contents: Content[]): Promise<number> {
  const res = await getClient().models.countTokens({ model, contents, config: { systemInstruction } });
  return res.totalTokens ?? 0;
}
