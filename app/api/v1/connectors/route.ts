import { NextResponse } from "next/server";
import {
  CONNECTORS,
  CONNECTOR_DOMAINS,
  connectorFaviconUrl,
} from "@/lib/connectors";
import { SUPPORTED_PROVIDERS, providerLabel } from "@/lib/ai-catalog";

// Public, unauthenticated catalog for the marketing site. Exposes only
// name/category/status plus the company's public domain and a brand-logo
// (favicon) URL — connection internals (provider ids, auth modes, API-key
// hints) stay out of the payload.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export interface PublicCatalogItem {
  name: string;
  category: "ai" | "ats" | "crm" | "data" | "email" | "comms" | "tool";
  status: "available" | "coming_soon";
  // Company's public web domain and a brand-logo URL derived from it. Omitted
  // when we don't have a domain on file (e.g. AI providers, "Local models").
  domain?: string;
  faviconUrl?: string;
}

export async function GET() {
  const ai: PublicCatalogItem[] = [
    // "calyflow" is the internal platform default, not a bring-your-own model.
    ...SUPPORTED_PROVIDERS.filter((p) => p !== "calyflow").map((p) => ({
      name: providerLabel(p),
      category: "ai" as const,
      status: "available" as const,
    })),
    { name: "Local models", category: "ai", status: "coming_soon" },
  ];
  const connectors: PublicCatalogItem[] = CONNECTORS.map((c) => {
    const domain = c.provider ? CONNECTOR_DOMAINS[c.provider] : undefined;
    return {
      name: c.name,
      category: c.category,
      status: c.live ? "available" : "coming_soon",
      ...(domain
        ? { domain, faviconUrl: connectorFaviconUrl(domain) }
        : {}),
    };
  });
  return NextResponse.json(
    { items: [...ai, ...connectors] },
    {
      headers: {
        ...CORS_HEADERS,
        // Catalog only changes on deploy; let CDNs/browsers cache it.
        "Cache-Control":
          "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}

// Next's auto-generated OPTIONS sends only an Allow header, no CORS.
export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
