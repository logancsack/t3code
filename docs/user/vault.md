# The Vault in Aldo

**Settings → Vault** holds the secrets and website logins your cloud agents use. Values are encrypted when you save them and never shown again, here or to agents' tools. You can only replace or delete them.

## Secrets

Give a secret the name your code or tools look for, such as `STRIPE_SECRET_KEY`, `VERCEL_TOKEN` or `spring.datasource.password`. Any name works. Then choose how agents get it:

| Delivery               | Can agents read the value?   | Use it for                                                         |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------ |
| Variable               | Yes                          | Settings, and secrets a program needs in full, like a database URL |
| Injected into requests | No, they only see a stand-in | API keys and tokens sent in an HTTPS header                        |
| File                   | Yes                          | SSH keys, credential JSON files, config files                      |

### Variable

Every agent's shell commands and dev servers have the variable. New commands see a change right away; restart a running dev server to pick it up.

A shell can't hold a name with a dot or a dash, like `spring.datasource.password`. Dev servers and `aldo env` still get it.

### Injected into requests

List the sites that use the secret, such as `api.stripe.com` or `*.example.com`. Then give the header it goes in and the header's value, with `{value}` where the secret goes (for example `Authorization` and `Bearer {value}`). **Fill in for** sets these for common APIs.

Agents, and anything they run, see a stand-in in the variable: a made-up key of the same shape as yours (same prefix, such as `sk_live_`, and the same length), so tools that check a key's format still accept it. When a request to one of your sites carries that stand-in in that header, the cloud machine's network replaces it with your secret on the way out. The machine never holds the real value, so neither an agent nor a package it installs can read it or send it anywhere else. Requests that don't carry the stand-in are left alone.

This works for any program that reads the key from the variable and sends it in a header over HTTPS. It doesn't work for secrets used another way, such as database connection strings, SSH, keys in a URL, or requests a client signs itself (AWS, for example). Save those as a variable or a file.

`aldo env > .env.local` writes the stand-ins too, so an app that reads its keys from a `.env` file works the same way.

### File

The secret is written to the path you give, such as `~/.ssh/id_ed25519` or a full path. Only the agent's user can read it. Deleting the secret removes the file.

### Which threads get it

A secret goes to all threads, or only to threads on one repository. A repository's secret replaces an all-threads secret with the same name.

### Changing a secret

**Edit** changes how a secret is delivered, and its sites, header or path. Leave the value empty to keep the one you saved.

**Import .env** adds each line of a `.env` file as a variable. Switch API keys to **Injected into requests** afterwards to keep them out of agents' reach.

## Keeping secrets out of your repositories

Agents won't push commits, open pull requests, post comments or caption screenshots that contain one of your secret values. Dev server logs show `[vault: NAME]` in place of a value. If a flagged value isn't actually secret, an agent can push with `git push --no-verify`.

Agents can list what a thread has, and how each secret arrives, without seeing values (`aldo vault`).

## Your GitHub and Claude sign-ins

The accounts you connect for GitHub and Claude work like injected secrets. The cloud machine holds only stand-ins, and its network adds your real tokens to requests to GitHub and Anthropic. The in-app browser works on these sites as usual.

## Logins

A saved login is typed into the in-app browser for the agent, only on the exact site you saved it for. The agent never sees the password. For two-factor codes, the agent asks you in the conversation, or you can take over the browser.
