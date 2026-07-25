import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const GitHubAuthStatusAccountSchema = Schema.Struct({
  state: Schema.String,
  error: Schema.optional(Schema.String),
  active: Schema.Boolean,
  host: Schema.String,
  login: Schema.String,
});

const GitHubAuthStatusSchema = Schema.Struct({
  hosts: Schema.Record(Schema.String, Schema.Array(GitHubAuthStatusAccountSchema)),
});

const decodeGitHubAuthStatusJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(GitHubAuthStatusSchema),
);

export interface GitHubAuthStatusAccount {
  readonly host: string;
  readonly account: string;
  readonly authenticated: boolean;
  readonly active: boolean;
  readonly error: string | null;
}

export interface GitHubAuthStatus {
  readonly parsed: boolean;
  readonly accounts: ReadonlyArray<GitHubAuthStatusAccount>;
}

const GitHubLoggedInAccountPattern = /Logged in to\s+(\S+)\s+account\s+([^\s(]+)/giu;

const GitHubUnauthenticatedPattern =
  /(?:not logged (?:in)?to any GitHub hosts|failed to log in to|authentication failed|token\b[^\r\n]*\bis invalid)/iu;

function nonEmptyString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseGitHubAuthStatusText(text: string): GitHubAuthStatus {
  const matches = Array.from(text.matchAll(GitHubLoggedInAccountPattern));
  if (matches.length === 0) {
    return {
      parsed: GitHubUnauthenticatedPattern.test(text),
      accounts: [],
    };
  }

  const accounts = matches.flatMap((match, index) => {
    const host = nonEmptyString(match[1] ?? "");
    const login = nonEmptyString(match[2] ?? "");
    if (host === null || login === null) return [];

    const blockStart = match.index ?? 0;
    const blockEnd = matches[index + 1]?.index ?? text.length;
    const block = text.slice(blockStart, blockEnd);
    const activeMatch = /Active account:\s*(true|false)/iu.exec(block);

    return [
      {
        host: host.toLowerCase(),
        account: login,
        authenticated: true,
        active:
          activeMatch?.[1]?.toLowerCase() === "true" ||
          (matches.length === 1 && activeMatch === null),
        error: null,
      },
    ];
  });

  return { parsed: true, accounts };
}

export function parseGitHubAuthStatus(text: string): GitHubAuthStatus {
  return Option.match(decodeGitHubAuthStatusJson(text), {
    onNone: () => parseGitHubAuthStatusText(text),
    onSome: (status) =>
      ({
        parsed: true,
        accounts: Object.values(status.hosts).flatMap((accounts) =>
          accounts.flatMap((account) => {
            const host = nonEmptyString(account.host);
            const login = nonEmptyString(account.login);
            if (host === null || login === null) return [];

            return [
              {
                host: host.toLowerCase(),
                account: login,
                authenticated: account.state === "success",
                active: account.active,
                error: account.error?.trim() || null,
              },
            ];
          }),
        ),
      }) satisfies GitHubAuthStatus,
  });
}

export function findAuthenticatedGitHubAccount(
  accounts: ReadonlyArray<GitHubAuthStatusAccount>,
): GitHubAuthStatusAccount | undefined {
  return (
    accounts.find((account) => account.authenticated && account.active) ??
    accounts.find((account) => account.authenticated)
  );
}
