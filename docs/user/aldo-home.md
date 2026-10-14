# The home screen in Aldo

Aldo's home screen is where you see all of your agents' work at once and act on it, with Aldo to hand. Nothing on it wakes a sleeping agent: everything comes from what Aldo already knows.

It opens on your conversation with Aldo. **Board**, at the top, switches to the board below (on a phone, **Threads**: see below); the home screen remembers which you used last on each device.

## Simple mode

If you only talk to Aldo and never open a thread yourself, simple mode trades the sidebar for a narrow rail with three places:

- **Aldo**: your conversation with Aldo. Type to it, or tap the orb to talk.
- **Needs you**: everything waiting on you, with how many on the rail: approvals, questions, plans, what only you can do in an agent's browser, and pull requests ready to merge. Answer each right there, or **Go through them with Aldo** on a call.
- **Library**: everything your agents shared by link, newest first. See [the Library](./aldo-library.md).

Tapping a thread (**Open** on something that needs you, say) opens it with the rail still beside it. At the foot of the rail, **Full view** brings the sidebar back, and your picture opens your account. On a phone, the three places are tabs at the top of the home screen, and the button at the top left opens them, with **Full view** and your account.

Turn simple mode on or off in **Settings → General → Layout**, or with the **Simple mode** switch in your account. It's off unless you turn it on, and it applies to the device you set it on.

## Your brief

The first time you open Aldo each day (from 4 in the morning where you are), Aldo starts the day's conversation with a brief: a few sentences on where everything stands, then **Top of mind**, the few things to decide first, and **Looking ahead**, what's left on your calendar today when you've connected one.

- **Top of mind** shows each thing as it stands now. An email to send has **Send**, an event **Add**, a pull request **Merge**; Aldo asks before it goes ahead. When Aldo has a reason to think it knows your answer to a question (something you told it before), it says what it would pick, and that choice is a button. Tap anything else to look at it and answer it there. What you've decided is ticked off.
- **Listen** reads the brief aloud in Aldo's voice.
- **Go through them** starts a call with Aldo that takes you through what's waiting on you, one at a time (below).

Aldo remembers what it said in the brief, so you can ask about it afterwards.

## Going through them with Aldo

On **Go through them**, Aldo puts each decision to you out loud while your screen shows it with its choices. Answer out loud and Aldo acts on it, or tap a choice. **Skip for now** moves on, and **Open the thread** takes you to it. When you've been through them all, Aldo says so. Hanging up ends it; the call can carry on without it.

## On a phone

On a phone the home screen has two tabs:

- **Aldo**: your conversation, with the brief at the start of the day, and a big button beside the composer to talk. A call fills the screen: Aldo's words as it says them, what it did on this call, and **Mute**, **Type** and **End**. The arrow at the top folds the call away so you can use the app while it goes on; the big button brings it back. The speaker button turns Aldo's voice off, leaving its words on screen.
- **Threads**: every thread by what it needs from you (waiting on you, working, landing, unread), with how many wait on you on the tab. Sending an email or merging takes a tap on the row. Tap a thread to see what its agent last said and answer it, reply to the agent, talk to Aldo about it, or open it.

## The board

The board answers four questions, in order, starting with what waits on a tap from you.

**Approve.** What waits on one tap from you: an email an agent drafted to send, an event for your calendar, a thread Aldo suggests, or a step an agent takes only with your yes (paying, booking, cancelling, submitting, calling). See [Approvals and heads-ups](./aldo-approvals.md).

**Needs you.** Every thread waiting on you, the one that has waited longest first:

- A **question** shows its choices. Tap one to answer, or type an answer of your own. A question that allows several choices sends them together.
- An **approval** shows what the agent wants to do, with its details, and the choices the agent offered (allow, allow for this session, deny).
- **Needs you in its browser**: the agent met what only you can get past, like a check that you're human or a code sent to you. **Do it now** opens its browser full screen; a code goes in the field. See [When an agent needs you in its browser](./aldo-approvals.md#when-an-agent-needs-you-in-its-browser).
- A **plan to approve** shows the plan. **Approve plan** has the agent carry it out; **Ask for changes** sends your changes back for a revised plan.
- A thread that **stopped with an error** says why.

Answering a thread whose agent has gone to sleep wakes it, so a button can take a moment. **Open** goes to the thread; **Ask Aldo** starts a message to Aldo about it.

**Working now.** Each thread that's working, with its model, how long it has been at it, and what it last said. A thread that hasn't moved for an hour is marked **stuck**. Each thread's computer has 8 vCPUs and memory that grows automatically with your work, up to 32 GB; when it runs short, the thread says so here while Aldo gives it more.

**Pull requests.** Every pull request Aldo follows, in three lanes: **open** (draft, checks running, failing, or green), **shipping** (merged, deploying), and **shipped** (deployed in the last two days). Each shows its stage, how many fixes the agent has made, whether reviews went to you, and, when your policy has Aldo merge green pull requests, when it will. **Merge** merges a green one yourself. See [Pull requests in Aldo](./aldo-pull-requests.md).

**Coming up.** Reminders agents set for themselves, messages of yours waiting for a busy thread, and routine runs waiting for theirs. **Send now** sends one without waiting; **Cancel** drops it.

**Routines.** What you have Aldo do on a schedule or when a webhook is called: when each runs next, how its last run went, and its thread. **Run now**, **Pause** and **Remove** are on each; **New routine** sets one up. See [Routines in Aldo](./aldo-routines.md).

**Done.** Threads that finished in the last two days. What's new since you last opened the home screen on this device is marked. **Catch me up** has Aldo tell you.

**What Aldo did.** What Aldo did for you lately, with the words of yours it acted on, and what went wrong when it couldn't.

Below those, a line shows how many agents are running against your plan, your credits, and what agents have spent, and **How Aldo works for you** shows the policy your agents follow (merging, spending, automated reviews).

When something needs fixing, a strip at the top says so: an agent signed out of an account you connected, credits used up, an environment that failed to build, or notifications off on this device. Each has a way to fix it.

## Starting work

At the top, **New** opens a thread at once, ready to type in, in General: for work that isn't code (see [Threads without a repository](./aldo-general-threads.md)). Before you send it, the place chip in its message box moves it to one of your projects or a repository. The arrow beside **New** starts one somewhere else from the outset: General, one of your projects, a repository, or a new project. See [Where a thread works](./aldo-where-threads-work.md). Or tell Aldo what you want done.

## Narrowing and moving

With threads in more than one repository, chips at the top narrow the whole board to one.

On a keyboard, **j** and **k** move through the threads, **Enter** opens the selected one, and **/** goes to Aldo's composer.

## Aldo

On the board, Aldo sits beside it (on a phone, below it, folded under what it last said). Type to it, or tap the orb to talk. Chips under the composer offer things to say: what needs you, a catch-up, what shipped, or starting something in a repository you work in.

Typed, your words go to Aldo in writing: it reads your threads, acts when you ask it to, and replies with what it did, each action linked to its thread. The conversation carries on turn after turn, and Aldo remembers it the next time, spoken or typed. On a call, typing goes into the call instead.

On a call, Aldo keeps track of the work it hands to threads. When one comes back with an answer, needs you, runs into trouble or has to wait to start, or an agent has something to tell you, Aldo brings it up on its own at a pause in the conversation, never over you or while it's working on something you asked. Each piece of news is told once, with a line in the conversation that opens its thread. Aldo only tells you what has actually happened, and news is never permission: it acts on it only when you ask it to. What comes back after you hang up waits in Aldo, and a call you start again soon after hears it.
