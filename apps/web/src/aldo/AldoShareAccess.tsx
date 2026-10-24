// Who can open a share, changed here at once (only the user, signed in, or
// anyone with the link), and its link to copy or open: in the viewer's Share
// and a turn's Share…, for an Aldo that lets the user change it
// (aldoShareAudienceChangeable). A private link copied says who it opens for,
// so it isn't sent to someone it won't open for.

import { ExternalLinkIcon, GlobeIcon, LinkIcon, LockIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "../components/ui/button";
import { Radio, RadioGroup } from "../components/ui/radio-group";
import { toastManager } from "../components/ui/toast";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import type { AldoShareView } from "./library.logic";
import { aldoShareChanged } from "./shareViewer";
import { setAldoShareAudience } from "./workspaceApi";

const CHOICES: ReadonlyArray<{
  readonly value: "private" | "public";
  readonly icon: LucideIcon;
  readonly label: string;
  readonly detail: string;
}> = [
  { value: "private", icon: LockIcon, label: "Only you", detail: "Signed in to Aldo" },
  { value: "public", icon: GlobeIcon, label: "Anyone with the link", detail: "No sign-in needed" },
];

export function AldoShareAccess(props: { readonly share: AldoShareView }) {
  const { share } = props;
  const [saving, setSaving] = useState(false);
  // Copied while only the user could open it: said until it's for anyone.
  const [copiedPrivate, setCopiedPrivate] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => setCopiedPrivate(!share.public),
  });
  const choose = (value: unknown) => {
    const isPublic = value === "public";
    if (isPublic === share.public) return;
    setSaving(true);
    setAldoShareAudience(share.id, isPublic)
      .then(aldoShareChanged)
      .catch((cause: unknown) =>
        toastManager.add({
          type: "error",
          title: "Couldn't change who can open it",
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .finally(() => setSaving(false));
  };
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        aria-label="Who can open it"
        value={share.public ? "public" : "private"}
        onValueChange={choose}
        disabled={saving}
        className="gap-0.5"
      >
        {CHOICES.map(({ value, icon: Icon, label, detail }) => (
          <label
            key={value}
            className="-mx-2 flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/60 has-data-disabled:cursor-default"
          >
            <Radio value={value} />
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block font-medium text-sm">{label}</span>
              <span className="block text-muted-foreground text-xs">{detail}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
      <div className="flex flex-wrap gap-1.5">
        <Button size="xs" variant="outline" onClick={() => copyToClipboard(share.url, undefined)}>
          <LinkIcon />
          {isCopied ? "Copied" : "Copy link"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          render={<a href={share.url} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
          Open in browser
        </Button>
      </div>
      {copiedPrivate && !share.public ? (
        <p className="text-muted-foreground text-xs" role="status">
          Only you can open this link. To send it to someone, choose Anyone with the link.
        </p>
      ) : null}
    </div>
  );
}
