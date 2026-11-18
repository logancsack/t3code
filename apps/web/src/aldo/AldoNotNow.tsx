// "Not now" on what waits on the user: a prompt in Aldo's chat
// (DismissChatDecision.tsx) or a plan (AldoPlanCard.tsx). A menu of when it
// comes back (notNow.logic.ts), each with its time, and a time to pick (a
// sheet on a phone); for a prompt, hiding it with no reminder too. It comes
// back then, once, and nothing goes ahead on its own meanwhile, nor after.

import { useId, useState, type ReactNode } from "react";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../components/ui/menu";
import { cn } from "~/lib/utils";
import { fieldTime, NOT_NOW_MAX_DAYS, notNowChoices, pickedTime } from "./notNow.logic";
import { PRIMARY, SECONDARY } from "./surface";

const ITEM = "pointer-coarse:min-h-11";

export function NotNowMenu(props: {
  /** What the trigger says to a screen reader: "Not now: Vendor renewals". */
  readonly label: string;
  readonly busy?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
  readonly onPutOff: (until: Date) => void;
  /** Hides it for good, with no reminder (a prompt in chat). */
  readonly onHide?: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const [picking, setPicking] = useState(false);
  const choices = notNowChoices(now);
  return (
    <>
      <Menu onOpenChange={(open) => open && setNow(new Date())}>
        <MenuTrigger
          aria-label={props.label}
          disabled={props.busy}
          aria-busy={props.busy || undefined}
          render={<button type="button" className={props.className} />}
        >
          {props.children}
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-60">
          <MenuGroup>
            <MenuGroupLabel>Bring it back</MenuGroupLabel>
            {choices.map((choice) => (
              <MenuItem
                key={choice.key}
                className={ITEM}
                onClick={() => props.onPutOff(choice.until)}
              >
                <MenuItemLabel>{choice.label}</MenuItemLabel>
                <MenuShortcut className="tracking-normal tabular-nums">{choice.when}</MenuShortcut>
              </MenuItem>
            ))}
            <MenuItem className={ITEM} onClick={() => setPicking(true)}>
              <MenuItemLabel>Pick a time…</MenuItemLabel>
            </MenuItem>
          </MenuGroup>
          {props.onHide ? (
            <>
              <MenuSeparator />
              <MenuItem className={ITEM} onClick={props.onHide}>
                <MenuItemLabel>Hide without a reminder</MenuItemLabel>
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      <Dialog open={picking} onOpenChange={setPicking}>
        {picking ? (
          <PickTime
            onCancel={() => setPicking(false)}
            onPick={(until) => {
              setPicking(false);
              props.onPutOff(until);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

/** A day and a time to bring it back, from a minute to 30 days on: tomorrow morning to start with. */
function PickTime(props: {
  readonly onPick: (until: Date) => void;
  readonly onCancel: () => void;
}) {
  const [now] = useState(() => new Date());
  const [value, setValue] = useState(() => {
    const morning = notNowChoices(now).find((c) => c.key === "morning");
    return fieldTime(morning?.until ?? new Date(now.getTime() + 3_600_000));
  });
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const pick = () => {
    const picked = pickedTime(value, new Date());
    if ("error" in picked) setError(picked.error);
    else props.onPick(picked.until);
  };
  return (
    <DialogPopup className="w-[min(420px,calc(100vw-2rem))]">
      <form
        className="flex flex-col"
        // min and max keep the picker's days in range; what's typed out of range is said below, in words.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          pick();
        }}
      >
        <DialogHeader>
          <DialogTitle>Bring it back at</DialogTitle>
          <DialogDescription>
            It waits until then, and nothing goes ahead on its own. Up to {NOT_NOW_MAX_DAYS} days
            from now.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5 px-6 pb-2">
          <label htmlFor={id} className="sr-only">
            Day and time
          </label>
          <Input
            id={id}
            type="datetime-local"
            size="lg"
            nativeInput
            value={value}
            min={fieldTime(new Date(now.getTime() + 60_000))}
            max={fieldTime(new Date(now.getTime() + NOT_NOW_MAX_DAYS * 86_400_000))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setError(null);
            }}
          />
          <p
            id={`${id}-error`}
            role={error ? "alert" : undefined}
            className={cn(
              "min-h-5 text-[13px] text-destructive-foreground leading-5",
              !error && "invisible",
            )}
          >
            {error ?? " "}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 px-6 pb-6 sm:flex-row sm:justify-end">
          <button
            type="button"
            className={cn(SECONDARY, "h-10 px-4 pointer-coarse:h-11")}
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button type="submit" className={cn(PRIMARY, "h-10 px-4 pointer-coarse:h-11")}>
            Put it off
          </button>
        </div>
      </form>
    </DialogPopup>
  );
}
