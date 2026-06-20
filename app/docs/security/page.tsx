import type { Metadata } from "next";
import { DocHeader, Markdown } from "@/components/docs/doc-blocks";

export const metadata: Metadata = {
  title: "Security & privacy",
  description:
    "How Calyflow keeps your data and credentials safe: encryption, workspace isolation, your own keys, and an open, self-hostable codebase.",
};

const BODY = `
Calyflow is built to handle the sensitive things recruiting touches —
candidate data, client details, and the API keys to your tools — with care. Here's
how your data and credentials are protected.

## Your credentials are encrypted

Every connector credential you add — API keys, OAuth tokens, and any OAuth client
secrets — is **encrypted at rest** using **AES-256-GCM**, the same
industry-standard encryption used to protect sensitive data across the web. The
encryption key is kept **separately from the database** (in a secrets manager),
so the stored data is useless on its own.

You can **disconnect any connector at any time**, which removes its stored
credentials.

## Your credentials never reach the AI

When an agent uses a connector, the API call is made by **Calyflow's servers** on
your behalf. Your keys and tokens are **never placed into prompts and never shown
to the AI model** — the agent only ever sees the results it asked for, not the
credentials behind them.

## Your data stays in your workspace

- **Workspace isolation.** Every piece of data — clients, projects, documents,
  knowledge base, synced records — belongs to a single workspace, and every read
  is scoped to *your* workspace on the server. One customer can never see
  another's data.
- **Defence in depth.** Isolation is enforced both in the application and at the
  database layer.
- **Your own AI and tools.** Runs use **your** AI provider and **your** connected
  accounts. The work — and the spend — stays in your accounts.

## Least access by default

- Most connectors are used **read-only** — Calyflow pulls the records a task needs
  and **doesn't write back** to your ATS, CRM, or spreadsheets.
- You grant only the access a connector needs (a scoped API key, or an OAuth
  approval limited to what the integration uses).
- Email connectors send **only** the messages an agent drafts for a run, from the
  mailbox you choose.

## Protected in transit

All traffic is served over **HTTPS**, with strict security headers — including
**HSTS**, a **content security policy**, and **clickjacking protection** — applied
across the app.

## Sign-in you can trust

Authentication is handled by **Clerk**, a specialist authentication provider, so
established protections such as **single sign-on (SSO)** and **multi-factor
authentication (MFA)** are available. Inbound integration requests (such as
Slack) are **cryptographically verified** before they're accepted.

## Open source — and yours to run

Calyflow is **open source (AGPL-3.0)**. That means:

- **You can audit it.** The code is public — security teams can review exactly how
  data and credentials are handled.
- **You can self-host it.** Run your own Calyflow instance in your own
  infrastructure, so candidate data and credentials never leave your environment.
  See [Self-hosting & OAuth apps](/docs/self-hosting).

## You're in control

You decide what to connect, what to upload, and what agents can see. You can
disconnect a tool, deactivate or delete documents, and remove data at any time.

> Have a security question, or want to report something? Email
> **hello@calyflow.ai** — we take it seriously.
`;

export default function SecurityPage() {
  return (
    <article>
      <DocHeader
        eyebrow="Trust"
        title="Security & privacy"
        lead="Candidate data, client details, and your API keys — handled with care. Here's how your data and credentials are protected."
      />
      <Markdown>{BODY}</Markdown>
    </article>
  );
}
