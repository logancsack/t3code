# Managed Aldo Agent integration

Managed builds expose Aldo Agent in the workspace sidebar. The conversation iframe is
served by the managed gateway at `/_aldo/agent`; T3 does not hold voice-provider keys or
run the coordinator model. The panel provider sits above the responsive sidebar so
mobile dismissal, navigation, and minimization preserve an opened session. Closing the
panel unmounts its frame and disconnects voice; delegated T3 work remains independent.

`GET /api/_devpc/agent/snapshot` returns the current shell projection to the workspace
coordinator. With `?threadId=...`, it returns that thread's detail snapshot bounded to
three turns. Both forms require managed mode and `x-devpc-gateway-token`; absent or
invalid capabilities receive 404. Responses are private and uncacheable. This route
uses the same workspace-local capability as managed dispatch and is not a new public
agent authorization mechanism.

The coordinator sends work through the existing durable managed dispatch endpoint.
Task creation therefore retains T3's ordinary command receipts, bootstrap transaction,
worktree preparation, provider execution, and approval behavior.
