// Account connections and preferences.

import {
  type SourceControlRepositorySummary,
  type AuthConnectorStartInput,
  type AuthConnectorSession,
} from "@t3tools/contracts";
import { api, AldoApiError } from "./api";
import {
  parseAldoMomentEmails,
  type AldoMomentEmailKind,
  type AldoMomentEmails,
} from "./momentEmails.logic";
import { parseAldoOrg, type AldoOrg, type AldoOrgRole } from "./organization.logic";
import {
  parseAldoDomainCheck,
  parseAldoJoining,
  type AldoJoining,
  type AldoJoinPolicy,
} from "./orgJoining.logic";
import {
  parseAldoActivity,
  parseAldoMemberPage,
  parseAldoOrgMachines,
  parseAldoOrgNotes,
  parseAldoOrgUsage,
  parseAldoThreadDays,
  type AldoMemberPage,
} from "./orgAdmin.logic";

export type AldoAccountKind = "github" | "claude" | "codex" | "grok" | "muse";

/** Git hosts connected with an access token (GitHub has its own sign-in wizard). */
export type AldoGitHostKind = "gitlab" | "bitbucket" | "azure";

export type AldoHostKind = "github" | AldoGitHostKind;

/** Where a new project goes: a git host, or Aldo itself (a project of work that isn't code, `aldo:<slug>`). */
export type AldoProjectHost = AldoHostKind | "aldo";

export interface AldoAccount {
  readonly connected: boolean;
  readonly account: string | null;
  readonly plan: string | null;
}

export async function listAldoRepositories(): Promise<
  ReadonlyArray<SourceControlRepositorySummary>
> {
  const { repositories } = await api<{ repositories: SourceControlRepositorySummary[] }>(
    "/api/repos",
  );
  return repositories;
}

// ---------------------------------------------------------------------------
// Accounts (sign-in wizards)

let reportedAccounts: ReadonlySet<string> | null = null;

export async function fetchAldoAccounts(): Promise<
  Record<AldoAccountKind | AldoGitHostKind, AldoAccount>
> {
  const accounts =
    await api<Record<AldoAccountKind | AldoGitHostKind, AldoAccount>>("/api/connections");
  reportedAccounts = new Set(Object.keys(accounts));
  return accounts;
}

/** Whether Aldo keeps this kind of account, or null before it has said. */
export function aldoReportsAccount(kind: string): boolean | null {
  return reportedAccounts ? reportedAccounts.has(kind) : null;
}

/** Connects GitLab, Bitbucket or Azure DevOps with an access token. */
export async function connectAldoGitHost(
  kind: AldoGitHostKind,
  values: Record<string, string>,
): Promise<void> {
  await api(`/api/hosts/${kind}`, { method: "POST", body: JSON.stringify(values) });
}

export async function disconnectAldoAccount(
  kind: AldoAccountKind | AldoGitHostKind,
): Promise<void> {
  await api(`/api/connections/${kind}`, { method: "DELETE" });
}

export const aldoAuthConnectors = {
  start: (input: AuthConnectorStartInput) =>
    api<AuthConnectorSession>("/api/connectors", { method: "POST", body: JSON.stringify(input) }),
  get: (sessionId: string) => api<AuthConnectorSession>(`/api/connectors/${sessionId}`),
  submit: (sessionId: string, values: Record<string, string>) =>
    api<AuthConnectorSession>(`/api/connectors/${sessionId}/submit`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
  cancel: (sessionId: string) =>
    api<AuthConnectorSession>(`/api/connectors/${sessionId}/cancel`, { method: "POST" }),
};

// ---------------------------------------------------------------------------
// Integrations (accounts agents use, like Microsoft for OneDrive and Excel)

export type AldoIntegrationAccountType = "work" | "personal";

/** What agents can do with a connected account. */
export type AldoIntegrationCapability = "mail" | "calendar" | "contacts" | "files" | "payments";

export interface AldoIntegration {
  readonly provider: string;
  readonly name: string;
  /** False when this Aldo has no app set up with the provider, so there's nothing to connect yet. */
  readonly available: boolean;
  readonly connected: boolean;
  readonly account: {
    readonly email: string;
    readonly name: string;
    /** A Microsoft account's type. */
    readonly type?: AldoIntegrationAccountType;
  } | null;
  /** What agents can do with it (an older Aldo leaves it out). */
  readonly can?: ReadonlyArray<AldoIntegrationCapability>;
  /** What connecting again would add (a sign-in from before Aldo asked for it). */
  readonly missing?: ReadonlyArray<AldoIntegrationCapability>;
  /** Why the provider stopped accepting the sign-in; it needs connecting again. */
  readonly error: string | null;
  /** "key" for a generator the user connects with its API key (an older Aldo leaves it out: an account). */
  readonly kind?: "account" | "key";
  /** A generator's: what it makes, as Settings says it. */
  readonly description?: string;
  /** A generator's: where the user creates a key. */
  readonly keyUrl?: string;
  /** A generator's: what connecting asks for (an API key, or a key and its secret). */
  readonly fields?: ReadonlyArray<AldoIntegrationKeyField>;
}

export interface AldoIntegrationKeyField {
  readonly name: string;
  readonly label: string;
  readonly placeholder?: string;
}

/** The integrations this Aldo offers and how each stands; null for an Aldo without them. */
export async function fetchAldoIntegrations(): Promise<ReadonlyArray<AldoIntegration> | null> {
  const body = await api<{ integrations?: AldoIntegration[] }>("/api/integrations").catch(
    (error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    },
  );
  // An older Aldo may answer with the web client's page instead of a 404.
  return Array.isArray(body?.integrations) ? body.integrations : null;
}

export interface AldoAgentInboxAddress {
  readonly email: string;
  readonly displayName: string;
}

/** The user's agent inbox: an email address of their agents' own, at a handle the user claims. */
export interface AldoAgentInbox {
  /** False when this Aldo has no agent inboxes. */
  readonly available: boolean;
  /** The domain addresses are at (an Aldo that doesn't say has no claiming). */
  readonly domain?: string;
  /** Whether its sender name can be changed here (an older Aldo leaves it out: it can't). */
  readonly renamable: boolean;
  /** Whether its mail can be read on the Mail page (an older Aldo leaves it out: it can't). */
  readonly mail: boolean;
  readonly inbox: AldoAgentInboxAddress | null;
}

const inboxAddressOf = (value: unknown): AldoAgentInboxAddress | null => {
  const inbox = value as Partial<AldoAgentInboxAddress> | null | undefined;
  return inbox && typeof inbox.email === "string"
    ? {
        email: inbox.email,
        displayName: typeof inbox.displayName === "string" ? inbox.displayName : "",
      }
    : null;
};

/** The user's agent inbox and whether this Aldo has them; null for an Aldo without them. */
export async function fetchAldoAgentInbox(): Promise<AldoAgentInbox | null> {
  const body = await api<Partial<AldoAgentInbox>>("/api/agent-inbox").catch((error: unknown) => {
    if (error instanceof AldoApiError && error.status === 404) return null;
    throw error;
  });
  // An older Aldo may answer with the web client's page instead of a 404.
  if (typeof body?.available !== "boolean") return null;
  return {
    available: body.available,
    ...(typeof body.domain === "string" && body.domain ? { domain: body.domain } : {}),
    renamable: body.renamable === true,
    mail: body.mail === true,
    inbox: inboxAddressOf(body.inbox),
  };
}

export interface AldoAgentHandleCheck {
  readonly handle: string;
  readonly address: string;
  readonly available: boolean;
  /** Why it can't be claimed. */
  readonly reason?: string;
}

/** Whether a handle can be claimed as the agents' address. */
export async function checkAldoAgentHandle(handle: string): Promise<AldoAgentHandleCheck> {
  const body = await api<Partial<AldoAgentHandleCheck>>(
    `/api/agent-inbox?handle=${encodeURIComponent(handle)}`,
  );
  if (typeof body.available !== "boolean" || typeof body.address !== "string") {
    throw new Error("This Aldo can't check handles.");
  }
  return {
    handle: typeof body.handle === "string" ? body.handle : handle,
    address: body.address,
    available: body.available,
    ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
  };
}

/** Claims the agents' address at `handle`, for good. */
export async function claimAldoAgentAddress(handle: string): Promise<AldoAgentInboxAddress> {
  const body = await api<{ inbox?: unknown }>("/api/agent-inbox", {
    method: "POST",
    body: JSON.stringify({ handle }),
  });
  const inbox = inboxAddressOf(body.inbox);
  if (!inbox) throw new Error("This Aldo didn't say which address it claimed.");
  return inbox;
}

/** Changes the name the agents' mail goes out under, beside its address. */
export async function renameAldoAgentInbox(displayName: string): Promise<AldoAgentInboxAddress> {
  const body = await api<{ inbox?: unknown }>("/api/agent-inbox", {
    method: "PATCH",
    body: JSON.stringify({ displayName }),
  });
  const inbox = inboxAddressOf(body.inbox);
  if (!inbox) throw new Error("This Aldo didn't say what the inbox is called now.");
  return inbox;
}

// ---------------------------------------------------------------------------
// The agents' mail, read on the Mail page (AldoMail.tsx)

/** A message in a folder or search, without its body. */
export interface AldoMailSummary {
  readonly id: string;
  readonly threadId: string;
  readonly from: string;
  readonly to: ReadonlyArray<string>;
  readonly subject: string;
  readonly preview: string;
  readonly at: string;
  /** The agents sent it. */
  readonly sent: boolean;
  readonly spam: boolean;
  /** Files attached, not counting images shown inside it. */
  readonly attachments: number;
}

export interface AldoMailAttachment {
  readonly id: string;
  readonly filename: string;
  readonly size: number;
  readonly contentType: string;
  readonly inline: boolean;
  /** For an image inside the mail: what its HTML calls it (`cid:`), and where it is until `expiresAt`. */
  readonly contentId?: string;
  readonly url?: string;
  readonly expiresAt?: string;
}

export interface AldoMailMessage {
  readonly id: string;
  readonly from: string;
  readonly to: ReadonlyArray<string>;
  readonly cc: ReadonlyArray<string>;
  readonly replyTo: ReadonlyArray<string>;
  readonly subject: string;
  readonly at: string;
  readonly sent: boolean;
  readonly spam: boolean;
  readonly reply: boolean;
  readonly text?: string;
  readonly html?: string;
  readonly extractedText?: string;
  readonly extractedHtml?: string;
  /** A body was too long to send whole: cut off, or left out. */
  readonly clipped?: boolean;
  readonly attachments: ReadonlyArray<AldoMailAttachment>;
}

/** A conversation, oldest message first. */
export interface AldoMailThread {
  readonly id: string;
  readonly subject: string;
  readonly messages: ReadonlyArray<AldoMailMessage>;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

const strs = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/** A page of the agents' mail: a folder, newest first, or a search (`q`), best match first; `page` is the last page's `next`. */
export async function fetchAldoMail(
  input: { readonly folder: string; readonly q?: string; readonly page?: string | null },
  signal?: AbortSignal,
): Promise<{ readonly messages: ReadonlyArray<AldoMailSummary>; readonly next: string | null }> {
  const query = new URLSearchParams({ folder: input.folder });
  if (input.q) query.set("q", input.q);
  if (input.page) query.set("page", input.page);
  const body = await api<{ messages?: unknown; next?: unknown }>(
    `/api/agent-inbox/messages?${query}`,
    { cache: "no-store", ...(signal ? { signal } : {}) },
  );
  if (!Array.isArray(body.messages)) throw new Error("This Aldo can't show your agents' mail.");
  const messages = body.messages.flatMap((item): AldoMailSummary[] => {
    const mail = item as Record<string, unknown>;
    if (typeof mail.id !== "string" || typeof mail.threadId !== "string") return [];
    return [
      {
        id: mail.id,
        threadId: mail.threadId,
        from: str(mail.from),
        to: strs(mail.to),
        subject: str(mail.subject),
        preview: str(mail.preview),
        at: str(mail.at),
        sent: mail.sent === true,
        spam: mail.spam === true,
        attachments: typeof mail.attachments === "number" ? mail.attachments : 0,
      },
    ];
  });
  return { messages, next: typeof body.next === "string" && body.next ? body.next : null };
}

/** A conversation in the agents' inbox, every message whole. */
export async function fetchAldoMailThread(
  threadId: string,
  signal?: AbortSignal,
): Promise<AldoMailThread> {
  const body = await api<{ thread?: Record<string, unknown> }>(
    `/api/agent-inbox/threads/${encodeURIComponent(threadId)}`,
    { cache: "no-store", ...(signal ? { signal } : {}) },
  );
  const thread = body.thread;
  if (!thread || !Array.isArray(thread.messages)) {
    throw new Error("This Aldo can't show that conversation.");
  }
  const messages = thread.messages.flatMap((item): AldoMailMessage[] => {
    const mail = item as Record<string, unknown>;
    if (typeof mail.id !== "string") return [];
    const optional = (key: "text" | "html" | "extractedText" | "extractedHtml") =>
      typeof mail[key] === "string" && mail[key] ? { [key]: mail[key] } : {};
    const attachments = (Array.isArray(mail.attachments) ? mail.attachments : []).flatMap(
      (entry): AldoMailAttachment[] => {
        const a = entry as Record<string, unknown>;
        if (typeof a.id !== "string") return [];
        return [
          {
            id: a.id,
            filename: str(a.filename),
            size: typeof a.size === "number" ? a.size : 0,
            contentType: str(a.contentType) || "application/octet-stream",
            inline: a.inline === true,
            ...(typeof a.contentId === "string" && a.contentId ? { contentId: a.contentId } : {}),
            ...(typeof a.url === "string" && a.url.startsWith("https://") ? { url: a.url } : {}),
            ...(typeof a.expiresAt === "string" && a.expiresAt ? { expiresAt: a.expiresAt } : {}),
          },
        ];
      },
    );
    return [
      {
        id: mail.id,
        from: str(mail.from),
        to: strs(mail.to),
        cc: strs(mail.cc),
        replyTo: strs(mail.replyTo),
        subject: str(mail.subject),
        at: str(mail.at),
        sent: mail.sent === true,
        spam: mail.spam === true,
        reply: mail.reply === true,
        ...optional("text"),
        ...optional("html"),
        ...optional("extractedText"),
        ...optional("extractedHtml"),
        ...(mail.clipped === true ? { clipped: true } : {}),
        attachments,
      },
    ];
  });
  return { id: str(thread.id) || threadId, subject: str(thread.subject), messages };
}

/** Where an attachment of the agents' mail downloads from: Aldo checks it, then sends the browser on to AgentMail's signed address for it. */
export function aldoMailAttachmentUrl(threadId: string, attachmentId: string): string {
  return `/api/agent-inbox/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export interface AldoPhoneSettings {
  readonly smsTermsUrl?: string;
  readonly available: boolean;
  readonly prototype: boolean;
  readonly number: string | null;
  readonly sms: boolean;
  readonly voice: boolean;
  readonly verified: boolean;
  readonly phone: string | null;
  readonly smsEnabled: boolean;
  readonly voiceEnabled: boolean;
  readonly hasPin: boolean;
  readonly error: string | null;
  readonly events: ReadonlyArray<{
    id: string;
    channel: string;
    state: string;
    error: string | null;
    at: string;
  }>;
  readonly deliveries: ReadonlyArray<{ id: string; state: string; error: string | null }>;
  readonly calls: ReadonlyArray<{ state: string; error: string | null; at: string }>;
}

/** Absent on older servers: either half can ship first. */
export async function fetchAldoPhone(): Promise<AldoPhoneSettings | null> {
  const result = await api<AldoPhoneSettings>("/api/phone").catch((error: unknown) => {
    if (error instanceof AldoApiError && error.status === 404) return null;
    throw error;
  });
  return typeof result?.available === "boolean" ? result : null;
}

export const aldoPhone = {
  verify: (phone: string) =>
    api<{ verificationId: string; prototypeCode?: string }>("/api/phone/verification", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  confirm: (verificationId: string, code: string, pin: string) =>
    api<AldoPhoneSettings>("/api/phone/verification", {
      method: "PUT",
      body: JSON.stringify({ verificationId, code, pin }),
    }),
  update: (input: { smsEnabled?: boolean; voiceEnabled?: boolean; pin?: string }) =>
    api<AldoPhoneSettings>("/api/phone", { method: "PATCH", body: JSON.stringify(input) }),
  disconnect: () => api<AldoPhoneSettings>("/api/phone", { method: "DELETE" }),
  prototype: (input: Record<string, unknown>) =>
    api<{ reply?: string | null; state?: string; callId?: string; twiml?: string }>(
      "/api/phone/prototype",
      { method: "POST", body: JSON.stringify(input) },
    ),
};

/** Where connecting starts: Aldo sends it on to the provider's sign-in. */
export function aldoIntegrationConnectUrl(
  provider: string,
  account?: AldoIntegrationAccountType,
): string {
  const path = `/api/integrations/${encodeURIComponent(provider)}/connect`;
  return account ? `${path}?account=${account}` : path;
}

export async function disconnectAldoIntegration(provider: string): Promise<void> {
  await api(`/api/integrations/${encodeURIComponent(provider)}`, { method: "DELETE" });
}

// Apps: any app with a remote MCP server, connected for every agent
// (logancsack/aldo src/lib/apps.ts). Aldo signs in to each in a popup and
// keeps the sign-in; an older Aldo has none (null).

export interface AldoApp {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly url: string;
  /** connected; connecting (a sign-in under way, or never finished); failed (the app stopped accepting it). */
  readonly status: "connected" | "connecting" | "failed";
  readonly error: string | null;
  /** When its status last changed (ISO); an older Aldo doesn't say. */
  readonly changedAt?: string;
}

export interface AldoAppCatalogEntry {
  readonly name: string;
  readonly title: string;
  readonly url: string;
  readonly about: string;
  readonly connected: boolean;
}

export async function fetchAldoApps(): Promise<{
  readonly catalog: ReadonlyArray<AldoAppCatalogEntry>;
  readonly apps: ReadonlyArray<AldoApp>;
} | null> {
  const body = await api<{ catalog?: AldoAppCatalogEntry[]; apps?: AldoApp[] }>("/api/apps").catch(
    (error: unknown) => {
      if (error instanceof AldoApiError && error.status === 404) return null;
      throw error;
    },
  );
  // An older Aldo may answer with the web client's page instead of a 404.
  return Array.isArray(body?.catalog) && Array.isArray(body?.apps)
    ? { catalog: body.catalog, apps: body.apps }
    : null;
}

/** The page that starts an app's sign-in: a catalog app by name, or any MCP server by its URL. */
export function aldoAppConnectUrl(
  target: { readonly app: string } | { readonly url: string },
): string {
  return "app" in target
    ? `/api/apps/connect?app=${encodeURIComponent(target.app)}`
    : `/api/apps/connect?url=${encodeURIComponent(target.url)}`;
}

export async function disconnectAldoApp(id: string): Promise<void> {
  await api(`/api/apps/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Connects a generator with the user's key, using an account check where the provider supports one. */
export async function connectAldoIntegrationKey(
  provider: string,
  values: Readonly<Record<string, string>>,
): Promise<void> {
  await api(`/api/integrations/${encodeURIComponent(provider)}`, {
    method: "POST",
    body: JSON.stringify({ values }),
  });
}

/** Sets how much extra usage past the plan's credits is allowed each period, in cents. */
export async function setAldoSpendLimit(cents: number): Promise<void> {
  await api("/api/usage", { method: "PATCH", body: JSON.stringify({ spendLimitCents: cents }) });
}

/** The usage summary the Usage page shows (state/aldoWorkspaceUsage.ts checks its shape). */
export async function fetchAldoCloudUsage(signal?: AbortSignal): Promise<unknown> {
  return api<unknown>("/api/usage", { cache: "no-store", ...(signal ? { signal } : {}) });
}

/**
 * Where to pay for a plan: Stripe Checkout, which comes back to /usage?checkout=done or =canceled,
 * or, started from the plan picker under a kept request (`resume`, its id), to Home, which sends it.
 * `extraUsage` turns extra usage on for the plan, where Aldo's Checkout offers it (billing.extraUsage).
 */
export async function startAldoCheckout(
  plan: string,
  options: { readonly resume?: string; readonly extraUsage?: boolean } = {},
): Promise<string> {
  const { url } = await api<{ url: string }>("/api/billing/checkout", {
    method: "POST",
    body: JSON.stringify({
      plan,
      ...(options.resume ? { resume: options.resume } : {}),
      ...(options.extraUsage ? { extraUsage: true } : {}),
    }),
  });
  return url;
}

/**
 * Switches the Stripe plan: an upgrade now, a downgrade when the period ends;
 * the current plan cancels a pending downgrade. 409 when there's no Stripe
 * subscription (check out instead), 402 when the upgrade's payment failed.
 */
export async function changeAldoPlan(plan: string): Promise<"now" | "period_end"> {
  const { effective } = await api<{ effective: "now" | "period_end" }>("/api/billing/plan", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return effective;
}

/** Ends the plan when the period does, or with `resume`, keeps it going after all. */
export async function cancelAldoPlan(resume: boolean): Promise<void> {
  await api("/api/billing/cancel", { method: "POST", body: JSON.stringify({ resume }) });
}

/**
 * Deletes the stopped Windows computer's kept disk: it stops costing credits,
 * and the computer starts fresh next time. Says what happened; 409 while the
 * computer runs, starts or stops.
 */
export async function deleteAldoWindowsDisk(): Promise<string> {
  const { message } = await api<{ message?: unknown }>("/api/computers?kind=windows", {
    method: "DELETE",
  });
  return typeof message === "string" ? message : "Deleted.";
}

/** Stripe's billing portal (payment method, invoices), which comes back to /usage. */
export async function aldoBillingPortalUrl(): Promise<string> {
  const { url } = await api<{ url: string }>("/api/billing/portal", { method: "POST" });
  return url;
}

/** The user's instructions for their agents: for every project (scope "*") or one repository. */
export interface AldoInstructions {
  readonly scope: string;
  readonly text: string;
  readonly updated_at: string;
}

/** Settings → Instructions. */
export const aldoInstructions = {
  list: async () =>
    (await api<{ instructions: AldoInstructions[] }>("/api/instructions")).instructions,
  /**
   * Replaces one scope's instructions (empty text removes them). `since` is the
   * updated_at the edit started from (null for none): if they've changed since,
   * Aldo refuses with a 409.
   */
  save: async (scope: string, text: string, since: string | null) =>
    (
      await api<{ instructions: AldoInstructions[] }>("/api/instructions", {
        method: "POST",
        body: JSON.stringify({ scope, text, since }),
      })
    ).instructions,
};

/** One of the user's skills: how their agents do a kind of task, loaded when a task needs it. */
export interface AldoSkill {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly updated_at: string;
}

/** Settings → Skills. */
export const aldoSkills = {
  list: async () => {
    const { skills } = await api<{ skills?: AldoSkill[] }>("/api/skills");
    // An older Aldo answers with the web client's page: it has no skills.
    if (!Array.isArray(skills))
      throw new AldoApiError(404, "This Aldo server doesn't have skills yet.");
    return skills;
  },
  /**
   * Saves a skill. `since` is the updated_at of the version the edit started
   * from (null for a new one): if it's changed since, or a new one's name is
   * taken, Aldo refuses with a 409.
   */
  save: async (
    skill: Pick<AldoSkill, "name" | "description" | "instructions">,
    since: string | null,
  ) =>
    (
      await api<{ skills: AldoSkill[] }>("/api/skills", {
        method: "POST",
        body: JSON.stringify({ ...skill, since }),
      })
    ).skills,
  /**
   * Removes a skill. With `since`, the updated_at of the version the user was
   * looking at, Aldo refuses with a 409 if it's changed since (an older Aldo
   * removes it regardless).
   */
  remove: async (name: string, since: string | null) => {
    const query = new URLSearchParams({ name, ...(since ? { since } : {}) });
    return (await api<{ skills: AldoSkill[] }>(`/api/skills?${query}`, { method: "DELETE" }))
      .skills;
  },
};

/** How a vault secret reaches a thread: a variable, injected into requests to some sites, or a file. */
export type AldoSecretKind = "env" | "request" | "file";

export interface AldoVaultItem {
  readonly id: string;
  readonly kind: AldoSecretKind | "login";
  readonly name: string;
  readonly scope: string;
  readonly origin: string | null;
  readonly username: string | null;
  readonly hosts: ReadonlyArray<string> | null;
  readonly header: string | null;
  readonly template: string | null;
  readonly path: string | null;
  readonly updated_at: string;
  readonly last_used_at: string | null;
  /** The thread whose agent saved it (save_secret, save_login); null or absent for the user's own. */
  readonly agent_thread_id?: string | null;
}

export interface AldoSecretInput {
  readonly kind: AldoSecretKind;
  readonly name: string;
  readonly scope: string;
  /** Empty keeps the saved value (to change only how it's delivered). */
  readonly value: string;
  readonly hosts?: string;
  readonly header?: string;
  readonly template?: string;
  readonly path?: string;
  /** The thread that asked for it (request_secret): told when it's saved. */
  readonly requestedBy?: { readonly thread: string; readonly t3?: string };
}

export const aldoVault = {
  list: async () => (await api<{ items: AldoVaultItem[] }>("/api/vault")).items,
  saveSecret: (input: AldoSecretInput) =>
    api<{ item: AldoVaultItem }>("/api/vault", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  saveLogin: (input: {
    id?: string;
    label: string;
    origin: string;
    username: string;
    password?: string;
    scope: string;
  }) =>
    api<{ item: AldoVaultItem }>("/api/vault", {
      method: "POST",
      body: JSON.stringify({ kind: "login", ...input }),
    }),
  remove: (id: string) => api(`/api/vault/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** Sites the user said never to offer saving a login for. An Aldo from before it kept them answers 404 or 405. */
  neverSave: async () => (await api<{ origins: string[] }>("/api/vault/never-save")).origins,
  setNeverSave: (origin: string, never: boolean) =>
    api<{ origin: string }>("/api/vault/never-save", {
      method: never ? "POST" : "DELETE",
      body: JSON.stringify({ origin }),
    }),
  importDotenv: (scope: string, text: string) =>
    api<{ saved: string[]; skipped: string[] }>("/api/vault/import", {
      method: "POST",
      body: JSON.stringify({ scope, text }),
    }),
};

/** Aldo's heads-ups: whether it looks at the user's new mail and coming events between conversations. */
export interface AldoHeadsUps {
  readonly on: boolean;
  readonly lookedAt: string | null;
  /** How they're tuned; null on an Aldo that only turns them on or off. */
  readonly tuning: AldoHeadsUpsTuning | null;
}

/** Quiet hours, other apps and topics, as the user set them. */
export interface AldoHeadsUpsTuning {
  /** Minutes after their midnight, where they are: quiet from this... */
  readonly quietStart: number;
  /** ...until this. The same two, never quiet. */
  readonly quietEnd: number;
  /** Hours between reads of their other apps; 0, never. */
  readonly appsEvery: number;
  /** What they asked to hear about, and not, in their words. */
  readonly tell: string;
  readonly skip: string;
  /** The connected apps Aldo can read. */
  readonly apps: ReadonlyArray<string>;
}

/** What to change: any of them. */
export type AldoHeadsUpsChange = Partial<{ on: boolean } & Omit<AldoHeadsUpsTuning, "apps">>;

type HeadsUpsBody = Partial<
  { on: unknown; lookedAt: unknown } & Record<keyof AldoHeadsUpsTuning, unknown>
>;

function tuningOf(body: HeadsUpsBody): AldoHeadsUpsTuning | null {
  const { quietStart, quietEnd, appsEvery, tell, skip, apps } = body;
  return typeof quietStart === "number" &&
    typeof quietEnd === "number" &&
    typeof appsEvery === "number" &&
    typeof tell === "string" &&
    typeof skip === "string" &&
    Array.isArray(apps)
    ? {
        quietStart,
        quietEnd,
        appsEvery,
        tell,
        skip,
        apps: apps.filter((a): a is string => typeof a === "string"),
      }
    : null;
}

/** Heads-ups as Aldo answered, or null for an answer that isn't (an older Aldo's page for a path it doesn't have). */
function headsUpsOf(body: HeadsUpsBody | null): AldoHeadsUps | null {
  return typeof body?.on === "boolean"
    ? {
        on: body.on,
        lookedAt: typeof body.lookedAt === "string" ? body.lookedAt : null,
        tuning: tuningOf(body),
      }
    : null;
}

/** Null where this Aldo has no heads-ups. */
export async function fetchAldoHeadsUps(): Promise<AldoHeadsUps | null> {
  try {
    return headsUpsOf(await api<HeadsUpsBody>("/api/assistant/heads-ups"));
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}

export async function setAldoHeadsUps(change: AldoHeadsUpsChange): Promise<AldoHeadsUps> {
  const saved = headsUpsOf(
    await api<HeadsUpsBody>("/api/assistant/heads-ups", {
      method: "PUT",
      body: JSON.stringify(change),
    }),
  );
  if (!saved) throw new Error("This Aldo doesn't have heads-ups.");
  return saved;
}

/** When the brief comes to the user's devices each day, and whether it does. */
export interface AldoBriefSettings {
  /** Minutes after their midnight, where they are. */
  readonly minute: number;
  readonly push: boolean;
  /** When it's next due; null when it won't come (off, or until they next open Aldo). */
  readonly nextAt: string | null;
}

/** The brief's settings as Aldo answered, or null for an answer that isn't. */
function briefSettingsOf(body: Partial<AldoBriefSettings> | null): AldoBriefSettings | null {
  return typeof body?.minute === "number" && typeof body.push === "boolean"
    ? {
        minute: body.minute,
        push: body.push,
        nextAt: typeof body.nextAt === "string" ? body.nextAt : null,
      }
    : null;
}

/** Null where this Aldo doesn't send the brief. */
export async function fetchAldoBriefSettings(): Promise<AldoBriefSettings | null> {
  try {
    return briefSettingsOf(await api<Partial<AldoBriefSettings>>("/api/assistant/brief/settings"));
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}

export async function setAldoBriefSettings(change: {
  readonly minute?: number;
  readonly push?: boolean;
}): Promise<AldoBriefSettings> {
  const saved = briefSettingsOf(
    await api<Partial<AldoBriefSettings>>("/api/assistant/brief/settings", {
      method: "PUT",
      body: JSON.stringify(change),
    }),
  );
  if (!saved) throw new Error("This Aldo doesn't send the brief.");
  return saved;
}

/** Null where this Aldo doesn't send these emails (src/aldo/momentEmails.logic.ts). */
export async function fetchAldoMomentEmails(): Promise<AldoMomentEmails | null> {
  try {
    return parseAldoMomentEmails(await api<unknown>("/api/notifications/email"));
  } catch (cause) {
    if (cause instanceof AldoApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** Turns one kind on or off; the others stay as they are. */
export async function setAldoMomentEmails(
  kind: AldoMomentEmailKind,
  on: boolean,
): Promise<AldoMomentEmails> {
  const saved = parseAldoMomentEmails(
    await api<unknown>("/api/notifications/email", {
      method: "PUT",
      body: JSON.stringify({ [kind]: on }),
    }),
  );
  if (!saved) throw new Error("This Aldo doesn't send these emails.");
  return saved;
}

/** The user's organization; null when they're in none, or this Aldo has none. */
export async function fetchAldoOrg(): Promise<AldoOrg | null> {
  const body = await api<{ org?: unknown }>("/api/org").catch((error: unknown) => {
    if (error instanceof AldoApiError && error.status === 404) return null;
    throw error;
  });
  return parseAldoOrg(body?.org);
}

/** Each change answers the organization as it is now, or null once the user is out of it. */
const orgChange = (path: string, method: string, body?: unknown) =>
  api<{ org?: unknown; link?: unknown }>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((answer) => ({
    org: parseAldoOrg(answer.org),
    link: typeof answer.link === "string" ? answer.link : null,
  }));

const invitePath = (id: string) => `/api/org/invites/${encodeURIComponent(id)}`;
const memberPath = (id: string) => `/api/org/members/${encodeURIComponent(id)}`;

export const aldoOrg = {
  rename: (name: string) => orgChange("/api/org", "PATCH", { name }),
  delete: () => orgChange("/api/org", "DELETE"),
  invite: (email: string, role: AldoOrgRole) =>
    orgChange("/api/org/invites", "POST", { email, role }),
  /** Emails the invite again (7 fresh days; the old link stops working), or answers its link to copy. */
  renewInvite: (id: string, send: "email" | "link") => orgChange(invitePath(id), "POST", { send }),
  revokeInvite: (id: string) => orgChange(invitePath(id), "DELETE"),
  setRole: (id: string, role: AldoOrgRole) => orgChange(memberPath(id), "PATCH", { role }),
  /** Removes someone, or the user themselves: leaving. */
  remove: (id: string) => orgChange(memberPath(id), "DELETE"),
};

/** A read of members' work; null from an Aldo without it (404, or 405 where the route only changes) or an answer that isn't one. */
async function orgRead<T>(path: string, parse: (body: unknown) => T | null): Promise<T | null> {
  try {
    return parse(await api<unknown>(path));
  } catch (cause) {
    if (cause instanceof AldoApiError && (cause.status === 404 || cause.status === 405))
      return null;
    throw cause;
  }
}

const memberChange = (id: string, body: unknown) =>
  api<unknown>(memberPath(id), { method: "PATCH", body: JSON.stringify(body) }).then(
    (answer): AldoMemberPage => {
      const page = parseAldoMemberPage(answer);
      if (!page) throw new Error("Aldo didn't say how it went. Reload to see.");
      return page;
    },
  );

const stopped = (answer: { stopped?: unknown }) =>
  typeof answer.stopped === "number" ? answer.stopped : 0;

/**
 * Owners' and admins' view of members' work, and what they do about it
 * (orgAdmin.logic.ts); a member reads only their own Activity and notes.
 */
export const aldoOrgAdmin = {
  usage: () => orgRead("/api/org/usage", parseAldoOrgUsage),
  machines: () => orgRead("/api/org/machines", parseAldoOrgMachines),
  /** A member's month; null once they're not in the organization, as for an Aldo without these pages. */
  member: (id: string) => orgRead(memberPath(id), parseAldoMemberPage),
  thread: (id: string) =>
    orgRead(`/api/org/threads/${encodeURIComponent(id)}`, parseAldoThreadDays),
  activity: (
    options: { readonly person?: string | null; readonly before?: string | null } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.person) query.set("person", options.person);
    if (options.before) query.set("before", options.before);
    const search = query.toString();
    return orgRead(`/api/org/activity${search ? `?${search}` : ""}`, parseAldoActivity);
  },
  notes: () => orgRead("/api/org/notes", parseAldoOrgNotes),
  /** Stops an organization thread's machines, with a note to its member; how many threads stopped. */
  stop: (threadId: string, note: string) =>
    api<{ stopped?: unknown }>(`/api/org/machines/${encodeURIComponent(threadId)}/stop`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }).then(stopped),
  /** Stops every machine the user may stop, or only one member's. */
  stopAll: (input: { readonly note?: string; readonly member?: string }) =>
    api<{ stopped?: unknown }>("/api/org/machines/stop-all", {
      method: "POST",
      body: JSON.stringify(input),
    }).then(stopped),
  /** Their extra usage limit in cents, or null for the organization's default. */
  setLimit: (id: string, cents: number | null) => memberChange(id, { limitCents: cents }),
  setPaused: (id: string, paused: boolean) => memberChange(id, { paused }),
};

const joiningChange = (path: string, method: string, body?: unknown) =>
  api<unknown>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then((answer): AldoJoining => {
    const joining = parseAldoJoining(answer);
    if (!joining) throw new Error("Aldo didn't say how it went. Reload to see.");
    return joining;
  });

const domainPath = (id: string) => `/api/org/domains/${encodeURIComponent(id)}`;

/**
 * Who can join the organization (orgJoining.logic.ts), for its owners and
 * admins: each change answers it as it is after.
 */
export const aldoOrgJoining = {
  /** Null from an Aldo without it, or for someone in no organization. */
  get: () => orgRead("/api/org/joining", parseAldoJoining),
  setPolicy: (policy: AldoJoinPolicy) => joiningChange("/api/org/joining", "PATCH", { policy }),
  addDomain: (domain: string) => joiningChange("/api/org/domains", "POST", { domain }),
  /** Looks the domain's record up now; what it saw, too. */
  checkDomain: (id: string) =>
    api<unknown>(domainPath(id), { method: "POST" }).then((answer) => {
      const checked = parseAldoDomainCheck(answer);
      if (!checked) throw new Error("Aldo didn't say how it went. Reload to see.");
      return checked;
    }),
  removeDomain: (id: string) => joiningChange(domainPath(id), "DELETE"),
  /** Turns the invite link on, or changes it. */
  setLink: (input: {
    readonly days?: 1 | 7 | 30;
    readonly anyAddress?: boolean;
    readonly replace?: true;
  }) => joiningChange("/api/org/link", "PUT", input),
  linkOff: () => joiningChange("/api/org/link", "DELETE"),
  /** Approving sends an invite to the address that asked; declining tells it so. */
  decide: (id: string, approve: boolean) =>
    joiningChange(`/api/org/requests/${encodeURIComponent(id)}`, "POST", { approve }),
};
