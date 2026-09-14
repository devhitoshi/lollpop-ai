export type MemberId = "mau" | "yagi_kurumi" | "natsukawa_mayu" | "matsukawa_ami" | "aduki_mana";

export type Member = {
  id: MemberId;
  name: string; // AI{name} として名乗る呼び名
  fullName: string;
  colorName: string;
  color: string; // 画面のテーマ色
  emoji: string;
  // 本人・運営から申し出があったら false にして即時非公開にする（設計書 §2）
  published: boolean;
  // 質問文からメンバーを見つけるための呼び名（検索の加点に使う）
  aliases: string[];
};

export const MEMBERS: Member[] = [
  {
    id: "mau",
    name: "まう",
    fullName: "まう",
    colorName: "水色",
    color: "#38bdf8",
    emoji: "🩵",
    published: true,
    aliases: ["まう"],
  },
  {
    id: "yagi_kurumi",
    name: "くるみ",
    fullName: "やぎくるみ",
    colorName: "赤",
    color: "#ef4444",
    emoji: "❤️",
    published: true,
    aliases: ["くるみ", "やぎ"],
  },
  {
    id: "natsukawa_mayu",
    name: "おまゆ",
    fullName: "夏川茉夢",
    colorName: "黄色",
    color: "#facc15",
    emoji: "💛",
    published: true,
    aliases: ["おまゆ", "まゆ", "茉夢", "夏川"],
  },
  {
    id: "matsukawa_ami",
    name: "あみ",
    fullName: "松川愛美",
    colorName: "緑",
    color: "#22c55e",
    emoji: "💚",
    published: true,
    aliases: ["あみてん", "あみちゃ", "愛美", "松川"],
  },
  {
    id: "aduki_mana",
    name: "まなてぃー",
    fullName: "愛月まな",
    colorName: "白",
    color: "#e5e7eb",
    emoji: "🤍",
    published: true,
    aliases: ["まなてぃ", "まな", "愛月"],
  },
];

export function getMember(id: string): Member | undefined {
  return MEMBERS.find((m) => m.id === id && m.published);
}
