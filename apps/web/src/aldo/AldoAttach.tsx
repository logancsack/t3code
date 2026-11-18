// The + in a composer (Home's and a thread's): where to attach from, as a
// phone's own apps offer it. Camera takes a photo there and then (on a phone
// or tablet: a computer's file dialog has no camera), Photos picks from the
// photo library, Files any file. Each opens the device's own picker, and what's
// picked goes to `onPick` as a drop or a paste does. AldoFileChip is a file
// attached to a message, in the composer and in the conversation.
import { CameraIcon, FileTextIcon, ImageIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useRef, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Spinner } from "../components/ui/spinner";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { cn } from "~/lib/utils";

export function AldoAttachMenu(props: {
  /** The button that opens it (its icon is `children`). */
  readonly trigger: ReactElement;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  /** Which edge of the button it lines up with: the one away from the composer's edge. */
  readonly align?: "start" | "end";
  /** What Photos picks from: an input's `accept`. */
  readonly photos: string;
  /** Whether Files is offered: where only photos go, it isn't. */
  readonly files: boolean;
  readonly onPick: (files: File[]) => void;
}) {
  const touch = useMediaQuery("(pointer: coarse)");
  const camera = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(event.target.files ?? [])];
    event.target.value = "";
    if (chosen.length > 0) props.onPick(chosen);
  };
  const rows = [
    ...(touch ? [{ label: "Camera", Icon: CameraIcon, input: camera }] : []),
    { label: "Photos", Icon: ImageIcon, input: photos },
    ...(props.files ? [{ label: "Files", Icon: PaperclipIcon, input: files }] : []),
  ];
  return (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={picked}
      />
      <input ref={photos} type="file" accept={props.photos} multiple hidden onChange={picked} />
      <input ref={files} type="file" multiple hidden onChange={picked} />
      <Menu>
        <MenuTrigger render={props.trigger} disabled={props.disabled}>
          {props.children}
        </MenuTrigger>
        <MenuPopup
          side="top"
          align={props.align ?? "start"}
          sideOffset={8}
          className="min-w-48 rounded-2xl"
        >
          {rows.map(({ label, Icon, input }) => (
            <MenuItem
              key={label}
              className={cn(
                "gap-3 rounded-xl px-2 font-medium",
                touch ? "min-h-12 text-[16px]" : "min-h-9 text-[14px] sm:min-h-9 sm:text-[14px]",
              )}
              onClick={() => input.current?.click()}
            >
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] text-foreground",
                  touch ? "size-9" : "size-7",
                )}
              >
                <Icon className={touch ? "size-[18px]" : "size-4"} strokeWidth={1.75} />
              </span>
              {label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </>
  );
}

/** A file's kind as people know it: its extension ("PDF"), or "File". */
function kindOf(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  return /^[a-z0-9]{1,8}$/i.test(extension) ? extension.toUpperCase() : "File";
}

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A file attached to a message: its name, kind and size, and whether it's uploading or didn't. */
export function AldoFileChip(props: {
  readonly name: string;
  readonly sizeBytes?: number | undefined;
  readonly state?: "uploading" | "ready" | "failed";
  readonly onRemove?: () => void;
  readonly onRetry?: (() => void) | undefined;
}) {
  const detail =
    props.state === "uploading"
      ? "Uploading…"
      : props.state === "failed"
        ? "Didn't upload"
        : [kindOf(props.name), props.sizeBytes === undefined ? null : sizeOf(props.sizeBytes)]
            .filter(Boolean)
            .join(" · ");
  return (
    <div className="relative flex h-12 min-w-0 max-w-60 items-center gap-2.5 rounded-xl bg-card py-1.5 pr-3 pl-1.5 ring-1 ring-foreground/10">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-muted-foreground">
        {props.state === "uploading" ? (
          <Spinner size="md" aria-label="Uploading" />
        ) : (
          <FileTextIcon className="size-[18px]" strokeWidth={1.75} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium leading-5">{props.name}</span>
        <span
          className={cn(
            "text-[12px] leading-4",
            props.state === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
          )}
        >
          {detail}
          {props.state === "failed" && props.onRetry ? (
            <>
              {" · "}
              <button
                type="button"
                className="relative underline underline-offset-2 outline-none after:absolute after:-inset-x-2 after:-inset-y-3 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={props.onRetry}
              >
                Try again
              </button>
            </>
          ) : null}
        </span>
      </span>
      {props.onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${props.name}`}
          className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={props.onRemove}
        >
          <XIcon className="size-3" strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}
