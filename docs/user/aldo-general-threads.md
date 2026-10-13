# Threads without a repository in Aldo

Not everything is code. A thread can work without a repository: research something and write it up, sort your inbox and draft replies, book or fill something in on a website you're signed in to, make a document, spreadsheet or deck. These threads show under one project in the sidebar, **General**.

## Starting one

- **New** on the home screen, or **New thread** in the sidebar, opens one at once, ready to type in. Before you send it, **General ▾** at the top moves it to one of your projects, a repository or a new project, taking what you typed along.
- In the start dialog, **No repository**.
- Or tell Aldo what you want done. When it isn't about code in one of your repositories, Aldo starts a General thread.

You don't need GitHub or another git host connected for these, only an agent subscription.

## What the agent has

The same computer every thread gets: a terminal, a real browser you can watch and take over, a desktop for apps, your saved logins, your vault, and the accounts you connected in [Integrations](./aldo-integrations.md), like your mail and calendar.

While the agent works in its browser, the thread's header says where ("On opentable.com"); tap it to watch in the Browser panel. When it meets what only you can get past there, like a check that you're human or a code sent to your phone, a card over the message box asks you: see [When an agent needs you in its browser](./aldo-approvals.md#when-an-agent-needs-you-in-its-browser).

Instead of a repository, the agent works in a folder of its own. Like a repository, it keeps a history of each turn's changes, so you can see what a turn changed and revert to an earlier one. The agent keeps what it makes for you there, or in your OneDrive or Google Drive when you've connected one, and tells you where.

## What's different

- There are no pull requests to open, and nothing is pushed anywhere.
- There's no ready-to-go environment to save: the agent installs what the work needs on its machine, and the machine keeps it.
- The policy agents follow (spending, for example) is your own, for every workspace. An answer you give an agent in a General thread is recorded for all of them.

## Following the work

In a General thread, or one in an Aldo project, the thread reads as words rather than code:

- While the agent works, a line says what it's doing ("Working on opentable.com", "Making Budget.xlsx"), and each step it took reads the same way.
- If the agent goes four minutes without anything new (no new step, no new words), the line says so ("No progress for 4 min") and offers **Nudge**, which asks the agent where it's up to, **Stop**, and **Ask Aldo**, which asks Aldo about the thread. It doesn't while the agent is waiting on you.
- When it's done, the turn folds into one line of what it did ("Visited 3 sites, made Budget.xlsx · 4m"), which opens to the steps.
- **What it made** shows a card for each sheet, document, deck, PDF, image or page the turn made or shared. A card opens the file beside the thread; **Copy link** copies a shared file's link, and **Share** asks the agent to share it. **All changes** lists every file the turn touched.
- **Library**, in the panel beside the thread, lists everything the thread made or shared, by day, and who can open each shared link. See [The Library](./aldo-library.md).
- When the agent offers what it could do next, those show as buttons under its answer. Tap one to send it.

If the work turns out to need a repository after all, the agent can add one to the thread, and work and open pull requests there.
