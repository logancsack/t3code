// Settings → Organization (organization.logic.ts), only for someone in one:
// the organization at a glance, the way to its members, its name and owners,
// its seats, and leaving it, or deleting it for an owner alone in it. Aldo
// decides what each role may do; this offers only what the user may.

import { useNavigate } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { toastManager } from "../components/ui/toast";
import { aldoOrg } from "./accountApi";
import { AldoIconTile } from "./AldoBrandTile";
import {
  changeOwn,
  Confirm,
  ErrorLine,
  Initials,
  OpenRow,
  useLoadedOrg,
  useOrgChange,
} from "./AldoOrgParts";
import {
  aldoOrgFull,
  aldoOrgFullLine,
  aldoOrgManages,
  aldoOrgMembersSummary,
  aldoOrgOwnersLine,
  aldoOrgOwnPlace,
  aldoOrgSeatsLine,
  aldoOrgYouLine,
  type AldoOrg,
} from "./organization.logic";

export function AldoOrganizationPage() {
  const navigate = useNavigate();
  const { org, fallback } = useLoadedOrg();
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState<"leave" | "delete" | null>(null);
  if (!org) return fallback;

  const own = aldoOrgOwnPlace(org);
  const members = () => void navigate({ to: "/settings/members" });

  return (
    <>
      <div className="flex items-center gap-3 px-1">
        <Initials of={org.name} className="size-12 text-sm" />
        <div className="min-w-0">
          <p className="font-semibold text-foreground text-lg leading-tight [overflow-wrap:anywhere]">
            {org.name}
          </p>
          <p className="text-muted-foreground text-sm">{aldoOrgYouLine(org)}</p>
        </div>
      </div>

      <SettingsSection id="aldo-organization" title="Manage" hideTitle={!aldoOrgManages(org)}>
        <OpenRow
          leading={<AldoIconTile icon={<UsersIcon />} />}
          title="Members"
          value={aldoOrgMembersSummary(org)}
          onOpen={members}
        />
      </SettingsSection>

      <SettingsSection title="About" hideTitle>
        <OpenRow
          title="Name"
          value={org.name}
          onOpen={org.role === "owner" ? () => setRenaming(true) : null}
        />
        <OpenRow title="Owners" value={aldoOrgOwnersLine(org)} onOpen={members} />
        <OpenRow
          title="Seats"
          value={aldoOrgSeatsLine(org)}
          description={
            aldoOrgFull(org) && aldoOrgManages(org) ? (
              <span className="text-warning-foreground">{aldoOrgFullLine(org)}</span>
            ) : null
          }
          onOpen={null}
        />
        {own.delete ? (
          <OpenRow
            title={<span className="text-destructive-foreground">Delete {org.name}</span>}
            description="No one else is in it. Its invites stop working, and your account stays yours."
            onOpen={() => setConfirming("delete")}
          />
        ) : own.blocked ? (
          <OpenRow
            title={<span className="text-muted-foreground">Leave {org.name}</span>}
            description={own.blocked}
            onOpen={null}
          />
        ) : (
          <OpenRow
            title={<span className="text-destructive-foreground">Leave {org.name}</span>}
            onOpen={() => setConfirming("leave")}
          />
        )}
      </SettingsSection>

      {renaming ? <RenameSheet org={org} onClose={() => setRenaming(false)} /> : null}
      <Confirm
        open={confirming === "leave"}
        onOpenChange={(open) => setConfirming(open ? "leave" : null)}
        title={`Leave ${org.name}?`}
        description="Your threads, computers, vault and plan stay yours. To come back, you’ll need a new invite."
        action="Leave"
        onConfirm={() =>
          changeOwn(() => aldoOrg.remove(org.you)).then(() =>
            toastManager.add({ type: "success", title: `You left ${org.name}` }),
          )
        }
      />
      <Confirm
        open={confirming === "delete"}
        onOpenChange={(open) => setConfirming(open ? "delete" : null)}
        title={`Delete ${org.name}?`}
        description="Its open invites stop working. Your threads, computers, vault and plan stay yours."
        action="Delete organization"
        onConfirm={() =>
          changeOwn(aldoOrg.delete).then(() =>
            toastManager.add({ type: "success", title: `Deleted ${org.name}` }),
          )
        }
      />
    </>
  );
}

function RenameSheet({ org, onClose }: { org: AldoOrg; onClose: () => void }) {
  const [name, setName] = useState(org.name);
  const { busy, error, run } = useOrgChange();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => aldoOrg.rename(name)).then((answer) => answer && onClose());
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogPopup>
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Name</DialogTitle>
          </DialogHeader>
          <DialogPanel className="space-y-2">
            <Input
              autoFocus
              aria-label="Organization name"
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <ErrorLine error={error} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />} disabled={busy}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy || !name.trim() || name.trim() === org.name}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
