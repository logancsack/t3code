import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { AldoApiError } from "./api";
import { fetchAldoActivity, saveAldoVerification, type AldoActivity } from "./activity";
import { AldoWorkflowBaseline } from "./AldoWorkflowBaseline";

const dollars = (value: number | string | null | undefined) =>
  value == null ? "Unknown" : `$${Number(value).toFixed(2)}`;
const time = (at: string) =>
  new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** On-demand evidence in the existing thread; no background polling or new work mode. */
export function AldoActivityDialog(props: {
  environmentId: string;
  conversation: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<AldoActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!props.open) return;
    let current = true;
    setData(null);
    setError(null);
    setLoading(true);
    void fetchAldoActivity(props.environmentId, props.conversation)
      .then((next) => {
        if (current) {
          if (next.version === 1) setData(next);
          else setError("This activity report needs a newer app. Your work can continue.");
        }
      })
      .catch((cause: unknown) => {
        if (current)
          setError(
            cause instanceof AldoApiError && cause.status === 404
              ? "Saved activity isn’t available for this thread yet. Your work can continue."
              : "Couldn’t load activity. Try again.",
          );
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [props.open, props.environmentId, props.conversation, revision]);
  const [paging, setPaging] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const review = async (turnId: string, criterion: string, verdict: string) => {
    setReviewing(criterion);
    setReviewError(null);
    try {
      await saveAldoVerification(props.environmentId, props.conversation, {
        action: "review",
        turnId,
        criterion,
        verdict,
      });
      setRevision((n) => n + 1);
    } catch {
      setReviewError("Couldn’t save your check. Try again.");
    } finally {
      setReviewing(null);
    }
  };
  const more = async () => {
    if (!data?.next || paging) return;
    setPaging(true);
    setError(null);
    try {
      const next = await fetchAldoActivity(props.environmentId, props.conversation, data.next);
      // A request from a thread left behind cannot populate a different dialog.
      setData((previous) =>
        previous === data
          ? { ...data, next: next.next, events: [...data.events, ...next.events] }
          : previous,
      );
    } catch {
      setError("Couldn’t load older activity. Try again.");
    } finally {
      setPaging(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Activity and evidence</DialogTitle>
          <DialogDescription>
            Saved actions, reported results and cost for this thread.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {loading ? <p role="status">Loading saved activity…</p> : null}
          {error ? (
            <div role="status" className="space-y-2">
              <p>{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (data ? void more() : setRevision((n) => n + 1))}
              >
                Retry
              </Button>
            </div>
          ) : null}
          {data ? (
            <div className="space-y-5 text-sm">
              <p className="text-muted-foreground">
                {data.stream
                  ? `Last reported ${time(data.stream.reportedAt)}.${data.stream.partial ? " Some activity may be missing." : ""}`
                  : "No activity report has arrived yet. An empty history doesn’t mean no work happened."}{" "}
                Tool observations describe what ran; platform receipts confirm recorded effects.
              </p>
              <details className="space-y-3" open>
                <summary className="cursor-pointer py-2 font-medium">Results and receipts</summary>
                {data.turns
                  .filter((t) => t.taskResult)
                  .map((t) => (
                    <div key={t.id} className="space-y-2 rounded-lg border p-3">
                      <p className="font-medium">
                        Reported {t.taskResult!.state.replaceAll("_", " ")}
                      </p>
                      {t.taskResult!.doneWhen.map((c) => (
                        <div key={c.criterion} className="space-y-1 break-words">
                          <p>
                            {c.met ? "Reported met" : "Unmet"}: {c.criterion}
                            <span className="block text-muted-foreground">
                              {c.evidence || "No evidence supplied."}
                            </span>
                            <span className="block text-muted-foreground">
                              {c.verification
                                ? `Independent check: ${c.verification.verdict} · ${c.verification.verifier.replaceAll("_", " ")}`
                                : "Independent check: unverified"}
                            </span>
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={reviewing !== null}
                            onClick={() =>
                              void review(
                                t.id,
                                c.criterion,
                                c.verification?.verifier === "owner_review_v1" &&
                                  c.verification.verdict !== "unverified"
                                  ? "unverified"
                                  : c.met
                                    ? "passed"
                                    : "failed",
                              )
                            }
                          >
                            {reviewing === c.criterion
                              ? "Saving check…"
                              : c.verification?.verifier === "owner_review_v1" &&
                                  c.verification.verdict !== "unverified"
                                ? "Clear my check"
                                : "I checked this"}
                          </Button>
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">
                        Reported by the agent; independent verification is separate.
                      </p>
                    </div>
                  ))}
                {data.effects.map((e) => (
                  <div key={e.id} className="break-words rounded-lg border p-3">
                    <p>
                      {e.operation.replaceAll(".", " · ")} · {e.status}
                    </p>
                    <p className="text-muted-foreground">
                      {e.receipt
                        ? `Provider receipt: ${e.receipt}`
                        : "No provider receipt recorded."}
                    </p>
                  </div>
                ))}
                {!data.effects.length && !data.turns.some((t) => t.taskResult) ? (
                  <p className="text-muted-foreground">
                    No result or platform receipt is recorded yet.
                  </p>
                ) : null}
              </details>
              <details className="space-y-3">
                <summary className="cursor-pointer py-2 font-medium">Cost and coverage</summary>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 tabular-nums">
                  <dt>Computer credits · shared</dt>
                  <dd>{Number(data.cost.chargedCredits.machineCredits).toLocaleString()}</dd>
                  <dt>Model credits · shared</dt>
                  <dd>{Number(data.cost.chargedCredits.modelCredits).toLocaleString()}</dd>
                  <dt>Provider API cost · shared</dt>
                  <dd>{dollars(data.cost.modelApiCost.providerUsd)}</dd>
                  <dt>Subscription use at API prices · shared</dt>
                  <dd>{dollars(data.cost.subscriptionReference?.referenceUsd)}</dd>
                  <dt>This thread’s estimated reference share</dt>
                  <dd>{dollars(data.cost.conversationReference?.usd)}</dd>
                  <dt>Recorded purchases · shared</dt>
                  <dd>{dollars(data.cost.externalPurchases.usd)}</dd>
                </dl>
                <p className="text-muted-foreground">{data.cost.note}</p>
                {data.cost.modelApiCost.pending ||
                data.cost.modelApiCost.unpriced ||
                Number(data.cost.subscriptionReference?.unpricedRecords) ? (
                  <p className="text-muted-foreground">Some model costs are pending or unpriced.</p>
                ) : null}
              </details>
              {reviewError ? <p role="status">{reviewError}</p> : null}
              {data.workflow ? (
                <AldoWorkflowBaseline
                  environmentId={props.environmentId}
                  conversation={props.conversation}
                  workflow={data.workflow}
                  onSaved={() => setRevision((n) => n + 1)}
                />
              ) : null}
              <details className="space-y-3">
                <summary className="cursor-pointer py-2 font-medium">Requests and routing</summary>
                {data.home.map((h) => (
                  <p key={h.id} className="break-words">
                    Home · {h.tool.replaceAll("_", " ")} · {h.outcome}
                  </p>
                ))}
                {data.routing.map((r) => (
                  <p key={r.id} className="break-words">
                    {r.reason}
                  </p>
                ))}
                {!data.home.length && !data.routing.length ? (
                  <p className="text-muted-foreground">
                    No linked request or routing decision recorded.
                  </p>
                ) : null}
              </details>
              <details className="space-y-3">
                <summary className="cursor-pointer py-2 font-medium">
                  Observed actions · {data.events.length}
                </summary>
                <ol className="space-y-3">
                  {data.events.map((e) => (
                    <li key={e.id} className="break-words">
                      <p>
                        {e.name.replaceAll("_", " ")} · {e.status}
                      </p>
                      <time className="text-xs text-muted-foreground" dateTime={e.at}>
                        {time(e.at)}
                      </time>
                    </li>
                  ))}
                </ol>
                {!data.events.length ? (
                  <p className="text-muted-foreground">No observed actions have arrived.</p>
                ) : null}
                {data.next ? (
                  <Button variant="outline" size="sm" disabled={paging} onClick={() => void more()}>
                    {paging ? "Loading…" : "Older activity"}
                  </Button>
                ) : null}
              </details>
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
