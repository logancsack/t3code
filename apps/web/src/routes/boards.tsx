import { createFileRoute, redirect } from "@tanstack/react-router";
import { isAldoCloud } from "../aldo/api";
import { AldoBoardsPage } from "../aldo/AldoBoards";
export const Route = createFileRoute("/boards")({
  beforeLoad: () => {
    if (!isAldoCloud) throw redirect({ to: "/", replace: true });
  },
  component: AldoBoardsPage,
});
