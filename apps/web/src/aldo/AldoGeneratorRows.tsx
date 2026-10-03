// Settings → Integrations' image, video and audio generators (Runway,
// Higgsfield, …): each connects with the user's own API key, which Aldo keeps
// in their vault, so agents use it without ever
// holding it. The server names and describes each one, so a generator a newer
// Aldo adds shows here as it is.

import { CheckCircle2Icon, ExternalLinkIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { SettingsRow } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toastManager } from "../components/ui/toast";
import {
  connectAldoIntegrationKey,
  disconnectAldoIntegration,
  type AldoIntegration,
  type AldoIntegrationKeyField,
} from "./cloud";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const ONE_KEY: ReadonlyArray<AldoIntegrationKeyField> = [{ name: "key", label: "API key" }];

function GeneratorRow(props: {
  readonly integration: AldoIntegration;
  readonly onChanged: () => void;
}) {
  const { integration } = props;
  const fields = integration.fields?.length ? integration.fields : ONE_KEY;
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const complete = fields.every((field) => (values[field.name] ?? "").trim() !== "");

  useEffect(() => {
    if (!integration.connected) setConfirming(false);
    if (!integration.available) {
      setOpen(false);
      setValues({});
      setError(null);
    }
  }, [integration.available, integration.connected]);

  const close = () => {
    setOpen(false);
    setValues({});
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!integration.available) return;
    setBusy(true);
    setError(null);
    try {
      await connectAldoIntegrationKey(integration.provider, values);
      close();
      props.onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    setBusy(true);
    disconnectAldoIntegration(integration.provider)
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: `Couldn't disconnect ${integration.name}`,
          description: messageOf(cause),
        }),
      )
      .finally(() => {
        setBusy(false);
        setConfirming(false);
        props.onChanged();
      });
  };

  return (
    <SettingsRow
      title={integration.name}
      description={integration.description}
      status={
        !integration.available ? (
          `${integration.name} isn't available on this Aldo yet.`
        ) : integration.connected && integration.error ? (
          <span className="text-destructive-foreground">{integration.error}</span>
        ) : integration.connected ? (
          <span className="inline-flex items-center gap-1 text-success-foreground">
            <CheckCircle2Icon className="size-3.5" />
            Connected
          </span>
        ) : (
          "Not connected"
        )
      }
      control={
        <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
          {confirming && integration.connected ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={disconnect}>
                Disconnect
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant={integration.connected ? "ghost" : "outline"}
                disabled={busy || !integration.available}
                onClick={() => (open ? close() : setOpen(true))}
              >
                {open ? "Cancel" : integration.connected ? "Replace key" : "Connect"}
              </Button>
              {integration.connected && !open ? (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                  Disconnect
                </Button>
              ) : null}
            </>
          )}
        </div>
      }
    >
      {open && integration.available ? (
        <form
          onSubmit={submit}
          className="mb-3 space-y-3 rounded-xl border border-border p-3"
          autoComplete="off"
        >
          <p className="text-muted-foreground text-xs">
            Aldo keeps it in your vault: agents use it without ever seeing it, and what they make is
            billed to your {integration.name} account.
            {integration.keyUrl ? (
              <>
                {" "}
                <a
                  className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2"
                  href={integration.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get a key <ExternalLinkIcon className="size-3" />
                </a>
              </>
            ) : null}
          </p>
          <div className={fields.length > 1 ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
            {fields.map((field) => (
              <label key={field.name} className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">{field.label}</span>
                <Input
                  type="password"
                  placeholder={field.placeholder}
                  autoComplete="off"
                  value={values[field.name] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.name]: e.currentTarget.value })}
                />
              </label>
            ))}
          </div>
          {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !complete}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      ) : null}
    </SettingsRow>
  );
}

/** The generators this Aldo offers (integrations of kind "key"), each with its key form. */
export function AldoGeneratorRows(props: {
  readonly integrations: ReadonlyArray<AldoIntegration>;
  readonly onChanged: () => void;
}) {
  return (
    <>
      {props.integrations.map((integration) => (
        <GeneratorRow
          key={integration.provider}
          integration={integration}
          onChanged={props.onChanged}
        />
      ))}
    </>
  );
}
