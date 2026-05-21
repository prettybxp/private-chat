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
