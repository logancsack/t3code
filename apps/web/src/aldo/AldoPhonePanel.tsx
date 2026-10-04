import { MessageCircleIcon, PhoneIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SettingsRow, SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { aldoPhone, fetchAldoPhone, type AldoPhoneSettings } from "./cloud";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Phone setup belongs to the user, never to an agent or a provider webhook. */
export function AldoPhonePanel() {
  const [settings, setSettings] = useState<AldoPhoneSettings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [changing, setChanging] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const latest = useRef(0);
  const mutating = useRef(false);
  const refresh = useCallback(() => {
    // A focus read during a write can return the old state after its result.
    if (mutating.current) return;
    const seq = ++latest.current;
    fetchAldoPhone()
      .then((next) => {
        if (seq === latest.current) {
          setSettings(next);
          setLoaded(true);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (seq === latest.current) {
          setError(messageOf(cause));
          setLoaded(true);
        }
      });
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      latest.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  async function act(work: () => Promise<void>) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(true);
    setError(null);
    latest.current++;
    try {
      await work();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }
  if (loaded && !settings && !error) return null;
  return (
    <SettingsSection
      id="aldo-phone"
      title="Text and call Aldo"
      icon={<PhoneIcon className="size-4" />}
    >
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        One number, the same Aldo. Your conversations and agents carry on between the app, texts,
        and calls. Drafts still wait for your tap in Aldo.
      </p>
      {error ? (
        <p role="alert" className="px-3 text-sm text-destructive-foreground sm:px-4">
          {error}{" "}
          <button className="underline" onClick={refresh}>
            Refresh
          </button>
        </p>
      ) : null}
      {!loaded ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">Loading phone settings…</p>
      ) : null}
      {settings?.prototype ? (
        <p className="mx-3 rounded-lg bg-muted p-3 text-sm sm:mx-4">
          Local prototype · Texts and calls are simulated. Replies use a demo assistant and never
          run real tasks.
        </p>
      ) : null}
      {settings?.error ? (
        <p role="status" className="px-3 text-sm text-warning-foreground sm:px-4">
          {settings.error}
        </p>
      ) : null}
      {settings && (settings.available || settings.verified) ? (
        <>
          {settings.verified && (!changing || !settings.available) ? (
            <SettingsRow
              title="Your number"
              description={settings.phone ?? "Verified"}
              status="Verified"
              control={
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !settings.available}
                    onClick={() => {
                      setDisconnecting(false);
                      setChanging(true);
                    }}
                  >
                    Change number
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDisconnecting(true)}
                  >
                    Disconnect
                  </Button>
                </div>
              }
            />
          ) : settings.available ? (
            <form
              className="space-y-3 px-3 py-3 sm:px-4"
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  if (!verificationId) {
                    const result = await aldoPhone.verify(phone);
                    setVerificationId(result.verificationId);
                    if (result.prototypeCode) setCode(result.prototypeCode);
                  } else {
                    setSettings(await aldoPhone.confirm(verificationId, code, pin));
                    setVerificationId(null);
                    setCode("");
                    setPin("");
                    setChanging(false);
                    setDisconnecting(false);
                  }
                });
              }}
            >
              <label className="block space-y-1 text-sm">
                <span>Phone number with country code</span>
                <Input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 415 555 0123"
                  required
                  disabled={busy || Boolean(verificationId)}
                />
              </label>
              {verificationId ? (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Verification code</span>
                    <Input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Choose a six-digit call PIN</span>
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Enter this PIN when you call. Avoid repeated digits and simple sequences.{" "}
                    {settings.prototype
                      ? "The prototype verification code is 123456."
                      : "Your verification code expires in ten minutes."}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  We'll text a code to verify it's yours. Use a number only you control. Carrier
                  charges may apply.
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? "Working…" : verificationId ? "Verify number" : "Text me a code"}
                </Button>
                {verificationId || changing ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setVerificationId(null);
                      setCode("");
                      setPin("");
                      setChanging(false);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          ) : null}
          {disconnecting ? (
            <div className="space-y-2 px-3 text-sm sm:px-4">
              <p>
                Disconnect this number? Pending phone requests stop and active calls lose access.
                Work already started stays in Aldo.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    void act(async () => {
                      setSettings(await aldoPhone.disconnect());
                      setDisconnecting(false);
                      setChanging(false);
                      setVerificationId(null);
                      setCode("");
                      setPin("");
                      setPhone("");
                    });
                  }}
                >
                  Disconnect number
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setDisconnecting(false)}
                >
                  Keep number
                </Button>
              </div>
            </div>
          ) : null}
          {settings.verified && settings.available ? (
            <>
              <SettingsRow
                title="Text messages"
                description="Text Aldo from your verified number. Text STOP to turn SMS off; enable it here to reconnect."
                status={!settings.sms ? "Disabled by an administrator" : undefined}
                control={
                  <Switch
                    checked={settings.smsEnabled}
                    disabled={busy || !settings.sms}
                    aria-label="Enable SMS"
                    onCheckedChange={(on) => {
                      void act(async () => setSettings(await aldoPhone.update({ smsEnabled: on })));
                    }}
                  />
                }
              />
              <SettingsRow
                title="Phone calls"
                description="Call Aldo, enter your PIN, and talk. You can interrupt while Aldo speaks. Press 0 to end the call."
                status={!settings.voice ? "Voice bridge unavailable" : undefined}
                control={
                  <Switch
                    checked={settings.voiceEnabled}
                    disabled={busy || !settings.voice}
                    aria-label="Enable phone calls"
                    onCheckedChange={(on) => {
                      void act(async () =>
                        setSettings(await aldoPhone.update({ voiceEnabled: on })),
                      );
                    }}
                  />
                }
              />
              {settings.number && !settings.prototype ? (
                <div className="flex flex-wrap gap-3 px-3 text-sm sm:px-4">
                  <span>Aldo: {settings.number}</span>
                  {settings.smsEnabled && settings.sms ? (
                    <a className="underline" href={`sms:${settings.number}`}>
                      Text Aldo
                    </a>
                  ) : null}
                  {settings.voiceEnabled && settings.voice ? (
                    <a className="underline" href={`tel:${settings.number}`}>
                      Call Aldo
                    </a>
                  ) : null}
                </div>
              ) : null}
              <form
                className="flex flex-wrap items-end gap-2 px-3 py-3 sm:px-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(async () => {
                    setSettings(await aldoPhone.update({ pin }));
                    setPin("");
                  });
                }}
              >
                <label className="space-y-1 text-sm">
                  <span className="block">Reset call PIN</span>
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    required
                    disabled={busy}
                  />
                </label>
                <Button
                  size="sm"
                  type="submit"
                  variant="outline"
                  disabled={busy || pin.length !== 6}
                >
                  Save PIN
                </Button>
              </form>
            </>
          ) : null}
          {settings.available && settings.prototype && settings.verified ? (
            <PhonePrototype settings={settings} onChanged={refresh} />
          ) : null}
          {settings.deliveries.length ? (
            <div className="space-y-1 px-3 text-sm sm:px-4">
              <p className="font-medium">Replies needing attention</p>
              {settings.deliveries.map((delivery) => (
                <p key={delivery.id} role="status">
                  {delivery.state === "uncertain" ? "Delivery not confirmed. " : "Reply failed. "}
                  {delivery.error} The conversation is available in Aldo.
                </p>
              ))}
            </div>
          ) : null}
          {settings.calls.some((call) => call.error) ? (
            <div className="px-3 text-sm text-warning-foreground sm:px-4">
              {settings.calls
                .filter((call) => call.error)
                .slice(0, 2)
                .map((call) => (
                  <p key={call.at}>{call.error}</p>
                ))}
            </div>
          ) : null}
          {settings.events.length ? (
            <div className="space-y-1 px-3 text-xs text-muted-foreground sm:px-4">
              <p>Recent phone activity</p>
              {settings.events.slice(0, 5).map((event) => (
                <p key={event.id}>
                  {event.channel === "sms" ? "Text" : "Call turn"} · {event.state} ·{" "}
                  {new Date(event.at).toLocaleString()}
                  {event.error ? ` · ${event.error}` : ""}
                </p>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </SettingsSection>
  );
}

function PhonePrototype({
  settings,
  onChanged,
}: {
  settings: AldoPhoneSettings;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"sms" | "phone">("sms");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<
    { id: string; role: "user" | "assistant"; text: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [callState, setCallState] = useState("ended");
  const [callPin, setCallPin] = useState("");
  const generation = useRef(0);
  const messageSequence = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      window.speechSynthesis?.cancel();
    },
    [],
  );
  async function run(input: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const turn = generation.current;
    try {
      const result = await aldoPhone.prototype(input);
      if (turn !== generation.current) return;
      if (result.callId) setCallId(result.callId);
      if (input.action === "call" || input.action === "pin" || input.action === "end") {
        setCallState(result.state ?? "ended");
        setCallPin("");
        if (input.action === "pin" && result.state !== "active")
          setError(
            result.state === "failed"
              ? "Call PIN verification failed. Reset your PIN in Phone settings, then call again."
              : "That PIN didn't match. Try again.",
          );
      }
      if (result.reply) {
        setMessages((old) => [
          ...old,
          { id: String(++messageSequence.current), role: "assistant", text: result.reply! },
        ]);
        if (mode === "phone" && window.speechSynthesis) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(result.reply));
        }
      }
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-3 space-y-3 rounded-xl border p-4 sm:mx-4">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "sms" ? "default" : "outline"}
          disabled={busy || callState !== "ended"}
          onClick={() => setMode("sms")}
        >
          <MessageCircleIcon className="size-4" /> Text prototype
        </Button>
        <Button
          size="sm"
          variant={mode === "phone" ? "default" : "outline"}
          disabled={busy || callState !== "ended"}
          onClick={() => setMode("phone")}
        >
          <PhoneIcon className="size-4" /> Call prototype
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Try “hello” or “approve my draft.” The simulator uses the same verification, routing,
        history, and approval gate as real phone access. Call replies play through your browser;
        enter what you would say.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {mode === "phone" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">
            {callState === "active"
              ? "Connected to Aldo"
              : callState === "pin"
                ? "Enter your call PIN"
                : "Ready to call"}
          </span>
          {callState === "ended" || callState === "failed" ? (
            <Button
              size="sm"
              disabled={busy || !settings.voiceEnabled}
              onClick={() => {
                void run({ action: "call" });
              }}
            >
              Call Aldo
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                generation.current++;
                window.speechSynthesis?.cancel();
                void run({ action: "end", callId });
              }}
            >
              End call
            </Button>
          )}
          {callState === "pin" ? (
            <>
              <Input
                aria-label="Call PIN"
                className="max-w-36"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={callPin}
                onChange={(e) => setCallPin(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || callPin.length !== 6}
                onClick={() => {
                  void run({ action: "pin", callId, pin: callPin });
                }}
              >
                Enter PIN
              </Button>
            </>
          ) : null}
          {callState === "active" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                generation.current++;
                window.speechSynthesis?.cancel();
                void aldoPhone
                  .prototype({ action: "interrupt", callId, heard: "" })
                  .catch((cause: unknown) => setError(messageOf(cause)));
              }}
            >
              Interrupt
            </Button>
          ) : null}
        </div>
      ) : null}
      <div role="log" aria-live="polite" className="max-h-64 space-y-2 overflow-auto">
        {messages.map((message) => (
          <p
            key={message.id}
            className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            {message.text}
          </p>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = text.trim();
          if (!typed) return;
          window.speechSynthesis?.cancel();
          setMessages((old) => [
            ...old,
            { id: String(++messageSequence.current), role: "user", text: typed },
          ]);
          setText("");
          void run({ action: mode === "sms" ? "sms" : "turn", text: typed, callId });
        }}
      >
        <Input
          aria-label={mode === "sms" ? "Text Aldo" : "What you say to Aldo"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "sms" ? "Text Aldo…" : "What would you say?"}
          disabled={busy || (mode === "sms" ? !settings.smsEnabled : callState !== "active")}
        />
        <Button
          size="sm"
          type="submit"
          disabled={
            busy || !text.trim() || (mode === "sms" ? !settings.smsEnabled : callState !== "active")
          }
        >
          {busy ? "Thinking…" : mode === "sms" ? "Send" : "Say"}
        </Button>
      </form>
    </div>
  );
}
