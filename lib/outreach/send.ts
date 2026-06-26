import "server-only";
import { getConnection } from "../queries";
import { getValidAccessToken } from "../integrations";
import { gmailAdapter } from "../integrations/gmail";
import { microsoftOutlookAdapter } from "../integrations/microsoft-outlook";
import { connectorLabel } from "../connectors";
import { EMAIL_PROVIDERS, isEmailProvider, type EmailProvider } from "./select";

/** The active email-connector providers (gmail / microsoft-outlook) connected
 *  for a workspace — drives the Outreach mailbox banner / selector. */
export async function listConnectedEmailProviders(
  workspaceId: string,
): Promise<EmailProvider[]> {
  const out: EmailProvider[] = [];
  for (const provider of EMAIL_PROVIDERS) {
    const connection = await getConnection(workspaceId, provider);
    if (connection && connection.status === "active") out.push(provider);
  }
  return out;
}

export class NoMailboxError extends Error {
  constructor() {
    super(
      "No mailbox is connected. Connect Gmail or Microsoft Outlook in " +
        "Settings → Connectors to send outreach.",
    );
    this.name = "NoMailboxError";
  }
}

/** Resolve which mailbox to send from + a valid access token. Honors an explicit
 *  override (when both are connected); otherwise uses the one connected mailbox.
 *  Throws NoMailboxError when none is connected, or when the override isn't. */
export async function resolveEmailProvider(
  workspaceId: string,
  override?: string | null,
): Promise<{ provider: EmailProvider; token: string }> {
  const connected = await listConnectedEmailProviders(workspaceId);
  if (connected.length === 0) throw new NoMailboxError();

  let provider: EmailProvider;
  if (override && isEmailProvider(override)) {
    if (!connected.includes(override)) {
      throw new Error(
        `${connectorLabel(override)} is not connected. Connect it in Settings → Connectors.`,
      );
    }
    provider = override;
  } else {
    provider = connected[0];
  }

  const connection = await getConnection(workspaceId, provider);
  if (!connection) throw new NoMailboxError();
  const token = await getValidAccessToken(connection);
  return { provider, token };
}

/** Send one plain-text email via the resolved mailbox adapter. */
export async function sendEmailVia(
  provider: EmailProvider,
  token: string,
  args: { to: string; subject: string; body: string },
): Promise<{ id: string }> {
  if (provider === "gmail") return gmailAdapter.sendEmail(token, args);
  return microsoftOutlookAdapter.sendEmail(token, args);
}
