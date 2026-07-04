import "server-only";
import { cookies } from "next/headers";
import { env } from "../env";
import { verify } from "../crypto";
import { ensureWorkspace } from "../workspace";
import type { Session } from "../types";

// The ONLY module (plus components/auth-ui.tsx for prebuilt widgets) that
// touches Clerk. Everything else calls getSession()/requireSession() —
// SPEC §13: auth behind a thin server-side wrapper.

export const SINGLE_WORKSPACE_ORG_ID = "single-workspace";
export const SESSION_COOKIE = "calyflow_session";

export async function getSession(): Promise<Session | null> {
  return env.singleWorkspace ? getSingleWorkspaceSession() : getClerkSession();
}

/** Throws if unauthenticated — use in server actions and route handlers. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return session;
}

/** Admin ("Owner") gate for settings mutations — enforced server-side. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.role !== "admin") {
    throw new Error("Only the workspace owner can do this");
  }
  return session;
}

/**
 * PLATFORM admin (the /admin dashboard) — distinct from the per-workspace
 * "Owner" role above. Gated on the Clerk user's private metadata `role:"admin"`.
 * In single-workspace mode (no Clerk) it falls back to the ADMIN_EMAILS allowlist.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  if (env.singleWorkspace) {
    const admins = env.adminEmails;
    return admins.length === 0 || admins.includes(session.userId.toLowerCase());
  }
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const user = await client.users.getUser(session.userId);
  return (user.privateMetadata as { role?: string } | null)?.role === "admin";
}

/**
 * Renames the backing Clerk organization so the org name shown in Clerk's
 * widgets (OrganizationSwitcher) stays in sync with the workspace name.
 * No-op in single-workspace mode (no Clerk org).
 */
export async function syncClerkOrgName(
  clerkOrgId: string,
  name: string,
): Promise<void> {
  if (env.singleWorkspace || clerkOrgId === SINGLE_WORKSPACE_ORG_ID) return;
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  await client.organizations.updateOrganization(clerkOrgId, { name });
}

/**
 * The first/last name on the Clerk user record (the source of truth for a
 * person's name). Returns nulls in single-workspace mode (no Clerk user) — the
 * caller falls back to the value mirrored in user_preferences.
 */
export async function getClerkUserName(
  userId: string,
): Promise<{ firstName: string | null; lastName: string | null }> {
  if (env.singleWorkspace) return { firstName: null, lastName: null };
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return { firstName: user.firstName, lastName: user.lastName };
}

/**
 * Writes the user's name back to Clerk so it stays in sync with everything that
 * reads from Clerk (UserButton, emails). No-op in single-workspace mode, where
 * the name lives only in user_preferences.
 */
export async function syncClerkUserName(
  userId: string,
  firstName: string,
  lastName: string,
): Promise<void> {
  if (env.singleWorkspace) return;
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  await client.users.updateUser(userId, { firstName, lastName });
}

async function getClerkSession(): Promise<Session | null> {
  const { auth, clerkClient } = await import("@clerk/nextjs/server");
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return null;

  let clerkOrgId = orgId ?? null;
  let role: Session["role"] =
    orgRole === "org:admin" ? "admin" : orgId ? "member" : "admin";

  // The org name the user set in Clerk (auto-created or typed when creating a
  // new org) becomes the workspace name so onboarding prefills it. Resolved
  // lazily — only when the workspace row is first created.
  let resolveName: string | (() => Promise<string>) = async () => {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: clerkOrgId!,
    });
    return org.name || "Default workspace";
  };

  if (!clerkOrgId) {
    // No active org in the session token (the app doesn't force one): resolve
    // the user's org from their memberships. This MUST be deterministic — Clerk
    // gives no ordering guarantee for the membership list, so `data[0]` can
    // return a *different* org between two requests seconds apart. When it does,
    // `session.workspaceId` flips and a resource just created under workspace A
    // becomes invisible under workspace B ("Client not found" 500), self-healing
    // only on reload. Pin to the user's first-joined org (their primary
    // workspace) by sorting on membership createdAt, and pull a full page so a
    // paginated default can't hide the primary org.
    const client = await clerkClient();
    const memberships = await client.users.getOrganizationMembershipList({
      userId,
      limit: 100,
    });
    const first = [...memberships.data].sort(
      (a, b) => a.createdAt - b.createdAt,
    )[0];
    if (first) {
      clerkOrgId = first.organization.id;
      role = first.role === "org:admin" ? "admin" : "member";
      resolveName = first.organization.name || "Default workspace";
    } else {
      const org = await client.organizations.createOrganization({
        name: "Default workspace",
        createdBy: userId,
      });
      clerkOrgId = org.id;
      role = "admin";
      resolveName = org.name || "Default workspace";
    }
  }

  const workspace = await ensureWorkspace(clerkOrgId, resolveName);
  return { userId, workspaceId: workspace.id, role, workspace };
}

async function getSingleWorkspaceSession(): Promise<Session | null> {
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  const email = verify(cookie)?.toLowerCase();
  if (!email) return null;

  const admins = env.adminEmails;
  const role: Session["role"] =
    admins.length === 0 || admins.includes(email) ? "admin" : "member";
  const workspace = await ensureWorkspace(
    SINGLE_WORKSPACE_ORG_ID,
    "Default workspace",
  );
  return { userId: email, workspaceId: workspace.id, role, workspace };
}
