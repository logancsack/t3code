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

Agents, and anything they run, see a stand-in in the variable. For an API key, it's a made-up key of the same shape as yours (the same marker, such as `sk_live_`, and the same length), so tools that check a key's format still accept it; nothing else of your key is in it. When a request to one of your sites carries that stand-in in that header, the cloud machine's network replaces it with your secret on the way out. The machine never holds the real value, so neither an agent nor a package it installs can read it or send it anywhere else. Requests that don't carry the stand-in are left alone.

This works for any program that reads the key from the variable and sends it in a header over HTTPS. It doesn't work for secrets used another way, such as database connection strings, SSH, keys in a URL, or requests a client signs itself (AWS, for example). Save those as a variable or a file.

`aldo env > .env.local` writes the stand-ins too, so an app that reads its keys from a `.env` file works the same way.

### File

The secret is written to the path you give, such as `~/.ssh/id_ed25519` or a full path. Only the agent's user can read it. Deleting the secret removes the file.

### Which threads get it

A secret goes to all threads, or only to threads on one repository. A repository's secret replaces an all-threads secret with the same name.

### When an agent asks for a secret

An agent that needs a secret it doesn't have (an API key, a token, a key file) sends you a link instead of asking you to paste it in the conversation. The link opens **Settings → Vault** with the secret's form filled in: its name, how agents get it, and its sites, path or repository. The agent's reason is shown above the form.

Paste the value there, not in the conversation, and choose **Save**. Injected into requests, the value never reaches the cloud machine and agents only see a stand-in; as a variable or a file it's on the machine, where agents can read it, as with any secret delivered that way. Once the secret is on the machine of the thread that asked, that thread gets a message that it's in place and carries on. **Cancel** declines the request, and the thread isn't told anything.

Only the form the agent asked for completes its request: saving a secret with another name, or for other threads, leaves the request open. Open the link again to answer it.

### When an agent saves a secret

An agent that gets a credential later threads will need too, such as an API key you gave it, a token it created, or a command-line tool's login (`vercel login`, for example), saves it to your vault itself, so no other thread has to sign in again. It saves it for all threads, or only for one of the thread's repositories, and tells you what it saved. **Settings → Vault** shows these as _saved by an agent_, with the thread's name.

An agent can't replace a secret you saved; it asks you instead. It can't move a saved value to other sites or paths without giving the value itself, and it can't save variables or files that change how programs start in every thread, such as `PATH`, `NODE_OPTIONS` or `~/.bashrc`. Save those yourself if you need them. Once you edit an agent's secret and save it here, it's yours.

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

### Saving a login when you sign in

When you sign in to a site yourself in a thread's browser (the Browser panel or the Desktop view), a pop-up over the page asks **Save this login to your Aldo vault?** once the sign-in has gone through, with the site and username. Save it for all threads or only one of the thread's repositories, and every thread's agent can then sign in there for you. If the site and username are saved with another password, it offers to update that login instead. It asks every time you sign in, except for a sign-in that failed, one the agent did, or a login that's already saved.

**Not now** dismisses it for this sign-in; the next one asks again. **Never for this site** stops asking for that site on every device and in every thread; the sites you chose are listed under **Logins** in **Settings → Vault**, where **Offer again** undoes it. The password stays on the cloud machine unless you choose **Save**.

The thread's Chrome doesn't run its own password manager, so it never offers to save a password itself or covers the page with a breach warning.

### Logins agents save

An agent that signs up for an account for you, or that you give a login to, can save it to your vault too. It's shown as _saved by an agent_. An agent can't replace a login you saved.
