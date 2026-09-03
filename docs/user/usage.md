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

Workspace credits come from Aldo's billing ledger, not from provider transcripts, so they stay
visible while environments are still reporting and while a paused workspace cannot report at all.
The refresh control reloads them along with the token totals.
