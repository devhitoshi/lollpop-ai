import { CONFIG } from "./config";

const MARKER = CONFIG.suggestionsMarker;

/** 末尾が区切り文字列の書き出しと一致している長さ（"…===SUG" なら 6）。 */
function partialMarkerLength(text: string): number {
  for (let n = Math.min(MARKER.length - 1, text.length); n > 0; n--) {
    if (MARKER.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

/**
 * ストリーミング中の本文から、返信候補の区切り以降を画面に出さないための分割器。
 * 区切りの書き出しかもしれない末尾と、その直前の空白だけを保留し、残りはすぐ出す。
 */
export class SuggestionSplitter {
  private full = "";
  private emitted = 0;

  private visibleEnd(): number {
    const idx = this.full.indexOf(MARKER);
    let end = idx >= 0 ? idx : this.full.length - partialMarkerLength(this.full);
    while (end > this.emitted && /\s/.test(this.full[end - 1])) end--;
    return Math.max(this.emitted, end);
  }

  push(delta: string): string {
    this.full += delta;
    const end = this.visibleEnd();
    const out = this.full.slice(this.emitted, end);
    this.emitted = end;
    return out;
  }

  /** ストリームの終わりに呼ぶ。保留していた本文の残りと、返信候補を返す。 */
  finish(): { rest: string; body: string; suggestions: string[] } {
    const idx = this.full.indexOf(MARKER);
    const bodyEnd = idx >= 0 ? idx : this.full.length;
    const rest = this.full.slice(this.emitted, Math.max(this.emitted, bodyEnd)).replace(/\s+$/, "");
    this.emitted = Math.max(this.emitted, bodyEnd);
    const suggestions =
      idx >= 0
        ? this.full
            .slice(idx + MARKER.length)
            .split("\n")
            .map((s) => s.replace(/^[-・*\d.\s]+/, "").trim())
            .filter((s) => s.length > 0 && s.length <= 40)
            .slice(0, 3)
        : [];
    return { rest, body: this.full.slice(0, bodyEnd).trim(), suggestions };
  }
}
