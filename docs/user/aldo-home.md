# The home screen in Aldo

Aldo's home screen is where you see all of your agents' work at once and act on it, with Aldo to hand. Nothing on it wakes a sleeping agent: everything comes from what Aldo already knows.

## The board

The board answers four questions, in order.

**Needs you.** Every thread waiting on you, the one that has waited longest first:

- A **question** shows its choices. Tap one to answer, or type an answer of your own. A question that allows several choices sends them together.
- An **approval** shows what the agent wants to do, with its details, and the choices the agent offered (allow, allow for this session, deny).
- A **plan to approve** shows the plan. **Approve plan** has the agent carry it out; **Ask for changes** sends your changes back for a revised plan.
- A thread that **stopped with an error** says why.

Answering a thread whose agent has gone to sleep wakes it, so a button can take a moment. **Open** goes to the thread; **Ask Aldo** starts a message to Aldo about it.

**Working now.** Each thread that's working, with its model, how long it has been at it, and what it last said. A thread that hasn't moved for an hour is marked **stuck**. A thread whose machine is running short of memory or CPU offers **Switch to 2× machine** here.

**Pull requests.** Every pull request Aldo follows, in three lanes: **open** (draft, checks running, failing, or green), **shipping** (merged, deploying), and **shipped** (deployed in the last two days). Each shows its stage, how many fixes the agent has made, whether reviews went to you, and, when your policy has Aldo merge green pull requests, when it will. **Merge** merges a green one yourself. See [Pull requests in Aldo](./aldo-pull-requests.md).

**Coming up.** Reminders agents set for themselves, messages of yours waiting for a busy thread, and routine runs waiting for theirs. **Send now** sends one without waiting; **Cancel** drops it.

**Routines.** What you have Aldo do on a schedule or when a webhook is called: when each runs next, how its last run went, and its thread. **Run now**, **Pause** and **Remove** are on each; **New routine** sets one up. See [Routines in Aldo](./aldo-routines.md).

**Done.** Threads that finished in the last two days. What's new since you last opened the home screen on this device is marked. **Catch me up** has Aldo tell you.

**What Aldo did.** What Aldo did for you lately, with the words of yours it acted on, and what went wrong when it couldn't.

Below those, a line shows how many agents are running against your plan, your credits, and what agents have spent, and **How Aldo works for you** shows the policy your agents follow (merging, spending, automated reviews).

When something needs fixing, a strip at the top says so: an agent that's signed out on your cloud agents, credits used up, an environment that failed to build, or notifications off on this device. Each has a way to fix it.

## Starting work

At the top, **New project** creates a repository and starts a thread in it, **Open a repository** starts one in repositories you have, and **New thread** starts one in no repository, for work that isn't code (see [Threads without a repository](./aldo-general-threads.md)). Or tell Aldo what you want done.

## Narrowing and moving

With threads in more than one repository, chips at the top narrow the whole board to one.

On a keyboard, **j** and **k** move through the threads, **Enter** opens the selected one, and **/** goes to Aldo's composer.

## Aldo

Aldo sits beside the board (on a phone, below it, folded under what it last said). Type to it, or tap the orb to talk. Chips under the composer offer things to say: what needs you, a catch-up, what shipped, or starting something in a repository you work in.

Typed, your words go to Aldo in writing: it reads your threads, acts when you ask it to, and replies with what it did, each action linked to its thread. The conversation carries on turn after turn, and Aldo remembers it the next time, spoken or typed. On a call, typing goes into the call instead.
