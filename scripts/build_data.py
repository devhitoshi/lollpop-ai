"""lollpop_docs と persona/ から、アプリに同梱する data/*.json を作る。

使い方:
    python scripts/build_data.py --docs <lollpop_docs の main を展開したディレクトリ>

出力（すべて data/ 配下。アプリは import で読み込むので、standalone 出力にも確実に含まれる）:
    events.json     data_event.csv の全行（曲名は正表記に寄せたリストも付ける）
    songs.json      曲マスタ（作詞・作曲・初披露・通算披露回数・別名）
    knowledge.json  検索用の断片（記事・メンバー資料・ガイド・公演）
    persona.json    共通ルール・メンバーごとのなりきり設定・members.md
"""
import argparse
import csv
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
PERSONA_DIR = os.path.join(ROOT, "persona")

MEMBER_IDS = ["mau", "yagi_kurumi", "natsukawa_mayu", "matsukawa_ami", "aduki_mana"]

# 断片に「出てくるメンバー」の札を付けるための呼び名。検索時の加点に使うだけなので、
# 「まう」「あみ」のような短い名前の誤検出（しまう、みつあみ）は許容する。
MEMBER_ALIASES = {
    "mau": ["まう"],
    "yagi_kurumi": ["くるみ", "やぎ"],
    "natsukawa_mayu": ["おまゆ", "茉夢", "夏川"],
    "matsukawa_ami": ["あみてん", "あみちゃ", "愛美", "松川"],
    "aduki_mana": ["まなてぃ", "愛月"],
}

# 検索対象。歌詞本文（songs/lyrics）・エゴサ（data/x）・内部文書（strategy 等）・旧版（archive）は含めない。
KNOWLEDGE_GLOBS = [
    ("members", ["mau.md", "yagi_kurumi.md", "natsukawa_mayu.md", "matsukawa_ami.md", "aduki_mana.md", "members.md"]),
    ("songs", ["楽曲一覧.md"]),
    ("guide", None),
    ("articles/スターターパック", None),
    ("articles/単発", None),
    ("articles/歌詞考察", None),
    ("articles/セトリ白書", ["note.md"]),
    ("articles/セトリ白書_全力疾走", ["note.md"]),
    ("articles/週刊まとめ", None),
    ("articles/月刊まとめ", None),
]
SKIP_FILES = {"README.md", "公開手順.md"}
# members/*.md のうち、会話の知識ではない節（取得・更新の記録）
SKIP_HEADINGS = re.compile(r"観測ログ|更新履歴|出典と方法")
OFFICIAL_HANDLES = {"lollipop_1116", "mau_lpop", "kurumi_lpop", "mayu_lpop", "ami_lpop", "mana_lpop"}
HANDLE = re.compile(r"@([A-Za-z0-9_]{2,15})")

CHUNK_MIN = 300
CHUNK_MAX = 800


def load_song_names(docs):
    sys.path.insert(0, os.path.join(docs, ".claude", "skills", "setlist-analysis", "scripts"))
    import song_names  # noqa: E402  lollpop_docs の名寄せルールをそのまま使う
    return song_names


def squash(text):
    """曲名の照合用に、記号・空白・大小文字の違いを消す。"""
    return re.sub(r"[\s!！♪☆★♀︎♂︎〜~・]+", "", text).lower()


def build_songs(docs, sn, events):
    path = os.path.join(docs, "songs", "楽曲一覧.md")
    canonical = sn.load_canonical_songs(path)
    songs, current, category = [], None, ""
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("## 音楽配信先"):
                break
            if line.startswith("## "):
                category = re.sub(r"^##\s*\d+\.\s*", "", line).strip()
                continue
            m = re.match(r"^- \*\*(.+)\*\*", line)
            if m:
                current = {"name": m.group(1).strip(), "category": category}
                songs.append(current)
                continue
            m = re.match(r"^\s+- \*\*(作詞・作曲|作詞|作曲|初披露)\*\*:\s*(.+)", line)
            if m and current is not None:
                current[m.group(1)] = m.group(2).strip()
    counts = Counter(s for e in events for s in e["songs"])
    for s in songs:
        s["plays"] = counts.get(s["name"], 0)
        base = squash(s["name"])
        s["aliases"] = sorted({s["name"], base})
    missing = set(canonical) - {s["name"] for s in songs}
    if missing:
        print(f"warning: 曲一覧の解析で漏れた曲 {missing}", file=sys.stderr)
    return songs, canonical


def build_events(docs, sn, canonical):
    events = []
    with open(os.path.join(docs, "events", "data_event.csv"), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            setlist = (row.get("setlist") or "").strip()
            songs = []
            if setlist and "セトリ投稿確認" not in setlist:
                for items in sn.split_setlist(setlist):
                    for item in items:
                        if sn.is_non_song_item(item):
                            continue
                        name = sn.normalize_song_name(item, canonical)
                        if name:
                            songs.append(name)
            events.append({
                "date": row["date"],
                "event": row["event"],
                "venue": row["venue"],
                "songs": songs,
            })
    events.sort(key=lambda e: e["date"])
    return events


def load_note_urls(docs):
    """articles/公開一覧.md から「リポジトリ内パス → note URL」を読む。"""
    urls = {}
    with open(os.path.join(docs, "articles", "公開一覧.md"), encoding="utf-8") as f:
        for line in f:
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) < 3:
                continue
            m = re.match(r"^`([^`]+\.md)`$", cells[1])
            if m and cells[2].startswith("https://"):
                urls[m.group(1)] = cells[2]
    return urls


def tag_members(text):
    return [mid for mid, aliases in MEMBER_ALIASES.items() if any(a in text for a in aliases)]


def tag_songs(text, songs):
    flat = squash(text)
    return [s["name"] for s in songs if squash(s["name"]) and squash(s["name"]) in flat]


def clean_line(line):
    """ファンのハンドル名を含む行は落とす。画像・HTML コメントも落とす。"""
    if any(h not in OFFICIAL_HANDLES for h in HANDLE.findall(line)):
        return None
    if line.lstrip().startswith("![") or line.lstrip().startswith("<!--"):
        return None
    return line.rstrip()


def split_markdown(text):
    """見出しで区切り、(見出しの道筋, 本文) の列を返す。"""
    sections, path, buf = [], [], []
    title = ""
    for raw in text.splitlines():
        m = re.match(r"^(#{1,4})\s+(.+)", raw)
        if m:
            if buf:
                sections.append((list(path), "\n".join(buf).strip()))
                buf = []
            level, head = len(m.group(1)), m.group(2).strip()
            if level == 1 and not title:
                title = head
            path = path[: level - 1] + [head]
            continue
        line = clean_line(raw)
        if line is not None:
            buf.append(line)
    if buf:
        sections.append((list(path), "\n".join(buf).strip()))
    return title, sections


def pack_chunks(paragraphs):
    """段落を 300〜800 字にまとめる。長すぎる段落は行で割る。"""
    chunks, cur = [], ""
    for p in paragraphs:
        pieces = [p] if len(p) <= CHUNK_MAX else p.splitlines()
        for piece in pieces:
            if cur and len(cur) + len(piece) + 1 > CHUNK_MAX:
                chunks.append(cur)
                cur = ""
            cur = f"{cur}\n{piece}" if cur else piece
    if cur:
        if chunks and len(cur) < CHUNK_MIN and len(chunks[-1]) + len(cur) + 1 <= CHUNK_MAX + CHUNK_MIN:
            chunks[-1] += "\n" + cur
        else:
            chunks.append(cur)
    return chunks


def build_knowledge(docs, songs, events):
    note_urls = load_note_urls(docs)
    items = []
    for sub, names in KNOWLEDGE_GLOBS:
        base = os.path.join(docs, sub)
        if not os.path.isdir(base):
            print(f"warning: {sub} がありません", file=sys.stderr)
            continue
        files = names or sorted(n for n in os.listdir(base) if n.endswith(".md") and n not in SKIP_FILES)
        for name in files:
            rel = f"{sub}/{name}"
            with open(os.path.join(base, name), encoding="utf-8") as f:
                title, sections = split_markdown(f.read())
            date_m = re.search(r"(\d{4}-\d{2}(?:-\d{2})?)", name)
            for heads, body in sections:
                if not body or any(SKIP_HEADINGS.search(h) for h in heads):
                    continue
                paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
                for text in pack_chunks(paragraphs):
                    if len(text) < 40:
                        continue
                    heading = " > ".join(h for h in heads if h != title)
                    items.append({
                        "id": f"{rel}#{len(items)}",
                        "kind": "doc",
                        "source": rel,
                        "title": title or name,
                        "heading": heading,
                        "url": note_urls.get(rel, ""),
                        "date": date_m.group(1) if date_m else "",
                        "members": tag_members(text),
                        "songs": tag_songs(text, songs),
                        "text": text,
                    })
    for e in events:
        if not e["songs"]:
            continue  # セトリの無い公演は events.json 側で扱う（未来の公演・未登録）
        text = f"{e['date']} {e['event']}（{e['venue']}）\nセトリ: " + " / ".join(e["songs"])
        items.append({
            "id": f"event:{e['date']}:{len(items)}",
            "kind": "event",
            "source": "events/data_event.csv",
            "title": e["event"],
            "heading": "",
            "url": "",
            "date": e["date"],
            "members": [],
            "songs": sorted(set(e["songs"])),
            "text": text,
        })
    return items


def build_persona(docs):
    def read(path):
        with open(path, encoding="utf-8") as f:
            return f.read().strip()

    with open(os.path.join(docs, "members", "members.md"), encoding="utf-8") as f:
        members_md = f.read()
    # 現メンバーの節だけを渡す（元メンバーの節は会話に出さない方針）
    m = re.search(r"## 現メンバー.*?(?=\n## |\Z)", members_md, re.S)
    return {
        "common": read(os.path.join(PERSONA_DIR, "_common.md")),
        "membersProfile": m.group(0).strip() if m else "",
        "members": {mid: read(os.path.join(PERSONA_DIR, f"{mid}.md")) for mid in MEMBER_IDS},
    }


def write_json(name, obj):
    path = os.path.join(DATA_DIR, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return os.path.getsize(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--docs", required=True, help="lollpop_docs（main）のディレクトリ")
    args = ap.parse_args()
    docs = os.path.abspath(args.docs)
    os.makedirs(DATA_DIR, exist_ok=True)

    sn = load_song_names(docs)
    canonical = sn.load_canonical_songs(os.path.join(docs, "songs", "楽曲一覧.md"))
    events = build_events(docs, sn, canonical)
    songs, _ = build_songs(docs, sn, events)
    knowledge = build_knowledge(docs, songs, events)
    persona = build_persona(docs)

    sizes = {
        "events.json": write_json("events.json", events),
        "songs.json": write_json("songs.json", songs),
        "knowledge.json": write_json("knowledge.json", knowledge),
        "persona.json": write_json("persona.json", persona),
    }
    doc_chars = sum(len(k["text"]) for k in knowledge)
    print(f"events {len(events)} / songs {len(songs)} / chunks {len(knowledge)}（{doc_chars:,} 字）")
    for name, size in sizes.items():
        print(f"  {name}: {size:,} bytes")


if __name__ == "__main__":
    main()
