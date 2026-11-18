import { CheckCircle2Icon, ExternalLinkIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { SettingsRow } from "../components/settings/settingsLayout";
import { AldoBrandTile } from "./AldoBrandTile";
import { AldoConnectionTile } from "./AldoConnectionTile";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  connectAldoGitHost,
  disconnectAldoAccount,
  type AldoAccount,
  type AldoGitHostKind,
} from "./accountApi";

type Field = {
  key: "token" | "baseUrl" | "email" | "org";
  label: string;
  placeholder: string;
  secret?: boolean;
};

const HOSTS: Record<
  AldoGitHostKind,
  {
    title: string;
    description: string;
    /** Its catalog tile's line. */
    what: string;
    fields: Field[];
    tokenLink: (values: Record<string, string>) => string;
    tokenHelp: string;
  }
> = {
  gitlab: {
    title: "GitLab",
    description:
      "gitlab.com or your own GitLab: clone projects, open merge requests and follow them through.",
    what: "gitlab.com or your own GitLab",
    fields: [
      { key: "baseUrl", label: "GitLab address", placeholder: "https://gitlab.com" },
      { key: "token", label: "Personal access token", placeholder: "glpat-…", secret: true },
    ],
    tokenLink: (v) =>
      `${(v.baseUrl || "https://gitlab.com").replace(/\/+$/, "")}/-/user_settings/personal_access_tokens?name=Aldo&scopes=api,write_repository`,
    tokenHelp: "Create a personal access token with the api and write_repository scopes.",
  },
  bitbucket: {
    title: "Bitbucket",
    description: "Bitbucket Cloud: clone repositories, open pull requests and follow them through.",
    what: "Bitbucket Cloud repositories",
    fields: [
      { key: "email", label: "Atlassian account email", placeholder: "you@example.com" },
      { key: "token", label: "API token", placeholder: "ATATT…", secret: true },
    ],
    tokenLink: () => "https://id.atlassian.com/manage-profile/security/api-tokens",
    tokenHelp:
      "Create an API token with scopes for Bitbucket: read and write repositories, read and write pull requests, read pipelines and read account (add admin repositories to create new projects).",
  },
  azure: {
    title: "Azure DevOps",
    description: "Azure Repos: clone repositories, open pull requests and follow them through.",
    what: "Azure Repos",
    fields: [
      { key: "org", label: "Organization", placeholder: "my-org (from dev.azure.com/my-org)" },
      { key: "token", label: "Personal access token", placeholder: "Token", secret: true },
    ],
    tokenLink: (v) =>
      `https://dev.azure.com/${encodeURIComponent(v.org || "_")}/_usersSettings/tokens`,
    tokenHelp:
      "Create a personal access token with Code (read, write & manage), Build (read) and Project and Team (read & write).",
  },
};

/** A git host connected with a token (GitHub signs in with its own wizard); `tile`, in the catalog. */
export function AldoGitHostRow(props: {
  kind: AldoGitHostKind;
  account: AldoAccount | undefined;
  onChanged: () => void;
  tile?: boolean;
}) {
  const spec = HOSTS[props.kind];
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = props.account?.connected === true;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connectAldoGitHost(props.kind, values);
      setOpen(false);
      setValues({});
      props.onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const control = connected ? (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void disconnectAldoAccount(props.kind).then(props.onChanged)}
    >
      Disconnect
    </Button>
  ) : (
    <Button
      size={props.tile ? "compact" : "sm"}
      variant="outline"
      onClick={() => setOpen((value) => !value)}
    >
      {open ? "Cancel" : "Connect"}
    </Button>
  );
  const form =
    open && !connected ? (
      <form
        onSubmit={submit}
        className="mb-3 space-y-3 rounded-xl border border-border p-3"
        autoComplete="off"
      >
        <p className="text-muted-foreground text-xs">
          {spec.tokenHelp}{" "}
          <a
            className="inline-flex items-center gap-0.5 text-foreground underline underline-offset-2"
            href={spec.tokenLink(values)}
            target="_blank"
            rel="noreferrer"
          >
            Create a token <ExternalLinkIcon className="size-3" />
          </a>
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {spec.fields.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">{field.label}</span>
              <Input
                type={field.secret ? "password" : "text"}
                placeholder={field.placeholder}
                autoComplete="off"
                value={values[field.key] ?? ""}
                onChange={(e) => setValues({ ...values, [field.key]: e.currentTarget.value })}
              />
            </label>
          ))}
        </div>
        {error ? <p className="text-destructive-foreground text-xs">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy || !values.token}>
            {busy ? "Checking…" : "Connect"}
          </Button>
        </div>
      </form>
    ) : null;

  if (props.tile) {
    return (
      <AldoConnectionTile brand={props.kind} name={spec.title} what={spec.what} control={control}>
        {form}
      </AldoConnectionTile>
    );
  }
  return (
    <SettingsRow
      leading={<AldoBrandTile id={props.kind} name={spec.title} />}
      title={spec.title}
      description={spec.description}
      status={
        connected ? (
          <span className="inline-flex items-center gap-1 text-success-foreground">
            <CheckCircle2Icon className="size-3.5" />
            Connected{props.account?.account ? ` as ${props.account.account}` : ""}
          </span>
        ) : props.account ? null : (
          "Checking…"
        )
      }
      control={control}
    >
      {form}
    </SettingsRow>
  );
}

/** GitLab, Bitbucket and Azure DevOps. */
export const ALDO_GIT_HOST_KINDS = Object.keys(HOSTS) as ReadonlyArray<AldoGitHostKind>;
