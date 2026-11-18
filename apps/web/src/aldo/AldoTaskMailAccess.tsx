import { useId, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { saveAldoVerification, type AldoActivity } from "./activity";

/** Owner-controlled scope on the mediated inbox path. No model can grant it. */
export function AldoTaskMailAccess(props: {
  environmentId: string;
  conversation: string;
  grants: NonNullable<AldoActivity["mailGrants"]>;
  onSaved: () => void;
}) {
  const [recipients, setRecipients] = useState("");
  const [messages, setMessages] = useState("1");
  const [saving, setSaving] = useState<string | null>(null);
  const [failedSnapshot, setFailedSnapshot] = useState<typeof props.grants | null>(null);
  const needsRefresh = failedSnapshot === props.grants;
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputErrorId = useId();
  const [error, setError] = useState<string | null>(null);
  const save = async (input: Record<string, unknown>) => {
    setSaving(input.action === "mail_grant" ? "create" : String(input.id));
    setError(null);
    try {
      await saveAldoVerification(props.environmentId, props.conversation, input);
      if (input.action === "mail_grant") setRecipients("");
      props.onSaved();
    } catch {
      setError(
        "Couldn’t confirm email access was saved. Refresh recorded access before trying again.",
      );
      setFailedSnapshot(props.grants);
      props.onSaved();
    } finally {
      setSaving(null);
    }
  };
  return (
    <details className="space-y-3">
      <summary className="min-h-11 cursor-pointer py-3 font-medium sm:min-h-8 sm:py-2">
        Task email access
      </summary>
      <p className="text-muted-foreground">
        For tasks using the scoped agent inbox, allow messages to these recipients for seven days.
        Repeating the same scope does not add messages. Remove existing access before changing a
        recipient’s allowance. This does not send a message or authorize a purchase, agreement or
        other commitment. Other account paths keep their existing permissions.
      </p>
      {props.grants.map((grant) => (
        <div key={grant.id} className="space-y-2 border-t pt-3">
          <p className="break-words">
            {grant.recipients.join(", ")} ·{" "}
            {grant.remaining === undefined
              ? `up to ${grant.messageLimit} messages`
              : `${grant.remaining} of ${grant.messageLimit} messages remaining`}{" "}
            · expires {new Date(grant.expiresAt).toLocaleDateString()}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={!!saving || needsRefresh}
            onClick={() => void save({ action: "mail_revoke", id: grant.id })}
          >
            {saving === grant.id ? "Removing access…" : "Remove access"}
          </Button>
        </div>
      ))}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const addresses = [
            ...new Set(
              recipients
                .split(/[,;\s]+/)
                .filter(Boolean)
                .map((s) => s.toLowerCase()),
            ),
          ];
          if (
            !addresses.length ||
            addresses.length > 20 ||
            addresses.some(
              (a) =>
                a.length > 254 ||
                !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(a),
            )
          ) {
            setValidationError("Enter up to twenty valid email addresses, separated by commas.");
            return;
          }
          setValidationError(null);
          void save({
            action: "mail_grant",
            recipients: addresses,
            messages: Number(messages),
          });
        }}
      >
        <label className="block space-y-1">
          <span>Task recipients · separate with commas</span>
          <Input
            value={recipients}
            maxLength={5100}
            required
            disabled={!!saving || needsRefresh}
            aria-invalid={!!validationError}
            aria-describedby={validationError ? inputErrorId : undefined}
            onChange={(event) => setRecipients(event.target.value)}
          />
          {validationError ? (
            <span id={inputErrorId} role="alert">
              {validationError}
            </span>
          ) : null}
        </label>
        <label className="block space-y-1">
          <span>Message limit</span>
          <Input
            type="number"
            min={1}
            max={20}
            step={1}
            value={messages}
            required
            disabled={!!saving || needsRefresh}
            onChange={(event) => setMessages(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          type="submit"
          disabled={!!saving || needsRefresh}
        >
          {saving === "create" ? "Saving access…" : "Allow task email"}
        </Button>
      </form>
      {error ? (
        <div>
          <p role="status">{error}</p>
          <Button
            variant="outline"
            className="min-h-11 sm:min-h-8"
            disabled={!!saving}
            onClick={props.onSaved}
          >
            Refresh recorded access
          </Button>
        </div>
      ) : null}
    </details>
  );
}
