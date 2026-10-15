# The home screen in Aldo

Aldo's home screen is where you see all of your agents' work at once and act on it, with Aldo to hand. Nothing on it wakes a sleeping agent: everything comes from what Aldo already knows.

It opens on your conversation with Aldo, and everything is in it, so there's no other view to switch to:

- **What happened**, where it happened: a quiet line when a thread finishes, when a pull request ships, and for what you decided. Tap a line to open its thread.
- **Threads Aldo started** for you, as cards that stay live: what each is doing and for how long, its pull requests with their checks, and **Needs you** when it waits on you, which takes you to its card. Tap a card to open the thread.
- **What needs you**, at the end, just above where you type: the first open, the next two a line each that opens with a tap, and the rest behind **more**. Answer each right there; a long email or plan shows its first lines and **Show all**, and discarding a draft asks first. When you've answered, the card becomes a line saying what happened, in the words of whatever did it. If the thread had already moved on (you answered it elsewhere, say), the line says that instead, and if it didn't work the card stays.

At the top, Aldo's face and a line say what it's at: thinking, or how many things wait on you and how many threads are working ("2 need you · 3 working"). Tap it to see what's working now and what's coming up. The pencil at the top right starts a thread in General, a project or a repository.

Before you've said anything, the page is just Aldo, a question and the box to type in, with three things to start from under it (**More ideas** for the rest). Tapping one fills the box for you to finish; nothing is sent until you send it. Your first message slides the box down to its place.

When you've scrolled up, what arrives below waits behind **New from Aldo**.

## Simple mode

If you only talk to Aldo and never open a thread yourself, simple mode trades the sidebar for a narrow rail with three places:

- **Aldo**: your conversation with Aldo. Type to it, or tap the orb to talk.
- **Needs you**: everything waiting on you, with how many on the rail: approvals, questions, plans, what only you can do in an agent's browser, and pull requests ready to merge. Answer each right there, or **Go through them with Aldo** on a call.
- **Library**: everything your agents shared by link, newest first. See [the Library](./aldo-library.md).

Tapping a thread (**Open** on something that needs you, say) opens it with the rail still beside it. At the foot of the rail, **Full view** brings the sidebar back, and your picture opens your account. On a phone, the three places are tabs at the top of the home screen, and the button at the top left opens them, with **Full view** and your account.

Turn simple mode on or off in **Settings → General → Layout**, or with the **Simple mode** switch in your account. It's off unless you turn it on, and it applies to the device you set it on.

## Your brief

The first time you open Aldo each day (from 4 in the morning where you are), Aldo starts the day's conversation with a brief: a few sentences on where everything stands, and what's left on your calendar today when you've connected one.

The few things Aldo thinks you should decide first come first in what needs you. When Aldo has a reason to think it knows your answer to a question (something you told it before), that choice is marked **Aldo's pick**, with why. Email, events and merges ask before they go ahead.

- **Listen**, beside the brief's title, reads it aloud in Aldo's voice.
- **Go through them with Aldo**, over what needs you, starts a call with Aldo that takes you through what's waiting on you, one at a time (below).

Aldo remembers what it said in the brief, so you can ask about it afterwards.

## Going through them with Aldo

On **Go through them**, Aldo puts each decision to you out loud while your screen shows it with its choices. Answer out loud and Aldo acts on it, or tap a choice. **Skip for now** moves on, and **Open the thread** takes you to it. When you've been through them all, Aldo says so. Hanging up ends it; the call can carry on without it.

## On a phone

On a phone the home screen is the same conversation, with the button beside the box to talk. A call fills the screen: Aldo's words as it says them, what it did on this call, and **Mute**, **Type** and **End**. The arrow at the top folds the call away so you can use the app while it goes on; the dot beside the box brings it back. The speaker button turns Aldo's voice off, leaving its words on screen. Your threads are in the sidebar, behind the button at the top left.

## The board

Where Aldo's assistant isn't available, the home screen is the board instead. The board answers four questions, in order, starting with what waits on a tap from you.

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

On the board, **j** and **k** move through the threads, **Enter** opens the selected one, and **/** goes to Aldo's composer. In the conversation, **j** and **k** move between what needs you, and **Enter** opens the one you're on (or, once it's open, its thread); nothing is answered without a button.

## Aldo

On the board, Aldo sits beside it (on a phone, below it, folded under what it last said). Type to it, or tap the orb to talk. Chips under the composer offer things to say: what needs you, a catch-up, what shipped, or starting something in a repository you work in.

Typed, your words go to Aldo in writing: it reads your threads, acts when you ask it to, and replies with what it did, each action linked to its thread. The conversation carries on turn after turn, and Aldo remembers it the next time, spoken or typed. On a call, typing goes into the call instead.

On a call, Aldo keeps track of the work it hands to threads. When one comes back with an answer, needs you, runs into trouble or has to wait to start, or an agent has something to tell you, Aldo brings it up on its own at a pause in the conversation, never over you or while it's working on something you asked. Each piece of news is told once, with a line in the conversation that opens its thread. Aldo only tells you what has actually happened, and news is never permission: it acts on it only when you ask it to. What comes back after you hang up waits in Aldo, and a call you start again soon after hears it.
