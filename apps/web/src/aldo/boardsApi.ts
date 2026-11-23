import { api } from "./api";
export type BoardSummary = { id: string; title: string };
export type BoardMember = {
  id: string;
  name: string;
  thread: string;
  environmentId: string;
  threadId: string;
};
export type BoardStep = { member: string; instruction: string };
export type BoardPost = {
  id: string;
  author: string;
  kind: string;
  body: string;
  replyTo: string | null;
  at: string;
  deliveries: Array<{ member: string; status: string; reason: string | null }>;
};
export type BoardView = BoardSummary & {
  members: BoardMember[];
  commands: Array<{ name: string; steps: BoardStep[] }>;
  posts: BoardPost[];
  earlier: string | null;
};
export const listBoards = () =>
  api<{ boards: BoardSummary[]; threads: Array<{ ref: string; title: string }> }>("/api/boards", {
    answersWithin: 10_000,
  });
export const boardAction = <T>(input: Record<string, unknown>) =>
  api<{ result: T }>("/api/boards", { method: "POST", body: JSON.stringify(input) }).then(
    (r) => r.result,
  );
