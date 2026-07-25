"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, LoaderIcon, PlugIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AuthConnectorKind,
  AuthConnectorMethod,
  AuthConnectorSession,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { readLocalApi } from "../../localApi";
import { usePrimaryEnvironment } from "../../state/environments";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

export type AuthConnectorMethodOption = {
  readonly method: AuthConnectorMethod;
  readonly label: string;
  readonly description: string;
  readonly hostname?: string;
  readonly externalHelpUrl?: string;
  readonly externalHelpLabel?: string;
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The connection could not be completed.";
}

export function AuthConnectorDialog(props: {
  readonly connector: AuthConnectorKind;
  readonly serviceName: string;
  readonly methods: ReadonlyArray<AuthConnectorMethodOption>;
  readonly isAuthenticated: boolean;
  readonly onConnected: () => void;
}) {
  const { connector, serviceName, methods, isAuthenticated, onConnected } = props;
  const environment = usePrimaryEnvironment();
  const startConnector = useAtomCommand(sourceControlEnvironment.startAuthConnector, {
    reportFailure: false,
  });
  const getConnector = useAtomCommand(sourceControlEnvironment.getAuthConnector, {
    reportFailure: false,
  });
  const submitConnector = useAtomCommand(sourceControlEnvironment.submitAuthConnector, {
    reportFailure: false,
  });
  const cancelConnector = useAtomCommand(sourceControlEnvironment.cancelAuthConnector, {
    reportFailure: false,
  });
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<AuthConnectorSession | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [startingMethod, setStartingMethod] = useState<AuthConnectorMethod | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportedSuccess = useRef<string | null>(null);

  const selectedMethod = useMemo(
    () => methods.find((method) => method.method === session?.method) ?? null,
    [methods, session?.method],
  );

  useEffect(() => {
    if (!open || !environment || !session) return;
    if (session.status !== "starting" && session.status !== "waiting") return;
    if (session.fields.length > 0) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        const result = await getConnector({
          environmentId: environment.environmentId,
          input: { sessionId: session.id },
        });
        if (cancelled || result._tag !== "Success") return;
        setSession(result.value);
      })();
    }, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [environment, getConnector, open, session?.fields.length, session?.id, session?.status]);

  useEffect(() => {
    if (session?.status !== "succeeded" || reportedSuccess.current === session.id) return;
    reportedSuccess.current = session.id;
    onConnected();
    toastManager.add({
      type: "success",
      title: `${serviceName} connected`,
      description: "Your account is ready to use in this workspace.",
    });
  }, [onConnected, serviceName, session?.id, session?.status]);

  const reset = () => {
    setSession(null);
    setValues({});
    setStartingMethod(null);
    setIsSubmitting(false);
    setError(null);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      reset();
      return;
    }
    if (environment && session && (session.status === "starting" || session.status === "waiting")) {
      void cancelConnector({
        environmentId: environment.environmentId,
        input: { sessionId: session.id },
      });
    }
  };

  const start = async (option: AuthConnectorMethodOption) => {
    if (!environment) return;
    setError(null);
    setStartingMethod(option.method);
    const result = await startConnector({
      environmentId: environment.environmentId,
      input: {
        connector,
        method: option.method,
        ...(option.hostname ? { hostname: option.hostname } : {}),
      },
    });
    setStartingMethod(null);
    if (result._tag === "Success") {
      setSession(result.value);
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      setError(errorMessage(squashAtomCommandFailure(result)));
    }
  };

  const submit = async () => {
    if (!environment || !session) return;
    setError(null);
    setIsSubmitting(true);
    const result = await submitConnector({
      environmentId: environment.environmentId,
      input: {
        sessionId: session.id,
        values,
      },
    });
    setIsSubmitting(false);
    if (result._tag === "Success") {
      setSession(result.value);
      setValues({});
      return;
    }
    if (!isAtomCommandInterrupted(result)) {
      setError(errorMessage(squashAtomCommandFailure(result)));
    }
  };

  const openVerificationUrl = () => {
    if (!session?.verificationUrl) return;
    openExternal(session.verificationUrl);
  };

  const openExternal = (url: string) => {
    const api = readLocalApi();
    if (api) {
      void api.shell.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        size="sm"
        variant={isAuthenticated ? "ghost" : "outline"}
        className="h-7 gap-1.5 px-2.5 text-xs"
        disabled={!environment}
        onClick={() => setOpen(true)}
      >
        <PlugIcon className="size-3.5" />
        {isAuthenticated ? "Reconnect" : "Connect"}
      </Button>

      <DialogPopup className="w-[min(32rem,calc(100vw-1.5rem))]">
        <DialogHeader>
          <DialogTitle>
            {session?.status === "succeeded"
              ? `${serviceName} is connected`
              : `Connect ${serviceName}`}
          </DialogTitle>
          <DialogDescription>
            {session?.message ??
              `Choose how you use ${serviceName}. Credentials stay on this workspace.`}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-4">
          {!session ? (
            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {methods.map((option) => (
                <button
                  key={option.method}
                  type="button"
                  className="flex w-full items-start justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/45 disabled:opacity-60"
                  disabled={startingMethod !== null}
                  onClick={() => void start(option)}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                  {startingMethod === option.method ? (
                    <LoaderIcon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="mt-0.5 text-muted-foreground" aria-hidden>
                      →
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : session.status === "succeeded" ? (
            <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/8 p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
                <CheckIcon className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">Ready to use</p>
                <p className="text-xs text-muted-foreground">
                  Connection status is refreshing now.
                </p>
              </div>
            </div>
          ) : session.status === "failed" ||
            session.status === "expired" ||
            session.status === "cancelled" ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-foreground">
              {session.message}
            </div>
          ) : (
            <>
              {session.userCode ? (
                <div className="rounded-xl border bg-muted/25 p-4 text-center">
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    One-time code
                  </p>
                  <button
                    type="button"
                    className="mt-2 inline-flex items-center gap-2 font-mono text-2xl font-semibold tracking-[0.12em] text-foreground"
                    onClick={() => {
                      void navigator.clipboard.writeText(session.userCode ?? "");
                      toastManager.add({
                        type: "success",
                        title: "Code copied",
                      });
                    }}
                  >
                    {session.userCode}
                    <CopyIcon className="size-3.5 text-muted-foreground" />
                  </button>
                </div>
              ) : null}

              {session.verificationUrl ? (
                <Button className="w-full" onClick={openVerificationUrl}>
                  Continue in browser
                  <ExternalLinkIcon className="size-4" />
                </Button>
              ) : null}

              {session.fields.length > 0 ? (
                <div className="space-y-3">
                  {session.fields.map((authField) => (
                    <label key={authField.key} className="block space-y-1.5">
                      <span className="text-xs font-medium text-foreground">{authField.label}</span>
                      <Input
                        type={authField.type}
                        value={values[authField.key] ?? ""}
                        placeholder={authField.placeholder}
                        autoComplete="off"
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [authField.key]: event.currentTarget.value,
                          }))
                        }
                      />
                      {authField.help ? (
                        <span className="block text-xs leading-relaxed text-muted-foreground">
                          {authField.help}
                        </span>
                      ) : null}
                    </label>
                  ))}
                  {selectedMethod?.externalHelpUrl ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => openExternal(selectedMethod.externalHelpUrl!)}
                    >
                      {selectedMethod.externalHelpLabel ?? "Create a credential"}
                      <ExternalLinkIcon className="size-3" />
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {!session.verificationUrl && session.fields.length === 0 ? (
                <div className="flex items-center gap-2 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                  <LoaderIcon className="size-4 animate-spin" />
                  Preparing secure sign-in…
                </div>
              ) : null}
            </>
          )}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </DialogPanel>

        <DialogFooter>
          {session?.status === "succeeded" ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : session?.status === "failed" ||
            session?.status === "expired" ||
            session?.status === "cancelled" ? (
            <Button
              onClick={() => {
                reset();
              }}
            >
              Try again
            </Button>
          ) : session?.fields.length ? (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  isSubmitting ||
                  session.fields.some((authField) => !(values[authField.key] ?? "").trim())
                }
                onClick={() => void submit()}
              >
                {isSubmitting ? <LoaderIcon className="animate-spin" /> : null}
                {session.flow === "code" ? "Verify code" : "Connect account"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
