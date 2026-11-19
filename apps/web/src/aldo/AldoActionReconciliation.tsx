import { useState } from "react";
import { Button } from "../components/ui/button";
import { saveAldoVerification, type AldoActivity } from "./activity";

/** Saved account observations; these controls never execute the action again. */
export function AldoActionReconciliation(props: {
  environmentId: string;
  conversation: string;
  data: AldoActivity;
  onSaved: () => void;
}) {
  const effects = props.data.effects.filter((e) => ["pending", "uncertain"].includes(e.status));
  const reservations = (props.data.reservations ?? []).filter(
    (r) => r.status === "reserved" && r.authority !== "link",
  );
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!effects.length && !reservations.length) return null;
  const save = async (input: Record<string, unknown>) => {
    setSaving(`${input.id}:${input.outcome}`);
    setError(null);
    try {
      await saveAldoVerification(props.environmentId, props.conversation, {
        ...input,
        checkedAccount: true,
      });
      props.onSaved();
    } catch {
      setError(
        "Couldn’t confirm your account check was saved. Refresh activity to see its recorded state.",
      );
      props.onSaved();
    } finally {
      setSaving(null);
    }
  };
  return (
    <details className="space-y-3">
      <summary className="min-h-11 cursor-pointer py-3 font-medium sm:min-h-8 sm:py-2">
        Actions needing an account check
      </summary>
      <p>
        Check the account’s sent messages, events or charges before recording an outcome. A missing
        draft is not proof that a message was unsent. Recording your check does not repeat the
        action.
      </p>
      <label className="flex items-start gap-2 py-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={!!saving}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>I checked the account for the action I’m updating below.</span>
      </label>
      {effects.map((e) => (
        <div key={e.id} className="space-y-2 border-t pt-3">
          <p>
            {e.provider} · {e.operation.replaceAll(".", " ")} · {new Date(e.at).toLocaleString()}
          </p>
          {e.display ? (
            <p className="break-words">
              {e.display.subject} · {e.display.destination ?? e.display.to?.join(", ")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              No identifying details are retained. Match the account action carefully before
              updating it.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={!checked || !!saving}
              onClick={() => void save({ action: "receipt", id: e.id, outcome: "happened" })}
            >
              {saving === `${e.id}:happened` ? "Saving check…" : "Confirmed it happened"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={!checked || !!saving}
              onClick={() => void save({ action: "receipt", id: e.id, outcome: "did_not_happen" })}
            >
              {saving === `${e.id}:did_not_happen`
                ? "Saving check…"
                : "Confirmed it did not happen"}
            </Button>
          </div>
        </div>
      ))}
      {reservations.map((r) => (
        <form
          key={r.id}
          className="space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("outcome");
            if (typeof value === "string" && value)
              void save({
                action: "reservation",
                id: r.id,
                outcome: value === "no_charge" ? "no_charge" : "charged",
                ...(value === "no_charge" ? {} : { spendId: value }),
              });
          }}
        >
          <label className="block space-y-1">
            <span>${Number(r.amount).toFixed(2)} reserved · observed outcome</span>
            <select
              name="outcome"
              required
              disabled={!!saving}
              className="min-h-11 w-full rounded-md border bg-background p-2"
            >
              <option value="">Choose the account outcome</option>
              <option value="no_charge">Confirmed no charge</option>
              {(props.data.ledger ?? [])
                .filter((s) => Number(s.amount) === Number(r.amount))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    Charged · {s.what} · ${Number(s.amount).toFixed(2)}
                  </option>
                ))}
            </select>
          </label>
          <p className="text-muted-foreground">
            A charge needs its matching recorded spend. An unknown outcome keeps the reservation
            held.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            type="submit"
            disabled={!checked || !!saving}
          >
            {saving?.startsWith(`${r.id}:`) ? "Saving check…" : "Record account outcome"}
          </Button>
        </form>
      ))}
      {error ? (
        <div>
          <p role="status">{error}</p>
          <Button variant="outline" className="min-h-11 sm:min-h-8" onClick={props.onSaved}>
            Refresh activity
          </Button>
        </div>
      ) : null}
    </details>
  );
}
