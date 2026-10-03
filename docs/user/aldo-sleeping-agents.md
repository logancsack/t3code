# When cloud agents sleep in Aldo

Each thread's cloud agent runs on its own machine. A machine that has nothing to do goes to sleep, which keeps your usage down, and wakes again in a few seconds when it's needed. Its files, branches, and threads are all still there when it wakes.

## When an agent goes to sleep

- **Nothing to do for 5 minutes**: the agent finished its turn, or is waiting on your answer, and nobody is looking at its thread.
- **Its thread is open, but the page hasn't been used for half an hour**: Aldo left open on a screen doesn't keep an agent awake. Moving the pointer, typing, scrolling, or coming back to the tab or window all count as using it.

An agent doesn't sleep while it's working. Work it leaves running in the background after a turn keeps it awake for up to 2 hours.

## Waking it

- **Send a message**: the thread says it's reconnecting to the cloud, and your message goes as soon as the agent is up.
- **Open the thread**, or come back to a page you left open: Aldo starts waking the agent right away, so it's usually up by the time you've typed. You can turn this off with **Settings → General → Cloud agents → Wake agents when you open a thread**.

While an agent sleeps, you can still read its thread, and settling, archiving, pinning, snoozing, renaming, or deleting it doesn't wake it. Programs running on its machine stop when it sleeps; dev servers your agent started as services start again when it wakes, and previews, the browser, and the terminal reconnect.
