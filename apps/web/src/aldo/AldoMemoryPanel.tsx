// Settings → Memory: what Aldo knows about the user, as Aldo keeps it — its
// profile of them (always in its mind) and its notes (one fact each). Aldo
// writes them as it talks and after each conversation; the user can change
// anything here, add a note, or have Aldo forget one.

import { BrainIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { SettingsSection } from "../components/settings/settingsLayout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { AldoApiError, aldoMemory, type AldoMemoryItem } from "./cloud";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const SOURCE: Record<string, string> = {
  aldo: "noted by Aldo",
  consolidation: "updated by Aldo after a conversation",
  user: "edited by you",
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function Byline({ item }: { readonly item: AldoMemoryItem }) {
  return (
    <span className="text-muted-foreground text-xs">
      {SOURCE[item.source] ?? item.source}, {ago(item.updatedAt)}
    </span>
  );
}

function ProfileEditor(props: {
  readonly profile: AldoMemoryItem | null;
  readonly onSaved: (items: AldoMemoryItem[]) => void;
}) {
  const [draft, setDraft] = useState(props.profile?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(props.profile?.body ?? ""), [props.profile?.body]);
  const dirty = draft.trim() !== (props.profile?.body ?? "");
  return (
    <div className="space-y-2 px-3 sm:px-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-sm">About you</h3>
        {props.profile ? <Byline item={props.profile} /> : null}
      </div>
      <Textarea
        value={draft}
        placeholder="Nothing yet. Aldo writes this as it gets to know you: who you are, how you work, your projects and priorities, and how much you want it to do on its own."
        onChange={(event) => setDraft(event.target.value)}
      />
      {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      {dirty ? (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDraft(props.profile?.body ?? "")}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !draft.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                props.onSaved(await aldoMemory.saveProfile(draft));
              } catch (cause) {
                setError(messageOf(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NoteEditor(props: {
  readonly note: AldoMemoryItem | null;
  readonly onSaved: (items: AldoMemoryItem[]) => void;
  readonly onCancel?: () => void;
}) {
  const [editing, setEditing] = useState(props.note === null);
  const [title, setTitle] = useState(props.note?.title ?? "");
  const [body, setBody] = useState(props.note?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<AldoMemoryItem[]>) => {
    setBusy(true);
    setError(null);
    try {
      props.onSaved(await work());
      setEditing(false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!editing && props.note) {
    const note = props.note;
    return (
      <li className="group rounded-lg border border-border/60 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-sm">{note.title}</span>
          <Byline item={note} />
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground/90">{note.body}</p>
        <div className="mt-1 flex gap-1">
          <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => aldoMemory.forget(note.id))}
          >
            Forget
          </Button>
        </div>
        {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      </li>
    );
  }
  return (
    <li className="space-y-2 rounded-lg border border-border/60 px-3 py-2">
      <Input
        value={title}
        placeholder="Title, e.g. Package manager"
        onChange={(event) => setTitle(event.target.value)}
      />
      <Textarea
        size="sm"
        value={body}
        placeholder="The fact, e.g. Uses pnpm in every repository."
        onChange={(event) => setBody(event.target.value)}
      />
      {error ? <p className="text-destructive-foreground text-sm">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setEditing(false);
            setTitle(props.note?.title ?? "");
            setBody(props.note?.body ?? "");
            props.onCancel?.();
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy || !title.trim() || !body.trim()}
          onClick={() =>
            void run(async () => {
              // A new title is a new note: the old one goes.
              const items = await aldoMemory.saveNote(title, body);
              return props.note && props.note.title.toLowerCase() !== title.trim().toLowerCase()
                ? aldoMemory.forget(props.note.id)
                : items;
            })
          }
        >
          Save
        </Button>
      </div>
    </li>
  );
}

export function AldoMemoryPanel() {
  const [items, setItems] = useState<AldoMemoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    aldoMemory
      .list()
      .then(setItems)
      .catch((cause: unknown) => {
        // An Aldo from before the assistant.
        if (cause instanceof AldoApiError && cause.status === 404) setUnsupported(true);
        else setError(messageOf(cause));
      });
  }, []);
  const profile = items?.find((i) => i.kind === "profile") ?? null;
  const notes = items?.filter((i) => i.kind === "note") ?? [];
  const saved = (next: AldoMemoryItem[]) => {
    setItems(next);
    setAdding(false);
  };
  return (
    <SettingsSection
      title="Memory"
      icon={<BrainIcon className="size-4" />}
      headerAction={
        items ? (
          <Button
            size="compact"
            variant="outline"
            onClick={() => setAdding(true)}
            disabled={adding}
          >
            <PlusIcon className="size-3.5" /> Add a note
          </Button>
        ) : null
      }
    >
      <p className="px-3 text-sm text-muted-foreground sm:px-4">
        What Aldo knows about you, across every conversation: a few lines about you that it always
        has in mind, and notes, one fact each, that it looks up when they matter. Aldo writes them
        as you talk and after each conversation; change anything here, or tell Aldo to forget
        something. Secrets from your vault never go in.
      </p>
      {unsupported ? (
        <p className="px-3 text-sm text-muted-foreground sm:px-4">
          This Aldo server doesn't have memory yet.
        </p>
      ) : null}
      {error ? <p className="px-3 text-sm text-destructive-foreground sm:px-4">{error}</p> : null}
      {items === null && !unsupported && !error ? (
        <LoaderCircleIcon className="mx-4 size-4 animate-spin text-muted-foreground" />
      ) : null}
      {items ? (
        <>
          <ProfileEditor profile={profile} onSaved={saved} />
          <div className="space-y-2 px-3 sm:px-4">
            <h3 className="font-medium text-sm">Notes</h3>
            <ul className="space-y-2">
              {adding ? (
                <NoteEditor note={null} onSaved={saved} onCancel={() => setAdding(false)} />
              ) : null}
              {notes.map((note) => (
                <NoteEditor key={`${note.id}:${note.updatedAt}`} note={note} onSaved={saved} />
              ))}
            </ul>
            {notes.length === 0 && !adding ? (
              <p className="text-muted-foreground text-sm">No notes yet.</p>
            ) : null}
          </div>
        </>
      ) : null}
    </SettingsSection>
  );
}
