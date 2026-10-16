# When agents sleep in Aldo

Each thread's agent runs on its own computer. A computer that has nothing to do goes to sleep, which keeps your usage down, and wakes again in a few seconds when it's needed. Its files, branches, and threads are all still there when it wakes.

## When an agent goes to sleep

- **Nothing to do for 2 minutes**: the agent finished its turn, or is waiting on your answer, and nobody is looking at its thread.
- **Its thread is open, but the page hasn't been used for half an hour**: Aldo left open on a screen doesn't keep an agent awake. Moving the pointer, typing, scrolling, or coming back to the tab or window all count as using it.

An agent doesn't sleep while it's working. Work it leaves running in the background after a turn keeps it awake for up to 2 hours.

If an agent's computer does go to sleep in the middle of a turn (when your credits run out, say), its thread shows **Paused mid-turn** rather than working. Opening the thread wakes the computer and the turn carries on.

## Waking it

- **Send a message**: the thread says it's reconnecting to the cloud, and your message goes as soon as the agent is up.
- **Open the thread**, or come back to a page you left open: Aldo starts waking the agent right away, so it's usually up by the time you've typed. You can turn this off with **Settings → General → Computers → Wake agents when you open a thread**. A thread paused mid-turn wakes when you open it even with this off, since its turn is waiting to carry on.

While an agent sleeps, you can still read its thread, and settling, archiving, pinning, snoozing, renaming, or deleting it doesn't wake it. Programs running on its computer stop when it sleeps; dev servers your agent started as services start again when it wakes, and previews, the browser, and the terminal reconnect.

## A new thread's computer

A new thread needs a computer of its own, which takes a little while to start. Aldo starts it before you need it:

- **Open a new thread**: its computer starts while you write your first message. If you leave without sending anything, it's removed shortly after.
- **Type to Aldo on the home screen**: Aldo starts a computer for a thread it may start from what you're writing, so a thread it starts outside your projects begins without waiting for one. If no thread takes it within a few minutes of your last keystroke, it's removed. You have at most one such computer at a time, and it starts only when your plan has room for another agent: it never puts another agent to sleep, and never keeps a thread from starting.

These computers use credits while they run, like any other. You can turn both off with **Settings → General → Computers → Start new threads' agents right away**.
