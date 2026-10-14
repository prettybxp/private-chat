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
  /** 本站图片路径，如 /uploads/<id>.png */
  image?: string;
  file?: ChatFile;
};

export type Presence = "online" | "idle" | "listening";

export type ConnectionSource = "page" | "extension";

export type Member = {
  clientId: string;
  nickname: string;
  /** online = 页面活跃；idle = 页面开着但长时间无操作；listening = 仅插件挂机 */
  presence: Presence;
};

export type ClientInfo = Record<string, string | number | boolean | string[] | null>;

export type ClientJoin = {
  type: "join";
  clientId: string;
  nickname: string;
  clientInfo?: ClientInfo;
  /** 缺省视为页面连接 */
  source?: ConnectionSource;
};

export type ClientChat = {
  type: "chat";
  text: string;
  image?: string;
  file?: ChatFile;
};

export type ClientPing = {
  type: "ping";
};

export type ClientActivity = {
  type: "activity";
  active: boolean;
};

export type ClientImageBegin = {
  type: "image-begin";
  uploadId: string;
  size: number;
  /** 缺省为图片；file 表示任意文件，强制下载 */
  kind?: "image" | "file";
  name?: string;
};

export type ClientImageChunk = {
  type: "image-chunk";
  uploadId: string;
  seq: number;
  data: string;
};

export type ClientImageEnd = {
  type: "image-end";
  uploadId: string;
};

export type ClientMessage =
  | ClientJoin
  | ClientChat
  | ClientPing
  | ClientActivity
  | ClientImageBegin
  | ClientImageChunk
  | ClientImageEnd;

export type ServerHistory = {
  type: "history";
  messages: Message[];
};

export type ServerMessage = {
  type: "message";
  message: Message;
};

export type ServerMembers = {
  type: "members";
  members: Member[];
};

export type ServerError = {
  type: "error";
  code: string;
  message: string;
};

export type ServerPong = {
  type: "pong";
};

export type ServerUploaded = {
  type: "uploaded";
  uploadId: string;
  url: string;
  name?: string;
  size?: number;
};

export type ServerPayload =
  | ServerHistory
  | ServerMessage
  | ServerMembers
  | ServerError
  | ServerPong
  | ServerUploaded;
