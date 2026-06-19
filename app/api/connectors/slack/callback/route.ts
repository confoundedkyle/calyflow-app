import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { decrypt, encrypt, verify } from "@/lib/crypto";
import { getAdapter } from "@/lib/integrations";
import { getConnection } from "@/lib/queries";
import { OAUTH_COOKIE } from "../start/route";

const PROVIDER = "slack";

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
    // Shared-app default; a workspace's own app (BYO fallback) is preferred when
    // present, exactly like the Vincere flow.
    const connection = await getConnection(session.workspaceId, PROVIDER);
    const clientId = connection?.oauth_client_id || env.slackClientId;
    const clientSecret = connection?.oauth_client_secret_cipher
      ? decrypt(connection.oauth_client_secret_cipher)
      : env.slackClientSecret || undefined;
    if (!clientId) {
      return clearCookie(
        NextResponse.redirect(settingsUrl(origin, "error=not_configured")),
      );
    }
    const tokens = await adapter.exchangeCode!({
      code,
      codeVerifier,
      redirectUri: redirectUri(request),
      app: { clientId, clientSecret },
    });
    await db()
      .from("workspace_connections")
      .upsert(
        {
          workspace_id: session.workspaceId,
          provider: PROVIDER,
          access_token_cipher: encrypt(tokens.accessToken),
          refresh_token_cipher: null,
          token_expires_at: tokens.expiresAt,
          account_label: tokens.accountLabel ?? null,
          scopes: tokens.scopes ?? null,
          oauth_client_id: connection?.oauth_client_id ?? null,
          oauth_client_secret_cipher:
            connection?.oauth_client_secret_cipher ?? null,
          status: "active",
          created_by: session.userId,
        },
        { onConflict: "workspace_id,provider" },
      );
    return clearCookie(
      NextResponse.redirect(settingsUrl(origin, "connected=slack")),
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
