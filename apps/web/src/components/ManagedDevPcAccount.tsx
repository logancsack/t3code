import { useCallback, useEffect, useRef, useState } from "react";
import { UserRoundIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { isManagedDevPc } from "../managedDevPc";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { ManagedDevPcStatus } from "./ManagedDevPcStatus";
import { useSidebar } from "./ui/sidebar";
import { Button } from "./ui/button";
import { isLandingDemo } from "../landingDemo/mode";

const ACCOUNT_PATH = "/_devpc/account";
const ACCOUNT_ME_PATH = "/_devpc/account/me";
const ACCOUNT_REQUEST_TIMEOUT_MS = 10_000;

type ManagedAccount = {
  readonly subject: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly imageUrl: string | null;
};

function accountLabel(account: ManagedAccount | null): string {
  return account?.name?.trim() || account?.email?.trim() || "Account";
}

/**
 * The account image as a same-origin path, or null for the default mark.
 *
 * The gateway proxies the identity provider's picture under its own origin and
 * sends null when the user never set one. An absolute URL therefore means a
 * mismatched gateway, and the managed shell CSP (`img-src 'self'`) would block
 * it on load anyway, so treat it as no image rather than a broken one.
 */
export function sameOriginAccountImage(imageUrl: string | null | undefined): string | null {
  const trimmed = imageUrl?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : null;
}

/**
 * The signed-in user's picture, falling back to the default person mark.
 *
 * `alt` is intentionally empty: the trigger already names the account, so the
 * image is decorative to a screen reader.
 */
function AccountAvatar({ account }: { account: ManagedAccount | null }) {
  const source = sameOriginAccountImage(account?.imageUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [source]);

  return (
    <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-row-hover text-sidebar-foreground">
      {source && !failed ? (
        <img
          src={source}
          alt=""
          className="size-full object-cover"
          draggable={false}
          onError={() => setFailed(true)}
          data-devpc-account-avatar
        />
      ) : (
        <UserRoundIcon className="size-3.5" aria-hidden />
      )}
    </span>
  );
}

export function ManagedDevPcAccountButton() {
  const [account, setAccount] = useState<ManagedAccount | null>(null);
  const [open, setOpen] = useState(false);
  const accountRequest = useRef<AbortController | null>(null);

  const refreshAccount = useCallback(() => {
    if (!isManagedDevPc || isLandingDemo()) return;
    accountRequest.current?.abort();
    const controller = new AbortController();
    accountRequest.current = controller;
    void fetch(ACCOUNT_ME_PATH, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(ACCOUNT_REQUEST_TIMEOUT_MS)]),
    })
      .then(async (response) => {
        if (!response.ok) return;
        setAccount((await response.json()) as ManagedAccount);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAccount();
    return () => {
      accountRequest.current?.abort();
    };
  }, [refreshAccount]);

  if (!isManagedDevPc || isLandingDemo()) return null;

  const label = accountLabel(account);
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) refreshAccount();
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm text-sidebar-muted-foreground/80 outline-hidden hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label={`Open account settings for ${label}`}
            data-devpc-account-button
          />
        }
      >
        <AccountAvatar account={account} />
        <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
      </DialogTrigger>

      <DialogPopup
        className="h-[calc(100dvh-3rem)] w-screen max-w-none overflow-hidden rounded-t-2xl border-x-0 border-b-0 sm:h-[min(800px,calc(100dvh-2rem))] sm:w-[min(900px,calc(100vw-2rem))] sm:rounded-2xl sm:border"
        data-devpc-account-dialog
      >
        <DialogHeader className="shrink-0 border-b py-4 pr-14">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-lg">Account</DialogTitle>
              <DialogDescription className="mt-1">
                Manage your Aldo profile and security settings.
              </DialogDescription>
            </div>
            <Button render={<a href="/_devpc/sign-out" />} size="sm" variant="outline">
              Sign out
            </Button>
          </div>
        </DialogHeader>
        {open ? (
          // The account host is trusted, same-origin application code. Clerk's
          // profile flows need unrestricted focus, storage, uploads, and OAuth
          // navigation; a same-origin allow-scripts sandbox adds compatibility
          // risk without creating a meaningful security boundary.
          // eslint-disable-next-line react/iframe-missing-sandbox -- trusted same-origin Clerk host
          <iframe
            className="min-h-0 flex-1 border-0 bg-background"
            data-devpc-account-frame
            src={ACCOUNT_PATH}
            title="Account"
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

export function ManagedDevPcFooterAccount({
  showWorkspaceStatus = true,
}: {
  showWorkspaceStatus?: boolean;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();

  if (!isManagedDevPc || isLandingDemo()) return null;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <ManagedDevPcAccountButton />
      {showWorkspaceStatus ? (
        <ManagedDevPcStatus
          onOpenSettings={() => {
            if (isMobile) setOpenMobile(false);
            void navigate({ to: "/settings/workspace" });
          }}
        />
      ) : null}
    </div>
  );
}
