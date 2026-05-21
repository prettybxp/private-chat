export type Message = {
  id: string;
  clientId: string;
  nickname: string;
  text: string;
  ts: number;
};

export type Member = {
  clientId: string;
  nickname: string;
};

export type ClientJoin = {
  type: "join";
  clientId: string;
  nickname: string;
};

export type ClientChat = {
  type: "chat";
  text: string;
};

export type ClientPing = {
  type: "ping";
};

export type ClientMessage = ClientJoin | ClientChat | ClientPing;

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

export type ServerPayload =
  | ServerHistory
  | ServerMessage
  | ServerMembers
  | ServerError
  | ServerPong;
