import { CONFIG } from "@/lib/config";
import { QuotaExhaustedError, streamReply, type StreamMeta } from "@/lib/gemini";
import { getMember } from "@/lib/members";
import { buildContents, buildSystemInstruction, sanitizeHistory, sanitizeUserName } from "@/lib/prompt";
import { search } from "@/lib/search";
import { SuggestionSplitter } from "@/lib/suggestions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 画面とのやりとりは 1 行 1 JSON（NDJSON）。本文の断片・出典・返信候補・エラーを同じ流れで送るため。
export type ChatEvent =
  | { type: "sources"; sources: { title: string; url: string }[] }
  | { type: "delta"; text: string }
  | { type: "done"; suggestions: string[]; model: string; usage?: StreamMeta["usage"] }
  | { type: "error"; code: "limit" | "server" };

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return bad("invalid json");
  }

  const member = getMember(String(body.memberId ?? ""));
  if (!member) return bad("unknown member");
  const message = typeof body.message === "string" ? body.message.trim().slice(0, CONFIG.messageMaxChars) : "";
  if (!message) return bad("empty message");

  const history = sanitizeHistory(body.history);
  const userName = sanitizeUserName(body.userName);
  const found = search(message);
  const systemInstruction = buildSystemInstruction(member);
  const contents = buildContents({ history, message, userName, context: found.context });

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, e: ChatEvent) =>
    controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

  const stream = new ReadableStream({
    async start(controller) {
      send(controller, { type: "sources", sources: found.sources });
      const meta: StreamMeta = { model: "" };
      const splitter = new SuggestionSplitter();
      try {
        for await (const text of streamReply({ systemInstruction, contents, meta })) {
          const visible = splitter.push(text);
          if (visible) send(controller, { type: "delta", text: visible });
        }
        const { rest, suggestions } = splitter.finish();
        if (rest) send(controller, { type: "delta", text: rest });
        send(controller, { type: "done", suggestions, model: meta.model, usage: meta.usage });
      } catch (err) {
        console.error("[chat]", err);
        send(controller, { type: "error", code: err instanceof QuotaExhaustedError ? "limit" : "server" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
