# Integrations in Aldo

**Settings → Integrations** connects accounts your cloud agents use on your behalf. Microsoft is the first.

## Microsoft

Connecting your Microsoft account lets agents open and save your OneDrive files. With a work or school account they can also reach your SharePoint sites, and read and edit Excel workbooks stored there in place, calculated by Excel itself.

Choose **Connect work or school account** for an account your organization gives you, or **Connect personal account** for an Outlook.com, Hotmail or other personal Microsoft account. Microsoft's sign-in opens in a new window: sign in, review what Aldo asks for, and accept. The window closes and the row shows the account you connected.

Some organizations only let an administrator approve apps. If Microsoft says you need an admin's approval, ask your IT admin to approve Aldo for your organization, then connect again.

### What agents get

Every thread's machine can use the account, including threads that are already running. Agents call Microsoft Graph, Microsoft's API for OneDrive and SharePoint, as you. Like an injected secret in the [Vault](./vault.md), the machine only holds a stand-in: the cloud machine's network puts your current access token in its place on requests to Microsoft, so neither an agent nor anything it runs can read the token. Aldo keeps your sign-in and renews the token while your machines run.

Agents know which account is connected. When a task needs your files and no account is connected, they ask you to connect one here.

### When it stops working

If Microsoft stops accepting the sign-in (you changed your password, revoked Aldo's access, or an admin did), the row says so. Connect the account again, or disconnect it.

### Disconnecting

**Disconnect** removes the account from Aldo and from every machine at once. To also remove Aldo's access on Microsoft's side, open [microsoft.com/consent](https://microsoft.com/consent) for a personal account, or **My Apps** for a work or school account, and remove Aldo there.
