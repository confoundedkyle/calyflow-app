import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { encrypt, verify } from "@/lib/crypto";
import { getAdapter } from "@/lib/integrations";
import { getPostHogClient } from "@/lib/posthog-server";
import { OAUTH_COOKIE } from "../start/route";

const PROVIDER = "gmail";

function settingsUrl(origin: string, params: string): URL {
  return new URL(`/settings/connectors?${params}`, origin);
}

function redirectUri(request: NextRequest): string {
  const base = env.appBaseUrl || request.nextUrl.origin;
  return `${base}/api/connectors/${PROVIDER}/callback`;
}

export async function GET(request: NextRequest) {
  const origin = env.appBaseUrl || request.nextUrl.origin;
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/sign-in", origin));
  }

  const jar = await cookies();
  const clearCookie = (res: NextResponse) => {
    res.cookies.set(OAUTH_COOKIE, "", {
      path: `/api/connectors/${PROVIDER}`,
      maxAge: 0,
    });
    return res;
  };

  const url = request.nextUrl;
  const error = url.searchParams.get("error");
  if (error) {
    return clearCookie(
      NextResponse.redirect(settingsUrl(origin, `error=${encodeURIComponent(error)}`)),
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const signed = jar.get(OAUTH_COOKIE)?.value;
  const unsigned = signed ? verify(signed) : null;
  if (!code || !state || !unsigned) {
    return clearCookie(NextResponse.redirect(settingsUrl(origin, "error=bad_state")));
  }
  const [expectedState, codeVerifier] = unsigned.split(":");
  if (state !== expectedState || !codeVerifier) {
    return clearCookie(NextResponse.redirect(settingsUrl(origin, "error=bad_state")));
  }

  const adapter = getAdapter(PROVIDER)!;
  try {
    const tokens = await adapter.exchangeCode!({
      code,
      codeVerifier,
      redirectUri: redirectUri(request),
    });
    await db()
      .from("workspace_connections")
      .upsert(
        {
          workspace_id: session.workspaceId,
          provider: PROVIDER,
          access_token_cipher: encrypt(tokens.accessToken),
          refresh_token_cipher: tokens.refreshToken
            ? encrypt(tokens.refreshToken)
            : null,
          token_expires_at: tokens.expiresAt,
          account_label: tokens.accountLabel ?? null,
          scopes: tokens.scopes ?? null,
          status: "active",
          created_by: session.userId,
        },
        { onConflict: "workspace_id,provider" },
      );
    getPostHogClient().capture({
      distinctId: session.userId,
      event: "connector_connected",
      properties: {
        provider: PROVIDER,
        workspace_id: session.workspaceId,
        has_account_label: !!tokens.accountLabel,
      },
    });
    return clearCookie(
      NextResponse.redirect(settingsUrl(origin, "connected=gmail")),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "exchange_failed";
    return clearCookie(
      NextResponse.redirect(
        settingsUrl(origin, `error=${encodeURIComponent(message.slice(0, 120))}`),
      ),
    );
  }
}
