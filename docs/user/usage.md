# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart, and refreshing rescans every connected environment.

## Aldo workspace

In an Aldo workspace, the Usage page also shows the compute credits for the workspace itself,
below the cost chart: credits left this cycle, the plan and its included credits, added capacity,
the projected total at renewal, the estimated bill, and the current hardware with its hourly credit
rate. When included or authorized credits run low, the same warning Aldo shows on its account page
appears here. **Manage capacity** opens the Aldo account page, where you can add credits or upgrade
hardware. Complimentary workspaces show their hardware but no credit meter.

With Aldo cloud agents, the section shows the credits of your Aldo plan instead. A credit is an
hour of a standard machine; a 2× machine uses 2 an hour. Past the plan's included credits, agents
keep working as extra usage, billed per credit, up to your extra usage limit. **Extra usage limit**
sets that limit in dollars; set it to $0 to stop at the included credits. When credits and the
limit are used up, cloud agents stop once their turn finishes and won't start until the next
cycle or a higher limit. If Aldo can't start a cloud agent when you send a message (no plan, no
credits left, or your plan's agents at once all busy), a notice says why.

Workspace credits come from Aldo's billing ledger, not from provider transcripts, so they stay
visible while environments are still reporting and while a paused workspace cannot report at all.
The refresh control reloads them along with the token totals.

## A thread's cost in Aldo

With Aldo cloud agents, a thread's Aldo menu in its header says what the work has cost so far at
API prices: what the agents on its machine used, as the Usage page adds it up from their session
history over the past 90 days. When several conversations share the machine, it shows this
conversation's estimated share, by the tokens its turns processed, with the machine's total beside
it; a conversation whose share isn't known yet shows only the machine's total. Like the Usage page,
it says what the tokens would cost through the providers' APIs, not what your subscription bills.
