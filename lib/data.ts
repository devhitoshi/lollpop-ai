// data/*.json は scripts/build_data.py の生成物。import で読むので standalone 出力に確実に含まれる。
import eventsJson from "@/data/events.json";
import songsJson from "@/data/songs.json";
import knowledgeJson from "@/data/knowledge.json";
import personaJson from "@/data/persona.json";
import type { MemberId } from "./members";

export type EventRow = { date: string; event: string; venue: string; songs: string[] };

export type Song = {
  name: string;
  category: string;
  作詞?: string;
  作曲?: string;
  "作詞・作曲"?: string;
  初披露?: string;
  plays: number;
  aliases: string[];
};

export type Chunk = {
  id: string;
  kind: "doc" | "event";
  source: string;
  title: string;
  heading: string;
  url: string;
  date: string;
  members: string[];
  songs: string[];
  text: string;
};

export type Persona = {
  common: string;
  membersProfile: string;
  members: Record<MemberId, string>;
};

export const events = eventsJson as EventRow[];
export const songs = songsJson as Song[];
export const knowledge = knowledgeJson as Chunk[];
export const persona = personaJson as Persona;
