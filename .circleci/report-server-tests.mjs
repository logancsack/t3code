// Temporary diagnostics for the server failure that does not reproduce locally.
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";

const read = (path) => {
  try {
    return NodeFS.readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
let results = {};
try {
  results = JSON.parse(read("/tmp/server-results.json"));
} catch {}
const failed = (results.testResults ?? []).filter((test) => test.status === "failed");
const body = {
  revision: NodeChildProcess.execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  job: process.env.CIRCLE_BUILD_NUM,
  exitCode: Number(process.argv[2]),
  summary: {
    files: results.numTotalTestSuites,
    failedFiles: results.numFailedTestSuites,
    tests: results.numTotalTests,
    failedTests: results.numFailedTests,
  },
  failed: failed.slice(0, 5).map((test) => ({
    name: test.name,
    message: test.message?.slice(-4000),
    assertions: (test.assertionResults ?? [])
      .filter((test) => test.status === "failed")
      .slice(0, 5)
      .map((test) => ({
        title: test.fullName,
        failures: test.failureMessages.join("\n").slice(-4000),
      })),
  })),
  tail: read("/tmp/server-tests.log").split("\n").slice(-180).join("\n").slice(-48000),
};
await fetch("https://aldo.computer/public/23mjnwvyrf/4627/ci-report", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(20000),
})
  .then((response) => console.log(`Diagnostic report delivery: ${response.status}`))
  .catch((error) => console.log(`Diagnostic report delivery failed: ${error.message}`));
