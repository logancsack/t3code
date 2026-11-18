// A thread without a repository (General's folder, or one of the user's
// projects) is the user's folder, and the agent keeps its own things in it
// too: its instructions (AGENTS.md, CLAUDE.md), dotfiles and dot-folders
// (.claude, .codex, .env) and its tools' folders (node_modules, __pycache__,
// venv). The Files panel leaves those out of what it lists there; a file
// opened by name (a chat link) still opens.

/** Names the agent and its tools keep in a folder, matched at any depth. */
const AGENT_NAMES = new Set(["agents.md", "claude.md", "node_modules", "__pycache__", "venv"]);

/** Whether a workspace-relative path is, or is inside, one of the agent's own files or folders. */
export function isAgentFilePath(path: string): boolean {
  return path
    .split("/")
    .some((segment) => segment.startsWith(".") || AGENT_NAMES.has(segment.toLowerCase()));
}

/** The entries that are the user's, without the agent's own files and what's inside its folders. */
export function withoutAgentFiles<T extends { readonly path: string }>(
  entries: ReadonlyArray<T>,
): T[] {
  return entries.filter((entry) => !isAgentFilePath(entry.path));
}
