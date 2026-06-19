export type WorkspaceType = "independent" | "agency" | "inhouse";

export interface Workspace {
  id: string;
  clerk_org_id: string;
  name: string;
  workspace_type: WorkspaceType | null;
  trial_ends_at: string | null;
  one_time_platform_credit_usd: number | null;
  one_time_platform_credit_spent_usd: number;
  monthly_spend_limit_usd: number | null;
  created_at: string;
}

export interface UserPreferences {
  workspace_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  company_website: string | null;
  email_signature: string | null;
  created_at: string;
  updated_at: string;
}

export interface Client {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  /** Hidden demo client backing the /demo page (kept out of normal lists). */
  is_demo: boolean;
  created_at: string;
}

export type ReportFrequency = "off" | "daily" | "weekly";

export interface Project {
  id: string;
  client_id: string;
  name: string;
  status: "active" | "archived";
  /** Hidden demo project backing the /demo page (kept out of normal lists). */
  is_demo: boolean;
  /** Slack channel this project posts to (id like C0123456789), or null. */
  slack_channel_id: string | null;
  /** Display name of that channel, e.g. proj-acme-devops (cosmetic). */
  slack_channel_name: string | null;
  /** Cadence of the automated Slack project report. */
  report_frequency: ReportFrequency;
  /** Last time the reporter posted, to avoid double-sends in a window. */
  report_last_sent_at: string | null;
  created_at: string;
}

export type DocScope = "workspace" | "client" | "project" | "prospect";
export type DocKind = "kb" | "file";
export type DocType = "jd" | "intake_notes" | "cv" | "scorecard" | "note" | "output" | "other";

export interface Doc {
  id: string;
  scope_type: DocScope;
  scope_id: string;
  workspace_id: string;
  kind: DocKind;
  doc_type: DocType | null;
  source: "upload" | "pasted" | "workflow" | "agent" | "url" | null;
  filename: string | null;
  storage_path: string | null;
  extracted_text: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface InputSpec {
  inputs: string[];
  /** doc_types that must exist as active project files before a run. */
  required_doc_types?: string[];
  /** doc_types the user picks as run inputs (e.g. ['cv']). Empty = no picker. */
  input_doc_types?: string[];
  /** Knowledge bases the prompt injects ('workspace', 'client') — drives the
   *  Knowledge group on the workflow canvas. */
  knowledge?: string[];
}

export interface OutputSpec {
  output: string;
  /** Display name of the produced document (workflow canvas output node). */
  name?: string;
}

export interface LibraryWorkflow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  prompt_template: string;
  input_spec: InputSpec;
  output_spec: OutputSpec;
  version: number;
  /** Highlighted on the public marketing homepage. */
  featured: boolean;
  /** Public marketing copy (see migration 0010). */
  og_description: string | null;
  lead: string | null;
  long_description: string | null;
}

export interface WorkspaceWorkflow {
  id: string;
  workspace_id: string;
  library_workflow_id: string | null;
  name: string;
  prompt_template: string;
  imported_version: number | null;
  /** Soft-delete: archived workflows keep their run history but leave the UI. */
  archived_at: string | null;
  created_at: string;
}

export interface AiProvider {
  id: string;
  workspace_id: string;
  provider: string;
  api_key_cipher: string | null;
  key_last4: string | null;
  default_model: string | null;
  priority: number;
  status: "unverified" | "valid" | "invalid";
  last_validated_at: string | null;
}

export interface CatalogModel {
  provider: string;
  model_id: string;
  display_name: string;
  context_window: number | null;
  pricing: { input?: number; output?: number; cache_read?: number } | null;
  curated: boolean;
}

export interface WorkflowRun {
  id: string;
  project_id: string;
  workspace_workflow_id: string;
  status: "running" | "succeeded" | "failed";
  input_doc_ids: string[] | null;
  input_text: string | null;
  output_doc_id: string | null;
  rendered_prompt: string | null;
  context_notes: string[] | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  fallback_used: boolean;
  model_response: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd: number | null;
  created_by: string | null;
  created_at: string;
}

// --- Activatable workspace modules (CRM / ATS / Target Talent Pool) ---

export type ModuleKey = "crm" | "ats" | "talent_pool";

/** Shared registry used by the Settings grid and the sidebar. */
export const MODULES: {
  key: ModuleKey;
  label: string;
  href: string;
  description: string;
}[] = [
  {
    key: "crm",
    label: "CRM",
    href: "/crm",
    description: "Track accounts and the leads connected to them.",
  },
  {
    key: "ats",
    label: "ATS",
    href: "/ats",
    description: "Manage candidates and associate them with project roles.",
  },
  {
    key: "talent_pool",
    label: "Target Talent Pool",
    href: "/talent-pool",
    description:
      "Build a niche prospect pipeline with skills, notes, and CVs.",
  },
];

export interface WorkspaceModule {
  id: string;
  workspace_id: string;
  module_key: ModuleKey;
  is_active: boolean;
  activated_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CrmAccount {
  id: string;
  workspace_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  status: "active" | "archived";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CrmLeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "won"
  | "lost";

export interface CrmLead {
  id: string;
  workspace_id: string;
  account_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  status: CrmLeadStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type AtsCandidateStatus =
  | "sourced"
  | "screening"
  | "interview"
  | "offer"
  | "hired"
  | "rejected";

export interface AtsCandidate {
  id: string;
  workspace_id: string;
  project_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  status: AtsCandidateStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface TalentProspect {
  id: string;
  workspace_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  linkedin_url: string | null;
  notes: string | null;
  profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Session {
  userId: string;
  workspaceId: string;
  role: "admin" | "member";
  workspace: Workspace;
}

// --- Data-source connectors ---

// "pending" = BYO-OAuth credentials saved but the OAuth round-trip hasn't
// completed yet (no tokens). Flips to "active" on a successful callback.
export type ConnectionStatus = "active" | "error" | "revoked" | "pending";

export interface Connection {
  id: string;
  workspace_id: string;
  provider: string;
  access_token_cipher: string | null;
  refresh_token_cipher: string | null;
  token_expires_at: string | null;
  account_label: string | null;
  scopes: string | null;
  status: ConnectionStatus;
  /** BYO-OAuth: the workspace's own OAuth app client_id (null = shared env app). */
  oauth_client_id: string | null;
  /** BYO-OAuth: the workspace's own OAuth app client_secret, encrypted. */
  oauth_client_secret_cipher: string | null;
  created_by: string | null;
  created_at: string;
}

// --- Dynamic data agents ---

export interface LibraryAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  allowed_tools: string[];
  model: string | null;
  max_steps: number;
  /** Where the agent belongs: "recruiting-project" (default) | "business-development". */
  context: string;
  version: number;
  /** Highlighted on the public marketing homepage. */
  featured: boolean;
  /** Short in-app task summary shown under the title on the run page (0014). */
  summary: string | null;
  /** Public marketing copy (see migration 0010). */
  og_description: string | null;
  lead: string | null;
  long_description: string | null;
}

export interface WorkspaceAgent {
  id: string;
  workspace_id: string;
  library_agent_id: string | null;
  name: string;
  instructions: string;
  allowed_tools: string[];
  model: string | null;
  max_steps: number;
  imported_version: number | null;
  /** Soft-delete: archived agents keep their run history but leave the UI. */
  archived_at: string | null;
  created_at: string;
}

/** One entry in an agent run's tool-call trace (stored in agent_runs.steps). */
export interface AgentRunStep {
  type: "tool-call" | "tool-result" | "tool-error";
  tool: string;
  summary: string;
}

export interface AgentRun {
  id: string;
  project_id: string;
  workspace_agent_id: string;
  /** Groups the turns of one chat; each turn is its own agent_runs row. */
  conversation_id: string | null;
  status: "running" | "succeeded" | "failed";
  task: string | null;
  steps: AgentRunStep[] | null;
  /** The assistant's reply text for this turn (for re-rendering + threading). */
  output_text: string | null;
  output_doc_id: string | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd: number | null;
  created_by: string | null;
  created_at: string;
  /** Set when a user archives the run (soft-hidden, kept for cost tracking). */
  archived_at: string | null;
}

/** One turn of a resumable agent chat (a slim agent_runs projection). */
export interface AgentChatTurn {
  id: string;
  task: string | null;
  output_text: string | null;
  steps: AgentRunStep[] | null;
  output_doc_id: string | null;
  status: "running" | "succeeded" | "failed";
  error_message: string | null;
  created_at: string;
}
