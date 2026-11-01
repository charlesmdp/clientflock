# Mailbox drafts and the ClientFlock MCP

ClientFlock prepares editable drafts. It never sends email. The user reviews each draft and clicks **Send** in Gmail, Outlook, or another client connected to that mailbox, such as Spark.

Two delivery choices are available:

- **Now:** create the approved recipient, subject and message in the connected mailbox's Drafts folder.
- **Daily queue:** prepare queued drafts from tomorrow at 09:00 UTC, at most three per mailbox per UTC day. The Worker checks the queue hourly. Queue delivery does not generate new leads, send reminders, or send the messages. The Drafts folder is the review location.

If the immediate daily limit is reached, the draft moves to tomorrow's queue. The queue holds up to 30 items. Users can edit or cancel a queued item. Once it is created in the mailbox, they edit it in their mail application. Gmail users open Drafts in the account they connected. ClientFlock does not guess a browser account index such as `/u/0`; Outlook links are used only when the provider returns a validated message link.

## Cloudflare runtime configuration

Open **Workers & Pages → clientflock → Settings → Variables and secrets**. Use the runtime section, not the Build section.

| Name | Type | Value |
| --- | --- | --- |
| `APP_ORIGIN` | Variable | The production HTTPS origin, such as `https://clientflock.example`. No path or trailing query. |
| `MAIL_TOKEN_ENCRYPTION_KEY` | Secret | 32 random bytes encoded in standard Base64. Keep it stable; rotating it requires all connected mailboxes to reconnect. |
| `GMAIL_CLIENT_ID` | Variable | Google OAuth web application's client ID. |
| `GMAIL_CLIENT_SECRET` | Secret | That application's client secret. |
| `MICROSOFT_CLIENT_ID` | Variable | Microsoft Entra application's client ID. |
| `MICROSOFT_CLIENT_SECRET` | Secret | Microsoft client secret **value**, not its secret ID. |

You can configure one provider first. An unconfigured provider remains visibly unavailable. No provider password or OAuth token is placed in browser code. D1 tables are created by the server on first configured use.

To generate the encryption value entirely in your browser, open your browser developer console on Cloudflare and run:

```js
btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
```

Copy the result directly into the Cloudflare secret. Do not commit it or share it in chat.

The committed Worker configuration registers `0 * * * *`, which runs the queue check every hour in UTC. Alternatively, the same cron can be added through **Settings → Trigger events → Cron Triggers**. Do not create a duplicate trigger if it is already present. The Worker must export its `scheduled` handler calling `deliverDailyDrafts(env)`; adding a cron alone is not enough.

## Connect Gmail

1. In Google Cloud Console, select or create the application's project and enable **Gmail API**.
2. Configure the OAuth consent screen with your application name and production domain. During testing, add your own account to the test users.
3. Create an OAuth client of type **Web application**.
4. Add this authorized redirect URI, replacing the origin with `APP_ORIGIN`:
   `https://clientflock.example/api/mail/callback/gmail`
5. Save its client ID and secret in the Cloudflare runtime fields above, deploy, then use **Connect Gmail** in ClientFlock.

The requested Google scope is `https://www.googleapis.com/auth/gmail.compose`. Google groups draft management and sending into this scope. ClientFlock's implementation only calls the draft-creation endpoint; it exposes no sending endpoint or MCP send tool. Public production use of this restricted scope requires Google's applicable verification process. Testing-mode refresh tokens can expire; reconnect if required.

Official documentation:

- [Web server OAuth and offline access](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail scopes and verification](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Create a Gmail draft](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create)

## Connect Outlook or Microsoft 365

1. In Microsoft Entra admin center, open **App registrations → New registration**.
2. Choose the supported account audience for the users you intend to support. To support work, school and personal Outlook accounts, register that audience.
3. Add a **Web** redirect URI:
   `https://clientflock.example/api/mail/callback/outlook`
4. Add delegated Microsoft Graph permission **Mail.ReadWrite** and offline access. The application does not request `Mail.Send`.
5. Create a client secret. Copy its **value** into `MICROSOFT_CLIENT_SECRET`, and the application/client ID into `MICROSOFT_CLIENT_ID`.
6. Deploy and choose **Connect Outlook**. Some organizations require administrator consent for mailbox access.

Official documentation:

- [Microsoft authorization-code flow and PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Create a Microsoft Graph draft](https://learn.microsoft.com/en-us/graph/api/user-post-messages)

## Use the MCP from an assistant

After connecting a mailbox, use **Create MCP connection** in ClientFlock. It returns:

- Endpoint: `https://clientflock.example/mcp`
- A private bearer token shown once, valid for 30 days.

Use a compatible MCP client that supports Streamable HTTP and an `Authorization: Bearer …` header. This is a token-authenticated MCP service, not a universally installable OAuth connector. Clients that only support OAuth registration need a separate OAuth authorization layer before they can connect.

Creating another token revokes the previous token for that mailbox. Disconnecting the mailbox revokes its MCP tokens and cancels its remaining queue. Users can also revoke the application's access in Google or Microsoft account settings.

Available tools:

| Tool | Behavior |
| --- | --- |
| `list_drafts` | Lists only this mailbox's ClientFlock drafts. Does not read the inbox or other users' research. |
| `create_draft` | Creates a user-approved draft now, or queues it for a daily batch. Requires a stable idempotency key. |
| `edit_queued_draft` | Updates the user's queued draft before mailbox creation. |

There is no `send` tool. The tool description instructs the assistant to get approval for the recipient and message before creating the draft. An assistant's own scheduling feature can call the tools if configured separately; MCP itself is not a scheduler or email account connection.

## Using ClientFlock with Claude

Claude's current custom web connectors support fixed request headers, including bearer tokens. This provides a route to connect the existing draft-only MCP without adding a new OAuth layer to ClientFlock. This combination has not been tested with a live Claude account.

1. In ClientFlock, connect your mailbox and create or queue the draft you want to review. Expand **Connect through our MCP**, then click **Create my MCP connection**. Copy the generated **SERVER URL** and **BEARER TOKEN** from that panel. Use those exact values, not the example domain in this guide.
2. In Claude, open **Customize → Connectors → Add → Custom → Web**. Name the connector **ClientFlock**, paste the copied server URL and continue.
3. Choose **No sign in** for this fixed-token connection. Under **Request headers**, add the name `Authorization` with the value `Bearer ` followed by the copied token. Finish adding the connector. Keep the token private; do not paste it into a chat. For a personal mailbox, use a personal connector: fixed credentials in a Team or Enterprise connector may be shared with its users.
4. Enable ClientFlock in the conversation. Ask Claude to list your ClientFlock drafts and show the recipient, subject and full message before taking an action.
5. If you want Claude to send from Gmail, separately connect **Gmail** in Claude using the same intended sending account. Claude's Gmail connector supports sending with approval by default. Keep that approval requirement enabled, review the exact final message, and authorize each send explicitly. ClientFlock's MCP itself still cannot send.

ClientFlock's `list_drafts` returns its saved content. It does not synchronize subsequent edits made in Gmail, and a message sent by Claude's Gmail connector is not marked as sent in ClientFlock. Check the existing draft and Sent folder before sending, and do not resend the same content from the two interfaces. Adding the connector also does not create a daily reminder or a scheduled Claude task.

For a complete product flow, the recommended next implementation is a daily ClientFlock review card with **Approve & send**, **Edit** and **Skip**. Approval would bind to the exact mailbox, recipient and message version once, with duplicate-send protection. Sending would use the connected provider's OAuth API, and MCP could expose the same approval workflow to an assistant. This approval-and-send feature is not implemented; the current product prepares drafts only.

Official documentation:

- [Claude custom connectors and request headers](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities)
- [Claude Gmail connector and approval behavior](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors)
- [Send an existing Gmail draft](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send)
- [Send an Outlook draft and required Mail.Send permission](https://learn.microsoft.com/en-us/graph/api/message-send?view=graph-rest-1.0)

## Data and failure behavior

- A secure, HttpOnly browser cookie identifies the connected mailbox session. This initial version has no cross-device account login. Use the same browser, or reconnect on another device. Sessions last 90 days, MCP tokens 30 days.
- OAuth state is single-use, expires in ten minutes, is bound to the browser, and uses PKCE.
- OAuth refresh and access tokens are encrypted in D1 with AES-GCM. The encryption context binds them to the mailbox session.
- Every draft write has a durable idempotency record before the provider request. If the provider may have accepted a draft but the response is lost, the state becomes **Check your mailbox**. It is never retried automatically. Check Drafts before creating a new request.
- The three-per-day limit is atomic per mailbox session and counts attempted preparation conservatively. It is a ClientFlock product recommendation, not a guarantee about deliverability.
- Connecting a different account cancels previously queued drafts and revokes existing MCP tokens, so they are not silently delivered into the new mailbox.
- The current anonymous browser identity is a first-version capability boundary. An account-based login is needed for reliable cross-device recovery and a limit that cannot be reset by reconnecting from another browser.
- Live OAuth consent, real provider draft creation and unattended delivery still need an integration test with the configured production accounts. Unit tests use mocked provider responses and cannot certify those external settings.
