# Pull requests in Aldo

When an agent opens a pull request, Aldo follows it through to production.

## While it's open

Aldo checks the pull request every few minutes. When checks fail or someone comments, it sends the agent a message with the failures and the comments, and the agent fixes them and pushes. Notes that bots post for information, such as deploy links and review summaries, aren't passed on. After automated reviewers have commented on three commits, the agent asks you whether to keep going instead of fixing their new comments.

To stop, tell the agent to stop following the pull request, or choose **Stop following through** in the thread's **Preview** menu.

## Where it is

The thread's **Preview** menu lists the pull requests Aldo follows, each with where it is:

| Shown              | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| checks 3/4         | Checks are running; three of four have passed                             |
| 1 check failing    | The agent has been told, and is fixing it                                 |
| checks passed      | Every check passed on the latest commit                                   |
| merged · deploying | Merged; the checks on the merge commit (CI, the deploy) are still running |
| deployed           | Merged, and every check on the merge commit passed                        |
| deploy failed      | A check on the merge commit failed; the agent has been told               |
| draft              | A draft; Aldo doesn't merge drafts                                        |

"2 fixes" after a stage counts the times Aldo has sent the agent something to fix.

## Merging

How pull requests merge is your workspace's policy, which agents ask you about the first time it matters:

- **Merge when green**: Aldo merges a pull request that isn't a draft once its checks have passed on the same commit for 10 minutes and the agent isn't working. It uses the merge method recorded for that repository, or your git host's default.
- **Wait for approval**: the pull request waits for you.

Either way, you can merge a pull request whose checks all passed with **Merge** in the **Preview** menu. Aldo asks you to confirm, then checks it again with your git host: it merges only an open pull request that isn't a draft and whose checks all passed, at that exact commit. If anything changed, or your git host refuses (a conflict, a required review, a disconnected account), nothing is merged and Aldo says why.

## After it merges

Aldo watches the checks on the merge commit, which is where CI and deploys report, for up to 30 minutes. Then it tells the agent how it went: a failure with its link, or that it's live. The agent checks the running app and tells you.
