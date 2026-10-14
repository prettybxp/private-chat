export type ChatFile = {
  url: string;
  name: string;
  size: number;
};

export type Message = {
  id: string;
  clientId: string;
  nickname: string;
  text: string;
  ts: number;
  image?: string;
  file?: ChatFile;
};

export type Presence = "online" | "idle" | "listening";

export type Member = {
  clientId: string;
  nickname: string;
  presence?: Presence;
};
