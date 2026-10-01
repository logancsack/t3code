# Your GPU computer in Aldo

Some work goes much faster on a graphics card: rendering 3D scenes in Blender, animation, and other GPU work. For that, Aldo gives you a GPU computer in the cloud, with an NVIDIA RTX 4090. Your agents use it when a task calls for it. It has no screen of its own: your agent works on it from its own machine and brings the results back.

## When an agent asks for it

An agent that needs your GPU computer asks for it, with a line saying why. The first time a thread asks, you're asked in that thread:

> **Your agent asks for your GPU computer**
> To render the final frames of the pirate ship. 6 credits an hour while it runs. It stops when the thread is done.

- **Start it** starts the computer. It's usually running within a minute, and the agent is told when it's ready.
- **Not now** tells the agent you said no. It carries on without the computer (rendering more slowly on its own machine), or asks you about it in the chat.

If you close the question without answering, the agent keeps waiting, and you're asked again the next time you open the thread.

Once you've agreed in a thread, its agent can start the computer again later without asking.

## What it costs

The computer uses credits for every hour it runs, as the question says. It stops when the thread is done, or sooner when the agent has finished with it. You can also stop it yourself (see below). While it's stopped it uses no credits.

Unlike your Windows computer, a GPU computer starts fresh each time: nothing is kept on it once it stops. Your agent keeps its work, such as scenes, scripts and renders, on its own machine and copies what it needs over.

## Seeing it, and stopping it

While your GPU computer starts or runs, the thread's header shows **GPU** next to **Preview**. Choose it to see what it costs, and choose **Stop it** to stop it. It stops right away, without asking, and anything it was in the middle of, such as a render, is lost, so let your agent finish first if it's busy. You can also stop it from the message that says it's starting. Your agent can start it again when it needs it.

## What it can reach

The GPU computer can install software from the usual package sources, but it can't reach the whole internet. Your agent copies anything else it needs from its own machine.
