import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { saveAldoVerification, type AldoActivity } from "./activity";

export function AldoWorkflowBaseline(props: {
  environmentId: string;
  conversation: string;
  workflow: NonNullable<AldoActivity["workflow"]>;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    humanMinutes: String(props.workflow.humanMinutes ?? ""),
    reviewMinutes: String(props.workflow.reviewMinutes ?? ""),
    hiringMinutesPerMonth: String(props.workflow.hiringMinutesPerMonth ?? ""),
    role: props.workflow.role ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <details className="space-y-3">
      <summary className="min-h-11 cursor-pointer py-3 font-medium sm:min-h-8 sm:py-2">
        Work estimates · optional
      </summary>
      <p className="text-muted-foreground">
        Your estimates help measure work absorbed. Leave unknown values blank. These numbers don’t
        change permissions or count an unverified job as finished.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          void saveAldoVerification(props.environmentId, props.conversation, {
            action: "baseline",
            ...Object.fromEntries(
              Object.entries(draft).map(([key, value]) => [
                key,
                key === "role" ? value || null : value === "" ? null : Number(value),
              ]),
            ),
          })
            .then(props.onSaved)
            .catch(() =>
              setError(
                "Couldn’t confirm your estimates were saved. Your entered values are still here; refresh activity to check the recorded values.",
              ),
            )
            .finally(() => setSaving(false));
        }}
      >
        {(
          [
            ["humanMinutes", "Time you would spend without the agent (minutes)"],
            ["reviewMinutes", "Your actual review and rework (minutes)"],
            ["hiringMinutesPerMonth", "Planned monthly workload (minutes)"],
            ["role", "Workload or role"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block space-y-1">
            <span>{label}</span>
            <Input
              type={key === "role" ? "text" : "number"}
              min={key === "hiringMinutesPerMonth" ? 1 : 0}
              max={key === "role" ? undefined : 1_000_000}
              maxLength={key === "role" ? 100 : undefined}
              step={key === "role" ? undefined : "any"}
              value={draft[key]}
              disabled={saving}
              onChange={(event) => setDraft((old) => ({ ...old, [key]: event.target.value }))}
            />
            {error ? (
              <span className="text-muted-foreground">
                Recorded: {String(props.workflow[key] ?? "Unknown")}
              </span>
            ) : null}
          </label>
        ))}
        {error ? (
          <div>
            <p role="status">{error}</p>
            <Button
              variant="outline"
              className="min-h-11 sm:min-h-8"
              type="button"
              onClick={props.onSaved}
            >
              Refresh activity
            </Button>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          disabled={saving}
          type="submit"
        >
          {saving ? "Saving…" : "Save estimates"}
        </Button>
      </form>
    </details>
  );
}
