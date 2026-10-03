# Routines in Aldo

A routine is something you want done again and again, or whenever something happens elsewhere: a briefing from your inbox and calendar every weekday morning, a weekly look at your subscriptions, triaging whatever a form or an alert sends. Each run happens in a thread of its own, on a cloud computer with a browser, your saved logins and the accounts you connected, and you get a notification when it's done.

## Setting one up

Tell Aldo ("every weekday at 7, brief me on my inbox and calendar"), ask an agent in a thread, or use **New routine** in the **Routines** section of the home screen:

- **Name**: a few words you'll recognize.
- **What it does**: the whole instruction. Each run knows only this and what its thread did before, so say everything that matters.
- **When**: every day, weekdays, every week on the days you pick, every month on a day (the month's last day when it's shorter), or every few hours, at the time you give. Times are your local time: Aldo uses your browser's time zone.
- **Webhook**: optionally, a private URL that runs the routine whenever something sends a request to it. A routine can run from its webhook alone.

Unless the instruction says to, a run drafts rather than sends, buys, books, posts or deletes anything for you, and asks you first.

## How runs work

The first run starts the routine's thread, under **General** for a routine that isn't about code, and later runs come to the same thread as new messages. So a run can build on the last one: what it found yesterday, files it kept, sites it's signed in to. A routine an agent set up from a thread runs in that thread instead.

When a run finishes, you get a notification with the first thing it says. If it needs you (a question, an approval), it waits in **Needs you** like any thread, and later runs wait until you answer rather than piling up.

A run that's due while the routine's thread is still busy goes as soon as the thread is free. If the next scheduled run comes before that, it's skipped, so you never get a backlog. Aldo checks for due routines every few minutes, so a run starts within about five minutes of its time.

Each run uses credits like any thread: its machine's time while it works, and a few minutes after. Schedule a routine only as often as you need it.

## Webhooks

The webhook URL is a secret: anything that can send a request to it runs the routine. Copy it from the routine's row on the home screen, and give it only to what should run the routine: a monitoring alert, a form, another app's webhook settings.

The run gets what was sent along with the routine's instruction. It treats what was sent as information to work with, never as instructions from you, so a message that says "ignore your instructions" is ignored. If ten runs from the webhook are already waiting for the routine's thread, further calls are turned away until they've gone.

To stop a URL working, have Aldo give the routine a new webhook URL (the old one stops at once), or remove its webhook.

## Managing routines

Each routine on the home screen shows when it runs next, how its last run went, and a link to its thread:

- **Run now** runs it at once, whatever its schedule.
- **Pause** stops it running until you **Resume** it. While it's paused, its webhook doesn't run it either.
- The copy button copies its webhook URL.
- **Remove** deletes the routine. Its thread stays, with everything earlier runs did.

You can also ask Aldo to change what a routine does, when it runs, or its time zone.

If a routine can't run (you're out of credits, or its agent isn't signed in), its row says why, and you get one notification about it.
