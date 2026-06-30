import "server-only";
import { contactoutAdapter } from "../integrations/contactout";
import { prospeoAdapter } from "../integrations/prospeo";
import { nymeriaAdapter } from "../integrations/nymeria";
import { signalhireAdapter } from "../integrations/signalhire";

// One-click email enrichment for the Shortlist "Find email" button: given a
// candidate's LinkedIn URL and a connected enrichment provider, resolve an
// email synchronously. Each adapter renders its result as Markdown text with the
// email inline; we pull the first email out of it. Only the providers in
// LIVE_EMAIL_ENRICHMENT_PROVIDERS (lib/connectors.ts) are wired here — the rest
// of the catalog's email finders are covered by the CSV round-trip instead.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Pull the first email address out of an adapter's Markdown result text. */
export function extractEmail(text: string): string | null {
  const m = text.match(EMAIL_RE);
  return m ? m[0] : null;
}

export interface FindEmailResult {
  email: string | null;
  /** The adapter's full text — kept on the candidate's raw payload for audit. */
  detail: string;
}

/** Resolve an email for a LinkedIn URL via a specific live-enrichment provider.
 *  Throws on provider/auth errors (the caller turns it into a user message). */
export async function findEmailViaProvider(
  provider: string,
  token: string,
  linkedinUrl: string,
): Promise<FindEmailResult> {
  switch (provider) {
    case "contactout": {
      const r = await contactoutAdapter.linkedinEnrich(token, {
        profileUrl: linkedinUrl,
      });
      return { email: extractEmail(r.text), detail: r.text };
    }
    case "prospeo": {
      const r = await prospeoAdapter.enrichPerson(token, { linkedinUrl });
      return { email: extractEmail(r.text), detail: r.text };
    }
    case "nymeria": {
      const r = await nymeriaAdapter.enrichPerson(token, { linkedinUrl });
      return { email: extractEmail(r.text), detail: r.text };
    }
    case "signalhire": {
      // SignalHire takes a single identifier (LinkedIn URL works) and returns
      // synchronously thanks to the adapter's withoutWaterfall flag.
      const r = await signalhireAdapter.enrichPerson(token, {
        identifier: linkedinUrl,
      });
      return { email: extractEmail(r.text), detail: r.text };
    }
    default:
      return {
        email: null,
        detail: `${provider} does not support one-click email lookup.`,
      };
  }
}
