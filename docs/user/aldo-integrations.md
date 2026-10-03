# Integrations in Aldo

**Settings → Integrations** connects accounts your cloud agents use on your behalf: Google and Microsoft, for your mail, calendar, contacts and files, and media generators for images, video and audio.

## Image, video and audio

Connect **Runway**, **Higgsfield**, **Luma**, **fal**, **Replicate**, or **ElevenLabs** with your own API credentials. Choose **Connect** next to a provider, follow **Get a key** to its developer dashboard, and paste the key. Higgsfield asks for the key ID and secret separately; fal takes the complete key, including the colon.

Aldo saves the key in your encrypted Vault and sends it only to that provider's API. Agents receive a stand-in and instructions for using the provider. Ask a thread to make an image, clip, voice, sound effect or music; the agent saves the result and shares the file. Running threads receive the key immediately; agents' instructions update once their current turn finishes.

Generation is billed by the provider, separately from Aldo. A website subscription may have separate credits from its API. Set the provider's spending or credit limit in its dashboard. Connecting never generates media or spends generation credits. Runway and Replicate keys are checked with an account read; other providers' access is checked when an agent first uses them.

Use **Replace key** to rotate credentials. **Disconnect** removes the key connected here from your Vault and running threads. Keys you saved for an individual repository remain available in that repository; manage those in the Vault. Revoking the key in the provider's dashboard also stops its use outside Aldo.

## Google

Connecting your Google account lets agents read your Gmail and draft replies, see what's on your calendar and add to it, look up your contacts, and open and save your Drive files, Docs, Sheets and Slides.

Choose **Connect Google account**. Google's sign-in opens in a new window: pick the account, review what Aldo asks for, and allow it. You can leave some of it unticked; the row then says what agents can use. The window closes and the row shows the account you connected.

## Microsoft

Connecting your Microsoft account lets agents read your Outlook mail and draft replies, see what's on your calendar and add to it, look up your contacts, and open and save your OneDrive files. With a work or school account they can also reach your SharePoint sites, and read and edit Excel workbooks stored there in place, calculated by Excel itself.

Choose **Connect work or school account** for an account your organization gives you, or **Connect personal account** for an Outlook.com, Hotmail or other personal Microsoft account. Microsoft's sign-in opens in a new window: sign in, review what Aldo asks for, and accept. The window closes and the row shows the account you connected.

Some organizations only let an administrator approve apps. If Microsoft says you need an admin's approval, ask your IT admin to approve Aldo for your organization, then connect again.

If you connected your Microsoft account before Aldo asked for mail and calendar, agents can still use your files. The row offers **Connect again** to add your mail, calendar and contacts.

## What agents get

Every thread's machine can use the accounts you connect, including threads that are already running, and [routines](./aldo-routines.md). Agents call Google's and Microsoft's APIs as you. Like an injected secret in the [Vault](./vault.md), the machine only holds a stand-in: the cloud machine's network puts your current access token in its place on requests to Google or Microsoft, so neither an agent nor anything it runs can read the token. Aldo keeps your sign-in and renews the token while your machines run.

In your mail and calendar, agents act as you, carefully:

- They read freely, but **draft** replies, new messages and invitations rather than send them, and leave accepting or declining to you, unless you asked them to send, or the routine they're running says to. A draft shows in your mail's Drafts, and the agent puts it in front of you to send with one tap (see [Approvals and heads-ups](./aldo-approvals.md)).
- They treat what an email says as information, never as your instructions.

Aldo also looks at your new mail and coming events every half hour of your day and gives you a heads-up about what's worth knowing; **Heads-ups from Aldo** here turns that off.

Agents know which accounts are connected. When a task needs your mail, calendar or files and none is connected, they ask you to connect one here.

## When it stops working

If Google or Microsoft stops accepting the sign-in (you changed your password, revoked Aldo's access, or an admin did), the row says so. Connect the account again, or disconnect it.

## Disconnecting

**Disconnect** removes the account from Aldo and from every machine at once. To also remove Aldo's access on the provider's side:

- Google: [myaccount.google.com/connections](https://myaccount.google.com/connections).
- Microsoft: [microsoft.com/consent](https://microsoft.com/consent) for a personal account, or **My Apps** for a work or school account.
