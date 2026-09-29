# Instructions in Aldo

**Settings → Instructions** holds what every cloud agent is told about how you work, like a `CLAUDE.md` or `AGENTS.md` of your own that stays out of your repositories. Claude, Codex, OpenCode and Grok all get them.

## All projects, or one

- **All projects**: how you like agents to work anywhere, such as "Keep answers short" or "Use pnpm, never npm".
- **A project**: what agents should know about one repository, such as "Run pnpm test before opening a pull request". Choose **Add a project** to write some. A thread working in several repositories gets the instructions for each of them.

A repository's own `AGENTS.md` or `CLAUDE.md` still applies; agents read both.

## Asking an agent to remember

Tell an agent in any thread to remember something for later threads ("Remember that I always want squash merges"). It adds a line to your instructions for that project, or for all projects if you say so. You'll see it here, where you can edit or delete it. Agents only save what you ask them to, and never a value from your vault.

If an agent saves something while you're editing the same instructions, **Save** shows you what changed instead of overwriting it. Save again to keep your version.

## When changes apply

A thread picks up changes the next time its machine starts or wakes. New threads always get the latest; a thread that's awake right now gets them after it next sleeps (10 minutes without activity).
