"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CONNECTORS,
  CONNECTOR_CATEGORY_LABELS,
  connectorInCategory,
  type ConnectorCategory,
} from "@/lib/connectors";
import {
  connectApiKeyAction,
  disconnectConnectionAction,
  saveOAuthAppAction,
} from "@/lib/actions/connectors";

type Filter = "all" | ConnectorCategory;

export interface ActiveConnection {
  provider: string;
  accountLabel: string | null;
  status: string;
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ats", label: "ATS" },
  { value: "crm", label: "CRM" },
  { value: "data", label: "Data" },
  { value: "email", label: "Email" },
  { value: "comms", label: "Comms" },
  { value: "tool", label: "Tools" },
];

const BADGE_STYLES: Record<ConnectorCategory, string> = {
  ats: "bg-mint-400/20 text-mint-700",
  crm: "bg-sky-300/25 text-navy-800/75",
  data: "bg-lavender-300/25 text-navy-800/75",
  email: "bg-coral-400/15 text-coral-400",
  comms: "bg-lavender-300/35 text-navy-800/75",
  tool: "bg-amber-400/15 text-amber-400",
};

const FILTER_VALUES = FILTERS.map((f) => f.value);

export function ConnectorsGrid({
  connections = [],
  canManage = false,
  initialFilter,
}: {
  connections?: ActiveConnection[];
  canManage?: boolean;
  /** Category from the URL (?category=ats) — deep links land pre-filtered. */
  initialFilter?: string;
}) {
  const [filter, setFilter] = useState<Filter>(
    FILTER_VALUES.includes(initialFilter as Filter)
      ? (initialFilter as Filter)
      : "all",
  );

  // Keep the URL shareable: clicking a filter rewrites ?category= in place
  // without a server round-trip.
  function selectFilter(value: Filter) {
    setFilter(value);
    const url = new URL(window.location.href);
    if (value === "all") url.searchParams.delete("category");
    else url.searchParams.set("category", value);
    window.history.replaceState(null, "", url);
  }
  const byProvider = useMemo(
    () => new Map(connections.map((c) => [c.provider, c])),
    [connections],
  );

  const visible = useMemo(
    () =>
      CONNECTORS.filter(
        (c) => filter === "all" || connectorInCategory(c, filter),
      ).sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    [filter],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => selectFilter(f.value)}
            className={[
              "rounded-chip px-4 py-1.5 text-sm font-semibold transition",
              filter === f.value
                ? "bg-mint-400 text-navy-800"
                : "border border-navy-800/20 text-navy-800/60 hover:border-navy-800/45 hover:text-navy-900",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((connector) => (
          <div
            key={connector.name}
            className="flex flex-col rounded-card border border-navy-800/12 bg-white p-5"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold">{connector.name}</h3>
              <span
                className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE_STYLES[connector.category]}`}
              >
                {CONNECTOR_CATEGORY_LABELS[connector.category]}
              </span>
            </div>
            <p className="flex-1 text-sm text-navy-800/55">{connector.blurb}</p>
            <ConnectorFooter
              connector={connector}
              connection={
                connector.provider
                  ? byProvider.get(connector.provider)
                  : undefined
              }
              canManage={canManage}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectorFooter({
  connector,
  connection,
  canManage,
}: {
  connector: (typeof CONNECTORS)[number];
  connection?: ActiveConnection;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (!connector.live || !connector.provider) {
    return (
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="cursor-not-allowed rounded-chip border border-navy-800/15 bg-cream-100 px-4 py-1.5 text-sm font-semibold text-navy-800/35"
        >
          Activate
        </button>
        <span className="text-xs text-navy-800/35">Coming soon</span>
      </div>
    );
  }

  // A 'pending' BYO connection has saved app credentials but hasn't completed
  // the OAuth round-trip yet — treat it as not-yet-connected.
  if (connection && connection.status !== "pending") {
    const errored = connection.status === "error";
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-chip px-3 py-1.5 text-sm font-semibold ${
            errored
              ? "bg-coral-400/15 text-coral-400"
              : "bg-mint-400/20 text-mint-700"
          }`}
        >
          {errored ? "⚠ Needs reconnect" : "✓ Connected"}
        </span>
        {connection.accountLabel && !errored && (
          <span className="text-xs text-navy-800/45">
            {connection.accountLabel}
          </span>
        )}
        {errored && connector.auth !== "apikey" && (
          <a
            href={`/api/connectors/${connector.provider}/start`}
            className="rounded-chip border border-navy-800/20 px-3 py-1.5 text-sm font-semibold text-navy-800/70 transition hover:border-mint-700 hover:text-mint-700"
          >
            Reconnect
          </a>
        )}
        {canManage && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                disconnectConnectionAction(connector.provider!),
              )
            }
            className="ml-auto inline-flex items-center gap-1.5 rounded-chip border border-navy-800/15 px-3 py-1.5 text-sm font-medium text-navy-800/55 transition hover:border-coral-400/60 hover:bg-coral-400/10 hover:text-coral-400 disabled:opacity-40 disabled:hover:border-navy-800/15 disabled:hover:bg-transparent disabled:hover:text-navy-800/55"
          >
            <span aria-hidden>⏏</span>
            {pending ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="mt-4">
        <span className="text-xs text-navy-800/40">
          Ask a workspace admin to connect this.
        </span>
      </div>
    );
  }

  if (connector.auth === "apikey") {
    return (
      <ApiKeyConnect
        provider={connector.provider}
        placeholder={connector.apiKeyPlaceholder}
        hint={connector.apiKeyHint}
      />
    );
  }

  if (connector.byoOAuth) {
    return (
      <OAuthAppConnect
        provider={connector.provider}
        hint={connector.oauthAppHint}
        pending={connection?.status === "pending"}
      />
    );
  }

  return (
    <div className="mt-4 flex items-center gap-2">
      <a
        href={`/api/connectors/${connector.provider}/start`}
        className="rounded-chip bg-mint-400 px-4 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-mint-400/85"
      >
        Connect
      </a>
    </div>
  );
}

/** BYO-OAuth connect flow: the workspace registers its own OAuth app, pastes
 *  the client_id (+ optional secret), then runs the OAuth round-trip. */
function OAuthAppConnect({
  provider,
  hint,
  pending,
}: {
  provider: string;
  hint?: string;
  /** App credentials already saved; the OAuth round-trip just needs running. */
  pending?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startTransition] = useTransition();

  const startUrl = `/api/connectors/${provider}/start`;
  // The redirect URI to register in the provider must match this origin exactly.
  const redirectUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/connectors/${provider}/callback`
      : `/api/connectors/${provider}/callback`;

  // Credentials saved but not yet connected: offer to finish, or re-enter.
  if (pending && !editing) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={startUrl}
          className="rounded-chip bg-mint-400 px-4 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-mint-400/85"
        >
          Connect
        </a>
        <span className="text-xs text-navy-800/45">credentials saved</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-xs text-navy-800/45 underline transition hover:text-navy-800"
        >
          Re-enter credentials
        </button>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-chip bg-mint-400 px-4 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-mint-400/85"
        >
          Connect
        </button>
        <span className="text-xs text-navy-800/35">with your OAuth app</span>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <label className="mb-1 block text-xs font-medium text-navy-800/55">
        Redirect URI — register this in {provider}
      </label>
      <code className="mb-3 block overflow-x-auto rounded-chip border border-navy-800/15 bg-cream-100 px-3 py-1.5 text-xs text-navy-800/70">
        {redirectUri}
      </code>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={clientId}
          autoFocus
          disabled={pendingSave}
          placeholder="Client ID"
          onChange={(e) => setClientId(e.target.value)}
          className="rounded-chip border border-navy-800/20 bg-white px-3 py-1.5 text-sm outline-none focus:border-mint-700"
        />
        <input
          type="password"
          value={clientSecret}
          disabled={pendingSave}
          placeholder="Client Secret (optional)"
          onChange={(e) => setClientSecret(e.target.value)}
          className="rounded-chip border border-navy-800/20 bg-white px-3 py-1.5 text-sm outline-none focus:border-mint-700"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pendingSave || !clientId.trim()}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await saveOAuthAppAction(
                  provider,
                  clientId,
                  clientSecret,
                );
                if (res.ok) {
                  // Hand off to the OAuth round-trip immediately.
                  window.location.href = startUrl;
                } else {
                  setError(res.error ?? "Could not save credentials");
                }
              })
            }
            className="rounded-chip bg-mint-400 px-4 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-mint-400/85 disabled:opacity-40"
          >
            {pendingSave ? "Connecting…" : "Save & Connect"}
          </button>
          <button
            type="button"
            disabled={pendingSave}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            className="rounded-chip px-2 py-1.5 text-sm text-navy-800/45 transition hover:text-navy-800"
          >
            Cancel
          </button>
        </div>
      </div>
      {hint && <p className="mt-2 text-xs text-navy-800/45">{hint}</p>}
      {error && <p className="mt-2 text-sm text-coral-400">{error}</p>}
    </div>
  );
}

function ApiKeyConnect({
  provider,
  placeholder,
  hint,
}: {
  provider: string;
  placeholder?: string;
  hint?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-chip bg-mint-400 px-4 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-mint-400/85"
        >
          Connect
        </button>
        <span className="text-xs text-navy-800/35">with API key</span>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={key}
          autoFocus
          disabled={pending}
          placeholder={placeholder ?? "Paste API key"}
          onChange={(e) => setKey(e.target.value)}
          className="min-w-44 flex-1 rounded-chip border border-navy-800/20 bg-white px-3 py-1.5 text-sm outline-none focus:border-mint-700"
        />
        <button
          type="button"
          disabled={pending || !key.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await connectApiKeyAction(provider, key);
              if (res.ok) {
                setKey("");
                setOpen(false);
                router.refresh();
              } else {
                setError(res.error ?? "Could not connect");
              }
            })
          }
          className="rounded-chip bg-mint-400 px-4 py-1.5 text-sm font-semibold text-navy-800 transition hover:bg-mint-400/85 disabled:opacity-40"
        >
          {pending ? "Connecting…" : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-chip px-2 py-1.5 text-sm text-navy-800/45 transition hover:text-navy-800"
        >
          Cancel
        </button>
      </div>
      {hint && <p className="mt-2 text-xs text-navy-800/45">{hint}</p>}
      {error && <p className="mt-2 text-sm text-coral-400">{error}</p>}
    </div>
  );
}
