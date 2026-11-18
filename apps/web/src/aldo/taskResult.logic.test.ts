import * as NodeAssert from "node:assert/strict";
import { it as test } from "vite-plus/test";
import {
  checkedTaskResult,
  endsOnRequest,
  taskResultOf,
  withoutTaskResult,
} from "./taskResult.logic";

const result = () => ({
  state: "finished",
  doneWhen: [
    {
      criterion: "The page works on a phone",
      met: true,
      evidence: "Opened the preview at 390px; screenshot saved.",
    },
  ],
  checked: ["Opened the preview at 390px."],
  notChecked: ["Production sign-in was not checked."],
  decided: [
    { what: "Skipped the optional field", why: "No fact on record", undo: "Edit the listing" },
  ],
});
const report = (value: unknown) => "```aldo-result\n" + JSON.stringify(value) + "\n```";

test("a completion report preserves every criterion and the checked/not-checked words", () => {
  NodeAssert.deepEqual(taskResultOf("The preview is ready.\n\n" + report(result())), result());
  NodeAssert.deepEqual(
    taskResultOf(report(result()) + "\n\n```aldo-next\nPublish the page\n```"),
    result(),
  );
  NodeAssert.equal(
    withoutTaskResult("The preview is ready.\n" + report(result())),
    "The preview is ready.",
  );
  NodeAssert.equal(taskResultOf(report(result()) + "\nThis was only an example."), null);
});
test("a finished claim cannot pass with missing, unmet, untyped or empty evidence", () => {
  for (const doneWhen of [
    [],
    [{ criterion: "Live", met: false, evidence: "Not deployed" }],
    [{ criterion: "Live", met: true, evidence: "" }],
  ]) {
    NodeAssert.equal(taskResultOf(report({ ...result(), doneWhen }))?.state, "unfinished");
  }
  NodeAssert.equal(
    checkedTaskResult({
      ...result(),
      doneWhen: [{ criterion: "Live", met: "true", evidence: "A link" }],
    }),
    null,
  );
  NodeAssert.equal(taskResultOf("```aldo-result\nnot JSON\n```"), null);
  NodeAssert.equal(checkedTaskResult({ ...result(), checked: ["x".repeat(801)] }), null);
});
test("a closing question counts as waiting; code, quotes and suggested follow-ups do not", () => {
  NodeAssert.equal(endsOnRequest("Which prospect should I use?"), true);
  NodeAssert.equal(
    taskResultOf("Can you supply the missing fact?\n" + report(result()))?.state,
    "blocked_on_user",
  );
  for (const value of [
    "Done.\n```js\nconst query = '?'\n```",
    "Done.\n> Is it ready?",
    "Done.\n```aldo-next\nDeploy it?\n```",
    "The answer is 42.",
  ])
    NodeAssert.equal(endsOnRequest(value), false);
});

test("a final request stays waiting when its terms or a link follow it", () => {
  for (const words of [
    "Do you approve merging this? Deployment needs separate approval.",
    "Please provide that log. Nothing was pushed.\n\n[Findings](https://example.com/report) — only you can open it.",
    "I'm stopping here until you approve.",
    "Waiting for your yes.",
  ]) {
    NodeAssert.equal(endsOnRequest(words), true, words);
    NodeAssert.equal(taskResultOf(words + "\n" + report(result()))?.state, "blocked_on_user");
  }
  for (const words of [
    "Production is not checked.",
    "Say what done means first is a heading.",
    "The report includes the quote:\n> Do you approve it?",
    "The deployment needs a separate check.",
  ])
    NodeAssert.equal(endsOnRequest(words), false, words);
});
