"use client";

import {
  CheckIcon,
  ClipboardPasteIcon,
  CopyIcon,
  ExternalLinkIcon,
  LoaderIcon,
  PlugIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  AuthConnectorKind,
  AuthConnectorMethod,
  AuthConnectorSession,
  AuthConnectorStartInput,
  ProviderInstanceId,
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
import { Badge } from "../ui/badge";
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
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { APP_BASE_NAME } from "../../branding";
import { managedWorkspaceBrowserUrl } from "../../managedDevPc";

export type AuthConnectorMethodOption = {
  readonly method: AuthConnectorMethod;
  readonly label: string;
  readonly badgeLabel?: string;
  readonly description: string;
  readonly hostname?: string;
  readonly externalHelpUrl?: string;
  readonly externalHelpLabel?: string;
  readonly browserName?: string;
  readonly workspaceBrowser?: boolean;
  readonly authorizeInstruction?: string;
  readonly manualAuthorizeInstruction?: string;
  readonly waitingMessage?: string;
  readonly returnInstruction?: string;
};

export function buildAuthConnectorStartInput(input: {
  readonly connector: AuthConnectorKind;
  readonly option: AuthConnectorMethodOption;
  readonly providerInstanceId?: ProviderInstanceId;
}): AuthConnectorStartInput {
  return {
    connector: input.connector,
    method: input.option.method,
    ...(input.option.hostname ? { hostname: input.option.hostname } : {}),
    ...(input.providerInstanceId ? { providerInstanceId: input.providerInstanceId } : {}),
  };
}

export function authVerificationDestination(input: {
  readonly verificationUrl: string;
  readonly workspaceBrowser: boolean;
  readonly workspaceBrowserUrl: string | null;
}): string {
  return input.workspaceBrowser && input.workspaceBrowserUrl
    ? input.workspaceBrowserUrl
    : input.verificationUrl;
}

export function authAuthorizeInstruction(input: {
  readonly option: AuthConnectorMethodOption | null | undefined;
  readonly usesManagedWorkspaceBrowser: boolean;
}): string | undefined {
  return input.usesManagedWorkspaceBrowser
    ? input.option?.authorizeInstruction
    : (input.option?.manualAuthorizeInstruction ?? input.option?.authorizeInstruction);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The connection could not be completed.";
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "expired", "cancelled"]);

function progressSteps(session: AuthConnectorSession): ReadonlyArray<string> {
  if (session.flow === "secret") return ["Credential", "Verify", "Ready"];
  if (session.flow === "code") return ["Start", "Authorize", "Return", "Verify", "Ready"];
  return ["Start", "Authorize", "Verify", "Ready"];
}

function activeProgressIndex(session: AuthConnectorSession): number {
  const steps = progressSteps(session);
  if (session.stage === "complete") return steps.length - 1;
  if (session.stage === "verifying") return steps.length - 2;
  if (session.stage === "return") return 2;
  if (session.stage === "authorize") return 1;
  return 0;
}

function formatRemaining(expiresAt: string | null, now: number): string | null {
  if (!expiresAt) return null;
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function AuthConnectorDialog(props: {
  readonly connector: AuthConnectorKind;
  readonly serviceName: string;
  readonly methods: ReadonlyArray<AuthConnectorMethodOption>;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly isAuthenticated: boolean;
  readonly onConnected: () => void;
}) {
  const { connector, serviceName, methods, providerInstanceId, isAuthenticated, onConnected } =
    props;
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
  const [openedSessionId, setOpenedSessionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reportedSuccess = useRef<string | null>(null);
  const callbackInputRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedMethod = methods.find((method) => method.method === session?.method) ?? null;

  useEffect(() => {
    if (!open || !environment || !session) return;
    if (session.status !== "starting" && session.status !== "waiting") return;
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
  }, [environment, getConnector, open, session?.id, session?.status]);

  useEffect(() => {
    if (!open || !session?.expiresAt || TERMINAL_STATUSES.has(session.status)) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open, session?.expiresAt, session?.status]);

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
    setOpenedSessionId(null);
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
      input: buildAuthConnectorStartInput({
        connector,
        option,
        ...(providerInstanceId ? { providerInstanceId } : {}),
      }),
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
    setOpenedSessionId(session.id);
    openExternal(
      authVerificationDestination({
        verificationUrl: session.verificationUrl,
        workspaceBrowser: selectedMethod?.workspaceBrowser === true,
        workspaceBrowserUrl: managedWorkspaceBrowserUrl(),
      }),
    );
  };

  const openVerificationUrlHere = () => {
    if (!session?.verificationUrl) return;
    setOpenedSessionId(session.id);
    openExternal(session.verificationUrl);
  };

  const copyCodeAndOpen = () => {
    if (!session?.verificationUrl) return;
    setOpenedSessionId(session.id);
    if (session.userCode) {
      void Promise.resolve()
        .then(() => {
          if (!navigator.clipboard) throw new Error("Clipboard unavailable");
          return navigator.clipboard.writeText(session.userCode!);
        })
        .then(
          () =>
            toastManager.add({
              type: "success",
              title: "Code copied",
              description: "Paste it into the browser tab that just opened.",
            }),
          () => setError("Clipboard access was blocked. Copy the code manually from this window."),
        );
    }
    openExternal(session.verificationUrl);
  };

  const copyUserCode = async () => {
    if (!session?.userCode) return;
    try {
      await navigator.clipboard.writeText(session.userCode);
      toastManager.add({
        type: "success",
        title: "Code copied",
      });
    } catch {
      setError("Clipboard access was blocked. Select and copy the code manually.");
    }
  };

  const pasteFromClipboard = async (key: string) => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError("Your clipboard is empty. Copy the full authorization URL, then try again.");
        return;
      }
      setValues((current) => ({ ...current, [key]: text.trim() }));
      setError(null);
      callbackInputRef.current?.focus();
    } catch {
      setError("Clipboard access was blocked. Paste the authorization URL into the field below.");
      callbackInputRef.current?.focus();
    }
  };

  const openExternal = (url: string) => {
    const api = readLocalApi();
    if (api) {
      void api.shell.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const steps = session ? progressSteps(session) : [];
  const presentationStage =
    session?.stage === "return" && openedSessionId !== session.id ? "authorize" : session?.stage;
  const activeStep = session
    ? presentationStage === "authorize"
      ? 1
      : activeProgressIndex(session)
    : 0;
  const remaining = session ? formatRemaining(session.expiresAt, now) : null;
  const browserName = selectedMethod?.browserName ?? serviceName;
  const usesManagedWorkspaceBrowser =
    selectedMethod?.workspaceBrowser === true && managedWorkspaceBrowserUrl() !== null;
  const authorizeInstruction = authAuthorizeInstruction({
    option: selectedMethod,
    usesManagedWorkspaceBrowser,
  });
  const stageTitle =
    presentationStage === "credential"
      ? "Add your credential"
      : presentationStage === "authorize"
        ? `Authorize with ${browserName}`
        : presentationStage === "return"
          ? `Return to ${APP_BASE_NAME}`
          : presentationStage === "verifying"
            ? "Checking your account"
            : "Preparing secure sign-in";
  const stageDescription =
    presentationStage === "authorize"
      ? (authorizeInstruction ??
        `Complete the authorization in ${browserName}. This window will update automatically.`)
      : presentationStage === "return"
        ? (selectedMethod?.returnInstruction ??
          `Finish approving access in ${browserName}, then paste what it gives you below.`)
        : session?.stage === "verifying"
          ? "Keep this window open while the provider confirms your account."
          : session?.message;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        size="sm"
        variant={isAuthenticated ? "ghost" : "outline"}
        className="h-7 gap-1.5 px-2.5 text-xs"
        disabled={!environment}
        onClick={() => handleOpenChange(true)}
      >
        <PlugIcon className="size-3.5" />
        {isAuthenticated ? "Reconnect" : "Connect"}
      </Button>

      <DialogPopup className="w-[min(36rem,calc(100vw-1rem))]">
        <DialogHeader>
          <DialogTitle>
            {session?.status === "succeeded"
              ? `${serviceName} is connected`
              : `Connect ${serviceName}`}
          </DialogTitle>
          <DialogDescription>
            {session
              ? `${selectedMethod?.label ?? serviceName} · Credentials stay on this workspace.`
              : `Choose how you use ${serviceName}. Credentials stay on this workspace.`}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-5">
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
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                      <span>{option.label}</span>
                      {option.badgeLabel ? (
                        <Badge variant="warning" size="sm">
                          {option.badgeLabel}
                        </Badge>
                      ) : null}
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
          ) : (
            <>
              <ol className="flex items-start gap-1" aria-label="Connection progress">
                {steps.map((step, index) => {
                  const isComplete = index < activeStep || session.stage === "complete";
                  const isActive = index === activeStep;
                  return (
                    <li key={step} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                      <span
                        className={`flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold ${
                          isComplete
                            ? "border-primary bg-primary text-primary-foreground"
                            : isActive
                              ? "border-primary text-primary"
                              : "border-border text-muted-foreground"
                        }`}
                      >
                        {isComplete ? <CheckIcon className="size-3" /> : index + 1}
                      </span>
                      <span
                        className={`max-w-full truncate text-[10px] ${
                          isActive ? "font-medium text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {step}
                      </span>
                    </li>
                  );
                })}
              </ol>

              <div className="border-t pt-5">
                {session.status === "succeeded" ? (
                  <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/8 p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
                      <CheckIcon className="size-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">Ready to use</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {serviceName} is connected to this workspace.
                      </p>
                    </div>
                  </div>
                ) : session.status === "failed" ||
                  session.status === "expired" ||
                  session.status === "cancelled" ? (
                  <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4">
                    <p className="text-sm font-medium text-foreground">
                      {session.status === "expired"
                        ? "This sign-in expired"
                        : "We couldn’t finish connecting"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {session.message}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">{stageTitle}</p>
                        {remaining ? (
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            Expires in {remaining}
                          </span>
                        ) : null}
                      </div>
                      {stageDescription ? (
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {stageDescription}
                        </p>
                      ) : null}
                    </div>

                    {session.userCode ? (
                      <div className="rounded-xl border bg-muted/25 p-4 text-center">
                        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          One-time code
                        </p>
                        <button
                          type="button"
                          className="mt-2 inline-flex items-center gap-2 rounded-md px-2 py-1 font-mono text-2xl font-semibold tracking-[0.12em] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Copy one-time code ${session.userCode}`}
                          onClick={() => void copyUserCode()}
                        >
                          {session.userCode}
                          <CopyIcon className="size-3.5 text-muted-foreground" />
                        </button>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          Copy this exactly as shown.
                        </p>
                      </div>
                    ) : null}

                    {session.verificationUrl ? (
                      <div className="space-y-2">
                        <Button
                          className="w-full"
                          onClick={session.userCode ? copyCodeAndOpen : openVerificationUrl}
                        >
                          {session.userCode
                            ? `Copy code & open ${browserName}`
                            : usesManagedWorkspaceBrowser
                              ? "Open workspace browser"
                              : `Open ${browserName}`}
                          <ExternalLinkIcon className="size-4" />
                        </Button>
                        {usesManagedWorkspaceBrowser && !session.userCode ? (
                          <Button
                            type="button"
                            variant="link"
                            className="h-auto w-full p-0 text-xs"
                            onClick={openVerificationUrlHere}
                          >
                            Open {browserName} in this browser instead
                            <ExternalLinkIcon className="size-3" />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}

                    {session.stage === "authorize" && session.verificationUrl ? (
                      <div
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                        aria-live="polite"
                      >
                        <LoaderIcon className="size-3.5 shrink-0 animate-spin" />
                        {selectedMethod?.waitingMessage ??
                          "Waiting for you to approve access in the browser…"}
                      </div>
                    ) : null}

                    {session.fields.length > 0 ? (
                      <div className="space-y-3">
                        {session.fields.map((authField) => {
                          const fieldId = `auth-connector-${session.id}-${authField.key}`;
                          const helpId = authField.help ? `${fieldId}-help` : undefined;
                          return (
                            <div key={authField.key} className="space-y-1.5">
                              <div className="flex items-center justify-between gap-3">
                                <label
                                  htmlFor={fieldId}
                                  className="text-xs font-medium text-foreground"
                                >
                                  {authField.label}
                                </label>
                                {authField.type === "textarea" ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                    onClick={() => void pasteFromClipboard(authField.key)}
                                  >
                                    <ClipboardPasteIcon className="size-3" />
                                    Paste from clipboard
                                  </button>
                                ) : null}
                              </div>
                              {authField.type === "textarea" ? (
                                <Textarea
                                  id={fieldId}
                                  ref={callbackInputRef}
                                  value={values[authField.key] ?? ""}
                                  placeholder={authField.placeholder}
                                  autoComplete="off"
                                  spellCheck={false}
                                  aria-describedby={helpId}
                                  className="font-mono text-xs"
                                  onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    setValues((current) => ({
                                      ...current,
                                      [authField.key]: value,
                                    }));
                                  }}
                                />
                              ) : (
                                <Input
                                  id={fieldId}
                                  type={authField.type}
                                  value={values[authField.key] ?? ""}
                                  placeholder={authField.placeholder}
                                  autoComplete="off"
                                  aria-describedby={helpId}
                                  onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    setValues((current) => ({
                                      ...current,
                                      [authField.key]: value,
                                    }));
                                  }}
                                />
                              )}
                              {authField.help ? (
                                <p
                                  id={helpId}
                                  className="text-xs leading-relaxed text-muted-foreground"
                                >
                                  {authField.help}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
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

                    {(session.stage === "preparing" || session.stage === "verifying") &&
                    !session.verificationUrl ? (
                      <div
                        className="flex items-center gap-2 rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground"
                        aria-live="polite"
                      >
                        <LoaderIcon className="size-4 animate-spin" />
                        {session.stage === "verifying"
                          ? "Confirming your account…"
                          : "Preparing the provider’s secure sign-in…"}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
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
            <Button onClick={() => handleOpenChange(false)}>Done</Button>
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
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
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
                {session.stage === "return" ? "Finish connecting" : "Verify & connect"}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
