# Integrations in Aldo

**Settings → Integrations** connects accounts your agents use on your behalf: Google and Microsoft, for your mail, calendar, contacts and files, your Link wallet, for paying at checkouts with your approval each time, apps like Notion, Linear and Zapier, and media generators for images, video and audio. It's also where you claim your agents' own email address, and where **Files your agents shared** leads to every page and file they shared by link (see [The Library](./aldo-library.md)).

## Apps

**Apps** connects other apps every agent can use as you, through each app's own MCP server: **Zapier** (which reaches thousands more apps through the actions you turn on in Zapier), **Notion**, **Linear**, **Jira and Confluence**, **Airtable**, **Canva**, **Granola**, **Stripe**, **PayPal**, **Webflow**, **Supabase**, **Sentry** and **Hugging Face**. Choose **Connect** and sign in to the app in the window that opens; you choose there what Aldo may do. Any other app with a remote MCP server connects by its address under **Another app**: you're asked to confirm it first, since every agent will use its tools, so connect only an app you trust.

Aldo keeps the sign-in and refreshes it; no agent ever sees it. Every thread's agents get the app's tools when their machine next starts (an idle one restarts at once). An agent that needs an app you haven't connected sends you a link to connect it, and carries on once you have. You can also ask Aldo to connect one. If an app stops accepting the sign-in, its row says so: choose **Connect again**. **Disconnect** removes it from every agent.

## Image, video and audio

Connect **Runway**, **Higgsfield**, **Luma**, **fal**, **Replicate**, or **ElevenLabs** with your own API credentials. Choose **Connect** next to a provider, follow **Get a key** to its developer dashboard, and paste the complete copied key as-is. Higgsfield uses the key copied from [its API console](https://open.higgsfield.ai/api-keys); fal takes the complete key, including the colon.

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

## Link

Connecting your [Link](https://link.com) wallet (Stripe's) lets agents pay at a checkout with a card from it, and only with your approval each time. The row appears once your Aldo offers Link.

Choose **Connect Link**. Link's sign-in opens in a new window: sign in, review what Aldo asks for, and allow it. The window closes and the row shows the account you connected.

When you've asked an agent to buy something, it goes through the checkout up to the payment step, then asks Link for that store and total. Your devices get a notification that opens Link, where you see what it's for, the store and the total, and **approve or decline**. Nothing is paid until you approve, and the agent never approves for you.

Once you approve, Link gives a card that works **once**, for **up to the total you approved**, for a few hours. Aldo types it into the checkout itself, only on that store's site, so the card number stays out of the conversation; the agent sees its last four digits, checks the total and places the order. If the total changes, the agent cancels the payment and asks you again. Once the store charges it, it counts in what Home says agents spent this month.

Agents can have at most 3 payments waiting on your approval at once, and ask for at most 20 a day. When a task needs a card payment and Link isn't connected, agents ask you to connect it or to pay yourself; they never ask for your card number.

**Disconnect** cancels any payment still waiting on you and ends Aldo's access to your wallet, at Link too. If Link stops accepting the sign-in, the row says so: choose **Connect again**.

## Agent inbox

Your agents can have an email address of their own, apart from your mail: for signing up for things, getting sign-in codes and confirmation links, and writing to people when a task needs it. All your threads share it.

Under **Agent inbox**, type a handle. Your address is that handle at Aldo's mail domain, shown beside the field (for example `yourname@aldomail.com`). A handle is 3 to 30 letters, digits, dots, hyphens or underscores, starting and ending with a letter or digit; a few are reserved. The row says whether it's free as you type. Choose **Claim**, then **Claim it** to confirm. You can also ask Aldo to claim one for you, or tell an agent which handle you'd like.

**An address is yours for good: it can't be changed, released or handed to someone else.** Mail keeps arriving at an address long after you signed up with it (sign-in links, password resets), so an address that passed to someone else would bring them yours. Pick one you're happy to keep.

Once it's claimed, the row shows the address and **Copy address**. Threads that are already running can use it right away. As with your accounts above, a machine holds only a stand-in: the network puts the inbox's key in its place, and that key reaches this inbox alone. An agent waiting for a code or a reply asks Aldo to watch for it, and is told when it arrives. Agents treat what arrives as information, never as your instructions, and put anything that commits you (paying, booking, agreeing to terms) in front of you first. Mail whose sender failed authentication, or that was blocked as harmful, stays out of their sight.

Below the address, **Sender name** is what people see beside the address in mail your agents send: at first "Sam's agent", for someone named Sam. Type another (a business or project name for outreach, say) and choose **Save**: mail sent from then on, from every thread, carries it. Change it whenever you like; the address stays. A name is up to 64 characters, without `, ; : @ " \ ( ) < > [ ]`, which mail uses around addresses. You can also ask Aldo to rename it, or tell an agent the name you'd like.

### Reading your agents' mail

Choose **Open inbox** under **Agent inbox** to read what your agents received and sent, like a small mail app. **Inbox**, **Sent** and **Spam** switch folders. The search box searches senders, recipients, subjects and text across all of them, except spam. A conversation shows as one row. Pick it to read it whole: the message you picked opens, and the others fold into a line each that you can unfold. Replies hide the text they quote, and **Show quoted text** brings it back. On a phone, the list and the conversation take turns, and the back arrow returns to the list.

Images from the web stay hidden until you choose **Show images**, so senders don't learn the mail was opened. Images that came inside the mail itself show right away. Mail is shown in a sealed-off frame: its scripts don't run, its forms don't send, and its links open in a new tab.

Attachments open in a new tab. Before handing one over, Aldo reads it for values from your [Vault](./vault.md), looking inside documents, archives and PDFs too. If it holds one, or Aldo can't open it to check (it's encrypted, packed in a format Aldo doesn't read, or over 50 MB), the tab says so instead of showing it. In the mail itself, vault values show as `[vault: NAME]`. A very long message is cut short here, and says so; an agent can still read all of it.

Reading here changes nothing for your agents: mail they haven't dealt with stays unread for them. Mail whose sender failed authentication, or that was blocked as harmful, doesn't show here either. The page checks for new mail every few minutes while you're on it and when you come back to it; the refresh button at the top checks right away.
