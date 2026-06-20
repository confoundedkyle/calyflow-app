import "server-only";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "../db";
import { listDocuments, getDocument } from "../queries";
import { airtableAdapter } from "../integrations/airtable";
import { apolloAdapter } from "../integrations/apollo";
import { ashbyAdapter } from "../integrations/ashby";
import { attioAdapter } from "../integrations/attio";
import { avomaAdapter } from "../integrations/avoma";
import { bamboohrAdapter } from "../integrations/bamboohr";
import { breezyhrAdapter } from "../integrations/breezyhr";
import { brightdataAdapter } from "../integrations/brightdata";
import { bullhornAdapter } from "../integrations/bullhorn";
import { catsAdapter } from "../integrations/cats";
import { closeAdapter } from "../integrations/close";
import { contactoutAdapter } from "../integrations/contactout";
import { coresignalAdapter } from "../integrations/coresignal";
import { crelateAdapter } from "../integrations/crelate";
import { dropcontactAdapter } from "../integrations/dropcontact";
import { fathomAdapter } from "../integrations/fathom";
import { findymailAdapter } from "../integrations/findymail";
import { firefliesAdapter } from "../integrations/fireflies";
import { folkAdapter } from "../integrations/folk";
import { fullenrichAdapter } from "../integrations/fullenrich";
import { githubAdapter } from "../integrations/github";
import { firecrawlScrape, firecrawlSearch } from "../integrations/firecrawl";
import { gmailAdapter } from "../integrations/gmail";
import { gongAdapter } from "../integrations/gong";
import { googleSheetsAdapter } from "../integrations/google-sheets";
import { grainAdapter } from "../integrations/grain";
import { greenhouseAdapter } from "../integrations/greenhouse";
import { hubspotAdapter } from "../integrations/hubspot";
import { hunterAdapter } from "../integrations/hunter";
import { instantlyAdapter } from "../integrations/instantly";
import { jazzhrAdapter } from "../integrations/jazzhr";
import { jobadderAdapter } from "../integrations/jobadder";
import { lemlistAdapter } from "../integrations/lemlist";
import { leverAdapter } from "../integrations/lever";
import { loxoAdapter } from "../integrations/loxo";
import { lushaAdapter } from "../integrations/lusha";
import { manatalAdapter } from "../integrations/manatal";
import { microsoftExcelAdapter } from "../integrations/microsoft-excel";
import { microsoftOutlookAdapter } from "../integrations/microsoft-outlook";
import { mondayAdapter } from "../integrations/monday";
import { notionAdapter } from "../integrations/notion";
import { peopledatalabsAdapter } from "../integrations/peopledatalabs";
import { pinpointAdapter } from "../integrations/pinpoint";
import { pipedriveAdapter } from "../integrations/pipedrive";
import { recruiteeAdapter } from "../integrations/recruitee";
import { recruiterflowAdapter } from "../integrations/recruiterflow";
import { recruitisAdapter } from "../integrations/recruitis";
import { replyioAdapter } from "../integrations/replyio";
import { rocketreachAdapter } from "../integrations/rocketreach";
import { signalhireAdapter } from "../integrations/signalhire";
import { slackAdapter } from "../integrations/slack";
import { smartleadAdapter } from "../integrations/smartlead";
import { smartrecruitersAdapter } from "../integrations/smartrecruiters";
import { snovAdapter } from "../integrations/snov";
import { teamtailorAdapter } from "../integrations/teamtailor";
import { tldvAdapter } from "../integrations/tldv";
import { vincereAdapter } from "../integrations/vincere";
import { wizaAdapter } from "../integrations/wiza";
import { woodpeckerAdapter } from "../integrations/woodpecker";
import { workableAdapter } from "../integrations/workable";
import { zohoCrmAdapter } from "../integrations/zoho-crm";
import { zohoRecruitAdapter } from "../integrations/zoho-recruit";
import { zoomAdapter } from "../integrations/zoom";
import type { ConnectorTokens } from "./connector-tokens";
import type { Doc } from "../types";

// Agent tools. Each tool's execute closes over a server-derived ToolContext —
// scope (workspace/project) is NEVER taken from model-provided arguments, so a
// prompt-injected agent can't reach another workspace's data.

export interface ToolContext extends ConnectorTokens {
  workspaceId: string;
  projectId: string;
  clientId: string;
  userId: string;
  /** Firecrawl key for the web_* tools — platform env var, not a connection. */
  firecrawlKey: string | null;
  /** Documents the agent created this run (mutated by calyflow_create_document). */
  createdDocIds: string[];
}

const READ_DOC_CHAR_CAP = 8_000;
const notConnected = (name: string) =>
  `${name} is not connected for this workspace. Ask an admin to connect it in Settings → Connectors.`;

function snippet(text: string, query: string): string {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  const start = Math.max(0, i - 80);
  return text.slice(start, start + 240).replace(/\s+/g, " ").trim();
}

function buildAll(ctx: ToolContext): ToolSet {
  return {
    calyflow_search_documents: tool({
      description:
        "Search the project's knowledge base (workspace, client and project documents) for text matching a query. Returns matching documents with id and a snippet. Use this to ground your work before querying external sources.",
      inputSchema: z.object({
        query: z.string().describe("Keywords or phrase to search for."),
      }),
      execute: async ({ query }) => {
        const [wsKb, clientKb, clientFiles, projectFiles] = await Promise.all([
          listDocuments(ctx.workspaceId, "workspace", ctx.workspaceId, "kb"),
          listDocuments(ctx.workspaceId, "client", ctx.clientId, "kb"),
          listDocuments(ctx.workspaceId, "client", ctx.clientId, "file"),
          listDocuments(ctx.workspaceId, "project", ctx.projectId, "file"),
        ]);
        const all: Doc[] = [...wsKb, ...clientKb, ...clientFiles, ...projectFiles];
        const q = query.toLowerCase();
        // Match content, filename, OR doc type — so a search like "CV" finds
        // documents tagged `cv` even when the resume text never says "CV".
        const hits = all
          .filter(
            (d) =>
              d.is_active &&
              ((d.extracted_text &&
                d.extracted_text.toLowerCase().includes(q)) ||
                (d.filename && d.filename.toLowerCase().includes(q)) ||
                (d.doc_type && d.doc_type.toLowerCase().includes(q))),
          )
          .slice(0, 10)
          .map((d) => ({
            documentId: d.id,
            filename: d.filename ?? "Untitled",
            scope: d.scope_type,
            docType: d.doc_type,
            snippet: snippet(d.extracted_text ?? "", query),
          }));
        return { matches: hits };
      },
    }),

    calyflow_read_document: tool({
      description:
        "Read the full text of a knowledge-base document by its id (from calyflow_search_documents).",
      inputSchema: z.object({
        documentId: z.string(),
      }),
      execute: async ({ documentId }) => {
        const doc = await getDocument(ctx.workspaceId, documentId);
        if (!doc) return { error: "Document not found." };
        const text = doc.extracted_text ?? "";
        return {
          filename: doc.filename ?? "Untitled",
          text: text.slice(0, READ_DOC_CHAR_CAP),
          truncated: text.length > READ_DOC_CHAR_CAP,
        };
      },
    }),

    airtable_list_bases: tool({
      description: "List the Airtable bases the connection can access.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.airtableToken) return { error: notConnected("Airtable") };
        return { bases: await airtableAdapter.listBases(ctx.airtableToken) };
      },
    }),

    airtable_list_tables: tool({
      description: "List the tables in an Airtable base.",
      inputSchema: z.object({
        baseId: z.string().describe("Airtable base id (from airtable_list_bases)."),
      }),
      execute: async ({ baseId }) => {
        if (!ctx.airtableToken) return { error: notConnected("Airtable") };
        return {
          tables: await airtableAdapter.listTables(ctx.airtableToken, baseId),
        };
      },
    }),

    airtable_query_records: tool({
      description:
        "Query records from an Airtable table, returned as a Markdown table. Use filterFormula (Airtable formula syntax) to narrow results. Start narrow and refine.",
      inputSchema: z.object({
        baseId: z.string(),
        tableId: z.string().describe("Table id or name."),
        filterFormula: z
          .string()
          .optional()
          .describe('Airtable formula, e.g. {Status} = "Active".'),
        maxRecords: z.number().int().positive().optional(),
      }),
      execute: async ({ baseId, tableId, filterFormula, maxRecords }) => {
        if (!ctx.airtableToken) return { error: notConnected("Airtable") };
        return airtableAdapter.queryRecords(ctx.airtableToken, {
          baseId,
          tableId,
          filterFormula,
          maxRecords,
        });
      },
    }),

    ashby_list_jobs: tool({
      description:
        "List jobs/requisitions in the connected Ashby ATS (title, status, location, job id). Use to find the role you are sourcing for.",
      inputSchema: z.object({
        openOnly: z
          .boolean()
          .optional()
          .describe("Only return jobs with status Open."),
      }),
      execute: async ({ openOnly }) => {
        if (!ctx.ashbyToken) return { error: notConnected("Ashby") };
        return ashbyAdapter.listJobs(ctx.ashbyToken, { openOnly });
      },
    }),

    ashby_list_candidates: tool({
      description:
        "List candidates from the connected Ashby ATS as a Markdown table (name, email, location, company, title). Paginated; use limit to control volume.",
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
      }),
      execute: async ({ limit }) => {
        if (!ctx.ashbyToken) return { error: notConnected("Ashby") };
        return ashbyAdapter.listCandidates(ctx.ashbyToken, { limit });
      },
    }),

    ashby_search_candidates: tool({
      description:
        "Search Ashby candidates by name or email. Returns matching candidates as a Markdown table.",
      inputSchema: z.object({
        query: z.string().describe("A candidate name or email to search for."),
      }),
      execute: async ({ query }) => {
        if (!ctx.ashbyToken) return { error: notConnected("Ashby") };
        return ashbyAdapter.searchCandidates(ctx.ashbyToken, { query });
      },
    }),

    attio_list_objects: tool({
      description:
        "List the record objects in the connected Attio CRM (people, companies, deals, plus any custom objects) with the slug each one is queried by.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.attioToken) return { error: notConnected("Attio") };
        return attioAdapter.listObjects(ctx.attioToken);
      },
    }),

    attio_query_records: tool({
      description:
        "List records of one Attio object as a Markdown table (record name plus its first few attribute values and record id). Get the object slug from attio_list_objects (e.g. people, companies); page with offset. No server-side search — scan pages and be economical.",
      inputSchema: z.object({
        object: z
          .string()
          .describe("Object slug from attio_list_objects, e.g. people."),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.attioToken) return { error: notConnected("Attio") };
        return attioAdapter.queryRecords(ctx.attioToken, args);
      },
    }),

    bamboohr_list_jobs: tool({
      description:
        "List job openings in the connected BambooHR ATS (title, status, department, location, job id). Use to find the role you are sourcing for — the job id scopes application lookups.",
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.bamboohrToken) return { error: notConnected("BambooHR") };
        return bamboohrAdapter.listJobs(ctx.bamboohrToken, args);
      },
    }),

    bamboohr_list_applications: tool({
      description:
        "List job applications in the connected BambooHR ATS as a Markdown table (name, email, phone, status, applied date, job). Filters combine: searchString searches by applicant name, jobId scopes to one job's pipeline (from bamboohr_list_jobs).",
      inputSchema: z.object({
        searchString: z
          .string()
          .optional()
          .describe("Search by applicant name."),
        jobId: z
          .string()
          .optional()
          .describe("Job id to scope to one role's pipeline."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.bamboohrToken) return { error: notConnected("BambooHR") };
        return bamboohrAdapter.listApplications(ctx.bamboohrToken, args);
      },
    }),

    breezyhr_list_positions: tool({
      description:
        "List positions/requisitions in the connected BreezyHR ATS (name, state, department, location, position id). Use to find the role you are sourcing for. Operates on the account's first company unless companyId is given.",
      inputSchema: z.object({
        state: z
          .string()
          .optional()
          .describe(
            'Filter by position state, e.g. "published" for live roles, "draft", "closed".',
          ),
        companyId: z
          .string()
          .optional()
          .describe("BreezyHR company id, only needed for multi-company accounts."),
      }),
      execute: async (args) => {
        if (!ctx.breezyhrToken) return { error: notConnected("BreezyHR") };
        return breezyhrAdapter.listPositions(ctx.breezyhrToken, args);
      },
    }),

    breezyhr_list_candidates: tool({
      description:
        "List the candidates in a BreezyHR position's pipeline as a Markdown table (name, email, phone, headline, stage, origin). BreezyHR scopes candidates to a position — get the positionId from breezyhr_list_positions first.",
      inputSchema: z.object({
        positionId: z
          .string()
          .describe("Position id (from breezyhr_list_positions)."),
        companyId: z
          .string()
          .optional()
          .describe("BreezyHR company id, only needed for multi-company accounts."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.breezyhrToken) return { error: notConnected("BreezyHR") };
        return breezyhrAdapter.listCandidates(ctx.breezyhrToken, args);
      },
    }),

    breezyhr_search_candidates: tool({
      description:
        "Search BreezyHR candidates across positions by exact email address. Returns matching candidates as a Markdown table.",
      inputSchema: z.object({
        email: z.string().describe("The candidate email address to search for."),
        companyId: z
          .string()
          .optional()
          .describe("BreezyHR company id, only needed for multi-company accounts."),
      }),
      execute: async (args) => {
        if (!ctx.breezyhrToken) return { error: notConnected("BreezyHR") };
        return breezyhrAdapter.searchCandidates(ctx.breezyhrToken, args);
      },
    }),

    coresignal_search_employees: tool({
      description:
        "Search Coresignal's public employment-data profiles by name, title, company, and/or location, and return full profiles (name, title, company, location, work history, professional email when known, LinkedIn URL) for the top matches. EVERY call costs credits (the search plus ~2 credits per returned profile) — keep limit small (default 3, max 5) and only search when other sources lack the data.",
      inputSchema: z.object({
        name: z.string().optional().describe("Person's full name."),
        title: z.string().optional().describe("Job title / headline keywords."),
        company: z.string().optional().describe("Company name (current or past)."),
        location: z.string().optional(),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Profiles to collect (max 5; each costs credits)."),
      }),
      execute: async (args) => {
        if (!ctx.coresignalToken) return { error: notConnected("Coresignal") };
        return coresignalAdapter.searchEmployees(ctx.coresignalToken, args);
      },
    }),

    coresignal_collect_employee: tool({
      description:
        "Fetch one Coresignal employee profile by Coresignal ID (from coresignal_search_employees) or LinkedIn shorthand name (the part after /in/ in a profile URL). Costs ~2 credits per call.",
      inputSchema: z.object({
        idOrShorthand: z
          .string()
          .describe("Coresignal id, or LinkedIn shorthand, e.g. janedoe."),
      }),
      execute: async ({ idOrShorthand }) => {
        if (!ctx.coresignalToken) return { error: notConnected("Coresignal") };
        return coresignalAdapter.collectEmployee(ctx.coresignalToken, idOrShorthand);
      },
    }),

    github_search_repos: tool({
      description:
        "Search GitHub for open-source repositories by keyword (and optional language), ranked by stars. Use to find the libraries and projects a target engineer would use, then work back to the people via github_contributors / github_forks.",
      inputSchema: z.object({
        query: z
          .string()
          .describe('Keywords, e.g. "video encoding" or "ffmpeg wrapper".'),
        language: z
          .string()
          .optional()
          .describe('Programming language filter, e.g. "C++", "Rust".'),
        limit: z.number().int().positive().optional().describe("Max repos (default 20, max 50)."),
      }),
      execute: async (args) => {
        if (!ctx.githubToken) return { error: notConnected("GitHub") };
        return githubAdapter.searchRepos(ctx.githubToken, args);
      },
    }),

    github_contributors: tool({
      description:
        "List the people who contributed code to a GitHub repo (the strongest signal that someone has hands-on experience with it), ranked by commit count. Returns GitHub handles and profile URLs.",
      inputSchema: z.object({
        owner: z.string().describe('Repo owner/org, e.g. "FFmpeg".'),
        repo: z.string().describe('Repo name, e.g. "FFmpeg".'),
        limit: z.number().int().positive().optional().describe("Max people (default 20, max 50)."),
      }),
      execute: async (args) => {
        if (!ctx.githubToken) return { error: notConnected("GitHub") };
        return githubAdapter.contributors(ctx.githubToken, args);
      },
    }),

    github_forks: tool({
      description:
        "List the people who forked a GitHub repo (a wider, warmer-than-cold pool — they cared enough to copy it), most recently active first. Returns GitHub handles and profile URLs.",
      inputSchema: z.object({
        owner: z.string().describe("Repo owner/org."),
        repo: z.string().describe("Repo name."),
        limit: z.number().int().positive().optional().describe("Max forkers (default 20, max 50)."),
      }),
      execute: async (args) => {
        if (!ctx.githubToken) return { error: notConnected("GitHub") };
        return githubAdapter.forks(ctx.githubToken, args);
      },
    }),

    github_commit_emails: tool({
      description:
        "Read author contact emails out of a repo's public commit metadata (published for code attribution). Optionally scope to one author's GitHub handle. GitHub noreply addresses are filtered out; flag to the recruiter that these are public attribution emails, best used via GitHub/LinkedIn channels.",
      inputSchema: z.object({
        owner: z.string().describe("Repo owner/org."),
        repo: z.string().describe("Repo name."),
        author: z
          .string()
          .optional()
          .describe("GitHub handle to scope commits to (from github_contributors)."),
        limit: z.number().int().positive().optional().describe("Commits to scan (default 20, max 50)."),
      }),
      execute: async (args) => {
        if (!ctx.githubToken) return { error: notConnected("GitHub") };
        return githubAdapter.commitEmails(ctx.githubToken, args);
      },
    }),

    web_search: tool({
      description:
        "Search the web and get back result titles, URLs, and snippets. Supports Google-style operators (e.g. `site:github.com ffmpeg`, `\"jane doe\" engineer`). Use to find open-source projects, or to pivot from a person's handle/name to other sites (personal site, LinkedIn, X) for contact details.",
      inputSchema: z.object({
        query: z.string().describe("Search query; operators like site:, quotes, OR are supported."),
        limit: z.number().int().positive().optional().describe("Max results (default 10, max 30)."),
      }),
      execute: async (args) => {
        if (!ctx.firecrawlKey)
          return { error: "Web search is unavailable — FIRECRAWL_API_KEY is not configured." };
        const { results } = await firecrawlSearch(ctx.firecrawlKey, args);
        if (results.length === 0) return { text: "_No results._", count: 0 };
        return {
          text: results
            .map((r) => `- [${r.title ?? r.url}](${r.url})${r.description ? ` — ${r.description}` : ""}`)
            .join("\n"),
          count: results.length,
        };
      },
    }),

    web_scrape: tool({
      description:
        "Fetch one web page and return its main content as clean markdown. Use to read a candidate's profile, personal site, or a GitHub page to confirm identity and find contact links.",
      inputSchema: z.object({
        url: z.string().describe("Full URL to fetch, e.g. https://github.com/janedoe."),
      }),
      execute: async ({ url }) => {
        if (!ctx.firecrawlKey)
          return { error: "Web scrape is unavailable — FIRECRAWL_API_KEY is not configured." };
        const r = await firecrawlScrape(ctx.firecrawlKey, { url });
        return { text: r.markdown || "_Empty page._", title: r.title, truncated: r.truncated };
      },
    }),

    fireflies_list_meetings: tool({
      description:
        "List meetings recorded by the connected Fireflies.ai notetaker (title, date, duration, organizer, participants, meeting id). Filters combine: keyword searches titles and spoken content, participantEmail scopes to one person's meetings, fromDate/toDate (ISO 8601) bound the range.",
      inputSchema: z.object({
        keyword: z
          .string()
          .optional()
          .describe("Search meeting titles and spoken content."),
        participantEmail: z
          .string()
          .optional()
          .describe("Only meetings this email attended."),
        fromDate: z.string().optional().describe("ISO 8601 start of range."),
        toDate: z.string().optional().describe("ISO 8601 end of range."),
        limit: z.number().int().positive().optional().describe("Max 50."),
      }),
      execute: async (args) => {
        if (!ctx.firefliesToken) return { error: notConnected("Fireflies.ai") };
        return firefliesAdapter.listMeetings(ctx.firefliesToken, args);
      },
    }),

    fireflies_get_meeting: tool({
      description:
        "Read one Fireflies.ai meeting in full: AI summary (overview, action items, keywords) plus the speaker-attributed transcript, truncated if very long. Get the meetingId from fireflies_list_meetings.",
      inputSchema: z.object({
        meetingId: z
          .string()
          .describe("Meeting id from fireflies_list_meetings."),
      }),
      execute: async (args) => {
        if (!ctx.firefliesToken) return { error: notConnected("Fireflies.ai") };
        return firefliesAdapter.getMeeting(ctx.firefliesToken, args);
      },
    }),

    folk_list_people: tool({
      description:
        "List people (contacts) in the connected folk CRM as a Markdown table (name, email, phone, title, company, person id). Page with the cursor surfaced under the table.",
      inputSchema: z.object({
        cursor: z.string().optional().describe("Pagination cursor from a previous page."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.folkToken) return { error: notConnected("folk") };
        return folkAdapter.listPeople(ctx.folkToken, args);
      },
    }),

    folk_list_companies: tool({
      description:
        "List companies (client accounts) in the connected folk CRM as a Markdown table (company, email, website, company id). Page with the cursor surfaced under the table.",
      inputSchema: z.object({
        cursor: z.string().optional().describe("Pagination cursor from a previous page."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.folkToken) return { error: notConnected("folk") };
        return folkAdapter.listCompanies(ctx.folkToken, args);
      },
    }),

    fullenrich_enrich: tool({
      description:
        "Enrich one contact via FullEnrich's email + mobile-phone waterfall (15+ vendors). Provide firstName + lastName with a company or domain, or a linkedinUrl. Asynchronous: this returns an enrichment id; read the result with fullenrich_get_result after a few seconds.",
      inputSchema: z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        company: z.string().optional().describe("Company name."),
        domain: z.string().optional().describe("Company website or domain."),
        linkedinUrl: z.string().optional().describe("LinkedIn profile URL."),
      }),
      execute: async (args) => {
        if (!ctx.fullenrichToken) return { error: notConnected("FullEnrich") };
        return fullenrichAdapter.enrich(ctx.fullenrichToken, args);
      },
    }),

    fullenrich_get_result: tool({
      description:
        "Read the result of a FullEnrich enrichment using the enrichment id returned by fullenrich_enrich. May report the waterfall is still running — if so, call again after working on something else for a moment.",
      inputSchema: z.object({
        enrichmentId: z.string().describe("Enrichment id from fullenrich_enrich."),
      }),
      execute: async (args) => {
        if (!ctx.fullenrichToken) return { error: notConnected("FullEnrich") };
        return fullenrichAdapter.getResult(ctx.fullenrichToken, args);
      },
    }),

    avoma_list_meetings: tool({
      description:
        "List recorded calls in the connected Avoma account as a Markdown table (subject, date, attendees, meeting uuid, link). Defaults to the last 30 days; narrow with fromDate/toDate (YYYY-MM-DD) and page with page.",
      inputSchema: z.object({
        fromDate: z.string().optional().describe("Start date YYYY-MM-DD (defaults to 30 days ago)."),
        toDate: z.string().optional().describe("End date YYYY-MM-DD (defaults to today)."),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.avomaToken) return { error: notConnected("Avoma") };
        return avomaAdapter.listMeetings(ctx.avomaToken, args);
      },
    }),

    avoma_get_transcript: tool({
      description:
        "Read the speaker-attributed transcript of one Avoma meeting, truncated if very long. Get the meetingUuid from avoma_list_meetings.",
      inputSchema: z.object({
        meetingUuid: z.string().describe("Meeting uuid from avoma_list_meetings."),
      }),
      execute: async (args) => {
        if (!ctx.avomaToken) return { error: notConnected("Avoma") };
        return avomaAdapter.getTranscript(ctx.avomaToken, args);
      },
    }),

    fathom_list_meetings: tool({
      description:
        "List calls recorded by the connected Fathom notetaker (title, date, invitees, recording id, share link). Filters combine: inviteeDomain (attendee company domain, exact match), recordedBy (recorder's email), createdAfter/createdBefore (ISO 8601); paginate with the cursor from the previous page.",
      inputSchema: z.object({
        inviteeDomain: z
          .string()
          .optional()
          .describe("Attendee company domain, e.g. acme.com."),
        recordedBy: z.string().optional().describe("Recorder's email."),
        createdAfter: z.string().optional().describe("ISO 8601 start of range."),
        createdBefore: z.string().optional().describe("ISO 8601 end of range."),
        cursor: z.string().optional().describe("Cursor from the previous page."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.fathomToken) return { error: notConnected("Fathom") };
        return fathomAdapter.listMeetings(ctx.fathomToken, args);
      },
    }),

    fathom_get_summary: tool({
      description:
        "Read the AI summary (markdown) of one Fathom recording. Get the recordingId from fathom_list_meetings.",
      inputSchema: z.object({
        recordingId: z
          .string()
          .describe("Recording id from fathom_list_meetings."),
      }),
      execute: async ({ recordingId }) => {
        if (!ctx.fathomToken) return { error: notConnected("Fathom") };
        return fathomAdapter.getSummary(ctx.fathomToken, recordingId);
      },
    }),

    fathom_get_transcript: tool({
      description:
        "Read the speaker-attributed transcript of one Fathom recording, truncated if very long. Get the recordingId from fathom_list_meetings. Prefer fathom_get_summary first; pull the transcript when you need exact quotes or detail.",
      inputSchema: z.object({
        recordingId: z
          .string()
          .describe("Recording id from fathom_list_meetings."),
      }),
      execute: async ({ recordingId }) => {
        if (!ctx.fathomToken) return { error: notConnected("Fathom") };
        return fathomAdapter.getTranscript(ctx.fathomToken, recordingId);
      },
    }),

    findymail_find_email: tool({
      description:
        "Find a verified work email via Findymail from a person's full name and company domain. Costs a finder credit. Returns the email plus name/domain, or reports no match.",
      inputSchema: z.object({
        name: z.string().describe("Person's full name."),
        domain: z.string().describe("Company domain, e.g. acme.com."),
      }),
      execute: async (args) => {
        if (!ctx.findymailToken) return { error: notConnected("Findymail") };
        return findymailAdapter.findEmail(ctx.findymailToken, args);
      },
    }),

    findymail_find_phone: tool({
      description:
        "Find a direct mobile number via Findymail from a LinkedIn profile URL (excludes EU numbers for GDPR). Costs credits only if found.",
      inputSchema: z.object({
        linkedinUrl: z.string().describe("LinkedIn profile URL."),
      }),
      execute: async (args) => {
        if (!ctx.findymailToken) return { error: notConnected("Findymail") };
        return findymailAdapter.findPhone(ctx.findymailToken, args);
      },
    }),

    findymail_verify_email: tool({
      description:
        "Verify one email's deliverability via Findymail (deliverable vs risky, plus the email provider). Use before adding an address to an outreach run.",
      inputSchema: z.object({
        email: z.string().describe("The email address to verify."),
      }),
      execute: async (args) => {
        if (!ctx.findymailToken) return { error: notConnected("Findymail") };
        return findymailAdapter.verifyEmail(ctx.findymailToken, args);
      },
    }),

    gong_list_calls: tool({
      description:
        "List recorded calls in the connected Gong account as a Markdown table (title, date, duration, direction, call id). Defaults to the last 30 days; narrow with fromDate/toDate (ISO dates) and page with cursor.",
      inputSchema: z.object({
        fromDate: z
          .string()
          .optional()
          .describe("Earliest call date, ISO format (e.g. 2026-05-01)."),
        toDate: z
          .string()
          .optional()
          .describe("Latest call date, ISO format."),
        cursor: z.string().optional().describe("Pagination cursor."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.gongToken) return { error: notConnected("Gong") };
        return gongAdapter.listCalls(ctx.gongToken, args);
      },
    }),

    gong_get_summary: tool({
      description:
        "Read one Gong call's AI brief, key points, outline, and participants. Get the callId from gong_list_calls. Briefs require Gong smart features — if absent, fall back to gong_get_transcript.",
      inputSchema: z.object({
        callId: z.string().describe("Call id from gong_list_calls."),
      }),
      execute: async ({ callId }) => {
        if (!ctx.gongToken) return { error: notConnected("Gong") };
        return gongAdapter.getSummary(ctx.gongToken, callId);
      },
    }),

    gong_get_transcript: tool({
      description:
        "Read the speaker-attributed transcript of one Gong call, truncated if very long. Get the callId from gong_list_calls. Prefer gong_get_summary first; pull the transcript when you need exact quotes or detail.",
      inputSchema: z.object({
        callId: z.string().describe("Call id from gong_list_calls."),
      }),
      execute: async ({ callId }) => {
        if (!ctx.gongToken) return { error: notConnected("Gong") };
        return gongAdapter.getTranscript(ctx.gongToken, callId);
      },
    }),

    grain_list_recordings: tool({
      description:
        "List recordings in the connected Grain account as a Markdown table (title, date, recording id, link). Page with the cursor surfaced under the table.",
      inputSchema: z.object({
        cursor: z.string().optional().describe("Pagination cursor from a previous page."),
      }),
      execute: async (args) => {
        if (!ctx.grainToken) return { error: notConnected("Grain") };
        return grainAdapter.listRecordings(ctx.grainToken, args);
      },
    }),

    grain_get_transcript: tool({
      description:
        "Read the speaker-attributed transcript of one Grain recording, truncated if very long. Get the recordingId from grain_list_recordings.",
      inputSchema: z.object({
        recordingId: z.string().describe("Recording id from grain_list_recordings."),
      }),
      execute: async (args) => {
        if (!ctx.grainToken) return { error: notConnected("Grain") };
        return grainAdapter.getTranscript(ctx.grainToken, args);
      },
    }),

    gmail_send_email: tool({
      description:
        "Send a plain-text email from the user's connected Gmail address. Use ONLY for outreach the task explicitly asks for, to addresses found in the connected data — never to invented addresses. One recipient per call.",
      inputSchema: z.object({
        to: z.string().email().describe("Recipient email address."),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(10_000).describe("Plain-text message body."),
        cc: z.string().email().optional(),
      }),
      execute: async (args) => {
        if (!ctx.gmailToken) return { error: notConnected("Gmail") };
        const { id } = await gmailAdapter.sendEmail(ctx.gmailToken, args);
        return { sent: true, to: args.to, messageId: id };
      },
    }),

    slack_list_channels: tool({
      description:
        "List the Slack channels this workspace's Slack connection can see (id, name, whether the bot is a member). Use to find the channel id to post to.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.slackToken) return { error: notConnected("Slack") };
        return { channels: await slackAdapter.listChannels(ctx.slackToken) };
      },
    }),

    slack_post_message: tool({
      description:
        "Post a message to a Slack channel by id (e.g. C0123456789). Use Slack mrkdwn: *bold*, _italic_, `code`, and <https://url|label> links (NOT Markdown [label](url)). Keep it concise — this is read in a channel by a hiring manager. Post only when the task asks you to; never invent a channel id.",
      inputSchema: z.object({
        channel: z
          .string()
          .min(1)
          .describe("Slack channel id, e.g. C0123456789."),
        text: z
          .string()
          .min(1)
          .max(35_000)
          .describe("Message body in Slack mrkdwn."),
      }),
      execute: async ({ channel, text }) => {
        if (!ctx.slackToken) return { error: notConnected("Slack") };
        // Make sure the bot is in the channel before posting (no-op if already).
        await slackAdapter.joinChannel(ctx.slackToken, channel);
        const { ok, ts } = await slackAdapter.postMessage(ctx.slackToken, {
          channel,
          text,
        });
        return { posted: ok, channel, ts };
      },
    }),

    googlesheets_list_spreadsheets: tool({
      description:
        "List the Google Sheets spreadsheets the connection can access (name, last modified, spreadsheet id), newest first. Pass query to filter by name.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Filter spreadsheets by name (contains match)."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.googleSheetsToken)
          return { error: notConnected("Google Sheets") };
        return googleSheetsAdapter.listSpreadsheets(ctx.googleSheetsToken, args);
      },
    }),

    googlesheets_list_sheets: tool({
      description:
        "List the sheet tabs of one Google Sheets spreadsheet (title, rows, columns). Get the spreadsheetId from googlesheets_list_spreadsheets.",
      inputSchema: z.object({
        spreadsheetId: z
          .string()
          .describe("Spreadsheet id from googlesheets_list_spreadsheets."),
      }),
      execute: async ({ spreadsheetId }) => {
        if (!ctx.googleSheetsToken)
          return { error: notConnected("Google Sheets") };
        return googleSheetsAdapter.listSheets(ctx.googleSheetsToken, spreadsheetId);
      },
    }),

    googlesheets_read_range: tool({
      description:
        "Read rows from a Google Sheets range as a Markdown table (the first row is treated as the header). range uses A1 notation: a sheet name like 'Candidates' reads the whole tab; 'Candidates!A1:F50' reads a block. Start with a whole tab, then narrow.",
      inputSchema: z.object({
        spreadsheetId: z
          .string()
          .describe("Spreadsheet id from googlesheets_list_spreadsheets."),
        range: z
          .string()
          .describe("A1 notation, e.g. Candidates or Candidates!A1:F50."),
        maxRows: z.number().int().positive().optional().describe("Max 200."),
      }),
      execute: async (args) => {
        if (!ctx.googleSheetsToken)
          return { error: notConnected("Google Sheets") };
        return googleSheetsAdapter.readRange(ctx.googleSheetsToken, args);
      },
    }),

    greenhouse_list_jobs: tool({
      description:
        "List jobs/requisitions in the connected Greenhouse ATS (name, status, department, office, job id). Use to find the role you are sourcing for.",
      inputSchema: z.object({
        openOnly: z
          .boolean()
          .optional()
          .describe("Only return jobs with status open."),
      }),
      execute: async (args) => {
        if (!ctx.greenhouseToken) return { error: notConnected("Greenhouse") };
        return greenhouseAdapter.listJobs(ctx.greenhouseToken, args);
      },
    }),

    greenhouse_list_candidates: tool({
      description:
        "List candidates from the connected Greenhouse ATS as a Markdown table (name, email, company, title, job, stage). Pass jobId (from greenhouse_list_jobs) to scope to one role's pipeline; paginated, use limit to control volume.",
      inputSchema: z.object({
        jobId: z
          .string()
          .optional()
          .describe("Greenhouse job id to scope candidates to one role."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.greenhouseToken) return { error: notConnected("Greenhouse") };
        return greenhouseAdapter.listCandidates(ctx.greenhouseToken, args);
      },
    }),

    greenhouse_search_candidates: tool({
      description:
        "Search Greenhouse candidates by exact email address. Returns matching candidates as a Markdown table.",
      inputSchema: z.object({
        email: z.string().describe("The candidate email address to search for."),
      }),
      execute: async (args) => {
        if (!ctx.greenhouseToken) return { error: notConnected("Greenhouse") };
        return greenhouseAdapter.searchCandidates(ctx.greenhouseToken, args);
      },
    }),

    hubspot_search_contacts: tool({
      description:
        "Search contacts in the connected HubSpot CRM by name, email, or other text (name, email, title, company, phone). Omit query to list recent contacts.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Free-text search, e.g. a name, email, or company."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.hubspotToken) return { error: notConnected("HubSpot") };
        return hubspotAdapter.searchContacts(ctx.hubspotToken, args);
      },
    }),

    hubspot_search_companies: tool({
      description:
        "Search companies in the connected HubSpot CRM by name or domain (name, domain, industry, location, employee count). Omit query to list recent companies.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Free-text search, e.g. a company name or domain."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.hubspotToken) return { error: notConnected("HubSpot") };
        return hubspotAdapter.searchCompanies(ctx.hubspotToken, args);
      },
    }),

    hubspot_search_deals: tool({
      description:
        "Search deals in the connected HubSpot CRM by name (deal name, amount, stage, pipeline, close date). Omit query to list recent deals.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free-text search, e.g. a deal or client name."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.hubspotToken) return { error: notConnected("HubSpot") };
        return hubspotAdapter.searchDeals(ctx.hubspotToken, args);
      },
    }),

    hunter_domain_search: tool({
      description:
        "Find people at a company via Hunter.io — pass a company domain (e.g. acme.com) or company name, optionally filtered by department and/or seniority to target specific roles/functions. Returns name, position, department, seniority, email, and confidence.",
      inputSchema: z.object({
        domain: z
          .string()
          .optional()
          .describe("Company domain, e.g. acme.com (preferred)."),
        company: z
          .string()
          .optional()
          .describe("Company name, if the domain isn't known."),
        department: z
          .string()
          .optional()
          .describe(
            "Comma-separated departments: executive, it, finance, management, sales, legal, support, hr, marketing, communication, education, design, health, operations.",
          ),
        seniority: z
          .string()
          .optional()
          .describe("Comma-separated seniority: junior, senior, executive."),
        type: z.enum(["personal", "generic"]).optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.hunterToken) return { error: notConnected("Hunter.io") };
        return hunterAdapter.domainSearch(ctx.hunterToken, args);
      },
    }),

    hunter_email_finder: tool({
      description:
        "Find a specific person's email address at a company via Hunter.io. Provide their name and the company domain (or company name).",
      inputSchema: z.object({
        domain: z.string().optional().describe("Company domain, e.g. acme.com."),
        company: z.string().optional(),
        fullName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      }),
      execute: async (args) => {
        if (!ctx.hunterToken) return { error: notConnected("Hunter.io") };
        return hunterAdapter.emailFinder(ctx.hunterToken, args);
      },
    }),

    hunter_email_verifier: tool({
      description:
        "Verify the deliverability of an email address via Hunter.io. Returns a result (deliverable/risky/undeliverable) and score.",
      inputSchema: z.object({
        email: z.string().describe("The email address to verify."),
      }),
      execute: async ({ email }) => {
        if (!ctx.hunterToken) return { error: notConnected("Hunter.io") };
        return hunterAdapter.emailVerifier(ctx.hunterToken, email);
      },
    }),

    apollo_search_people: tool({
      description:
        "Search Apollo's B2B database for people at target companies by job title, seniority, company domain/name, and location. Returns name, title, company, location, and email status as a Markdown table. NOTE: email addresses are usually masked in search results — use apollo_enrich_person to reveal a specific person's actual email.",
      inputSchema: z.object({
        domain: z
          .string()
          .optional()
          .describe("Company domain to target, e.g. acme.com (preferred)."),
        company: z
          .string()
          .optional()
          .describe("Company name, if the domain isn't known."),
        titles: z
          .array(z.string())
          .optional()
          .describe('Job titles to match, e.g. ["VP Engineering", "Head of Talent"].'),
        seniorities: z
          .array(z.string())
          .optional()
          .describe(
            'Seniority levels: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry, intern.',
          ),
        locations: z
          .array(z.string())
          .optional()
          .describe('Person locations, e.g. ["San Francisco, US", "London, UK"].'),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.apolloToken) return { error: notConnected("Apollo") };
        return apolloAdapter.searchPeople(ctx.apolloToken, args);
      },
    }),

    apollo_enrich_person: tool({
      description:
        "Reveal a specific person's contact details (work email, phone, LinkedIn) via Apollo's People Match. Provide their name and the company domain (or company name). Set revealEmail to surface personal emails when work email is unavailable.",
      inputSchema: z.object({
        fullName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        domain: z.string().optional().describe("Company domain, e.g. acme.com."),
        company: z.string().optional(),
        revealEmail: z
          .boolean()
          .optional()
          .describe("Reveal personal emails when no work email is found."),
      }),
      execute: async (args) => {
        if (!ctx.apolloToken) return { error: notConnected("Apollo") };
        return apolloAdapter.enrichPerson(ctx.apolloToken, args);
      },
    }),

    apollo_search_organizations: tool({
      description:
        "Find target companies in Apollo by keyword (industry/technology), location, and employee-size range. Returns company name, domain, industry, employee count, and location as a Markdown table. Use to build a target-account list before searching for people.",
      inputSchema: z.object({
        keywords: z
          .string()
          .optional()
          .describe("Keyword tags, e.g. 'fintech' or 'healthcare software'."),
        locations: z
          .array(z.string())
          .optional()
          .describe('Company HQ locations, e.g. ["United States", "Germany"].'),
        employeeRanges: z
          .array(z.string())
          .optional()
          .describe('Employee-count ranges, e.g. ["1,10", "11,50", "51,200"].'),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.apolloToken) return { error: notConnected("Apollo") };
        return apolloAdapter.searchOrganizations(ctx.apolloToken, args);
      },
    }),

    brightdata_scrape_linkedin_profiles: tool({
      description:
        "Scrape full public LinkedIn profiles (headline, current company, location, experience, about) by profile URL via Bright Data. Up to 5 URLs per call; each collected profile is billed. Scrapes can take 1–3 minutes — if the result says the collection is still running, note the snapshot id, do other work, and fetch it later with brightdata_get_snapshot.",
      inputSchema: z.object({
        urls: z
          .array(z.string())
          .describe(
            'LinkedIn profile URLs, e.g. ["https://www.linkedin.com/in/janedoe"]. Max 5 per call.',
          ),
      }),
      execute: async (args) => {
        if (!ctx.brightdataToken) return { error: notConnected("Bright Data") };
        return brightdataAdapter.scrapeLinkedinProfiles(
          ctx.brightdataToken,
          args,
        );
      },
    }),

    brightdata_scrape_linkedin_companies: tool({
      description:
        "Scrape public LinkedIn company pages (industry, size, HQ, website, about) by company URL via Bright Data. Up to 5 URLs per call; each collected record is billed. Scrapes can take 1–3 minutes — if the result says the collection is still running, fetch it later with brightdata_get_snapshot.",
      inputSchema: z.object({
        urls: z
          .array(z.string())
          .describe(
            'LinkedIn company URLs, e.g. ["https://www.linkedin.com/company/acme"]. Max 5 per call.',
          ),
      }),
      execute: async (args) => {
        if (!ctx.brightdataToken) return { error: notConnected("Bright Data") };
        return brightdataAdapter.scrapeLinkedinCompanies(
          ctx.brightdataToken,
          args,
        );
      },
    }),

    brightdata_get_snapshot: tool({
      description:
        "Fetch the results of a Bright Data collection that was still running when triggered (use the snapshot id a brightdata_scrape_* tool returned). Free to call; returns the records once ready.",
      inputSchema: z.object({
        snapshotId: z.string().describe("Snapshot id from a brightdata_scrape_* result."),
      }),
      execute: async ({ snapshotId }) => {
        if (!ctx.brightdataToken) return { error: notConnected("Bright Data") };
        return brightdataAdapter.getSnapshot(ctx.brightdataToken, snapshotId);
      },
    }),

    bullhorn_list_jobs: tool({
      description:
        "List jobs in the connected Bullhorn ATS (title, client, status, type, job id), newest first. Pass title to filter by job title; set openOnly for open roles; page with start.",
      inputSchema: z.object({
        title: z.string().optional().describe("Filter by job title."),
        openOnly: z.boolean().optional().describe("Only return open jobs."),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.bullhornToken) return { error: notConnected("Bullhorn") };
        return bullhornAdapter.listJobs(ctx.bullhornToken, args);
      },
    }),

    bullhorn_search_candidates: tool({
      description:
        "Search candidates in the connected Bullhorn ATS as a Markdown table (name, email, phone, title, company, location, status), newest first. Filters combine: name, email, or query (a raw Lucene fragment, e.g. occupation:\"engineer\" AND address.city:\"Berlin\"); page with start.",
      inputSchema: z.object({
        name: z.string().optional().describe("Search by candidate name."),
        email: z.string().optional().describe("Find a candidate by email."),
        query: z
          .string()
          .optional()
          .describe(
            'Raw Lucene fragment over candidate fields, e.g. occupation:"engineer".',
          ),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.bullhornToken) return { error: notConnected("Bullhorn") };
        return bullhornAdapter.searchCandidates(ctx.bullhornToken, args);
      },
    }),

    bullhorn_list_job_submissions: tool({
      description:
        "List one Bullhorn job's submissions (the pipeline) with each candidate's details and stage, newest first. Get the jobId from bullhorn_list_jobs.",
      inputSchema: z.object({
        jobId: z.number().int().describe("Job id from bullhorn_list_jobs."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.bullhornToken) return { error: notConnected("Bullhorn") };
        return bullhornAdapter.listJobSubmissions(ctx.bullhornToken, args);
      },
    }),

    vincere_search_candidates: tool({
      description:
        "Search candidates in the connected Vincere ATS as a Markdown table (name, email, phone, title, company, location, candidate id), newest first. Pass query for a name keyword (prefix match), or q for a raw Vincere Solr fragment (e.g. current_location:\"London\"#current_job_title:engineer); page with start.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Name keyword (prefix match on the candidate's name)."),
        q: z
          .string()
          .optional()
          .describe(
            'Raw Vincere Solr query, e.g. current_job_title:engineer (overrides query).',
          ),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.vincereToken) return { error: notConnected("Vincere") };
        return vincereAdapter.searchCandidates(ctx.vincereToken, args);
      },
    }),

    vincere_search_companies: tool({
      description:
        "Search companies (clients) in the connected Vincere CRM as a Markdown table (name, industry, website, phone, location, company id), newest first. Pass query for a name keyword or q for a raw Vincere Solr fragment; page with start.",
      inputSchema: z.object({
        query: z.string().optional().describe("Company name keyword (prefix match)."),
        q: z
          .string()
          .optional()
          .describe("Raw Vincere Solr query (overrides query)."),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.vincereToken) return { error: notConnected("Vincere") };
        return vincereAdapter.searchCompanies(ctx.vincereToken, args);
      },
    }),

    vincere_search_contacts: tool({
      description:
        "Search contacts (client-side people) in the connected Vincere CRM as a Markdown table (name, email, phone, title, company, contact id), newest first. Pass query for a name keyword or q for a raw Vincere Solr fragment; page with start.",
      inputSchema: z.object({
        query: z.string().optional().describe("Contact name keyword (prefix match)."),
        q: z
          .string()
          .optional()
          .describe("Raw Vincere Solr query (overrides query)."),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.vincereToken) return { error: notConnected("Vincere") };
        return vincereAdapter.searchContacts(ctx.vincereToken, args);
      },
    }),

    vincere_search_applications: tool({
      description:
        "Search applications (candidate↔job links) in the connected Vincere ATS as a Markdown table (candidate, job, stage, status, created, application id), newest first. Pass q for a raw Vincere Solr fragment (e.g. job_id:1234 or stage:shortlisted); page with start.",
      inputSchema: z.object({
        q: z
          .string()
          .optional()
          .describe('Raw Vincere Solr query, e.g. job_id:1234 or stage:shortlisted.'),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.vincereToken) return { error: notConnected("Vincere") };
        return vincereAdapter.searchApplications(ctx.vincereToken, args);
      },
    }),

    vincere_list_talent_pools: tool({
      description:
        "List the talent pools in the connected Vincere ATS (name, description, candidate count, pool id).",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.vincereToken) return { error: notConnected("Vincere") };
        return vincereAdapter.listTalentPools(ctx.vincereToken);
      },
    }),

    cats_list_jobs: tool({
      description:
        "List jobs in the connected CATS ATS (title, location, created date, job id). Paginate with page. Use to find the role you are sourcing for.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.catsToken) return { error: notConnected("CATS") };
        return catsAdapter.listJobs(ctx.catsToken, args);
      },
    }),

    cats_list_candidates: tool({
      description:
        "List candidates in the connected CATS ATS as a Markdown table (name, email, phone, title). Pass query to search by name or email; omit it to list recent candidates. Paginate with page.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search by name or email."),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.catsToken) return { error: notConnected("CATS") };
        return catsAdapter.listCandidates(ctx.catsToken, args);
      },
    }),

    close_search_leads: tool({
      description:
        "Search leads (client companies/accounts) in the connected Close CRM as a Markdown table (lead, status, primary contact, email, phone, lead id). Pass query for Close's smart search (name, email, status, …); page with skip.",
      inputSchema: z.object({
        query: z.string().optional().describe("Close search query (name, email, status, …)."),
        skip: z.number().int().nonnegative().optional().describe("Offset for paging."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.closeToken) return { error: notConnected("Close") };
        return closeAdapter.searchLeads(ctx.closeToken, args);
      },
    }),

    close_list_opportunities: tool({
      description:
        "List BD opportunities (deals) in the connected Close CRM as a Markdown table (lead, status, value, confidence, created, opportunity id). Pass leadId (from close_search_leads) to scope to one account; page with skip.",
      inputSchema: z.object({
        leadId: z.string().optional().describe("Lead id to scope to one account's opportunities."),
        skip: z.number().int().nonnegative().optional().describe("Offset for paging."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.closeToken) return { error: notConnected("Close") };
        return closeAdapter.listOpportunities(ctx.closeToken, args);
      },
    }),

    crelate_list_jobs: tool({
      description:
        "List jobs in the connected Crelate ATS (name, company, status, openings, job id). Pass name to filter by job name (contains match); paginate with offset.",
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe("Filter by job name (contains match)."),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.crelateToken) return { error: notConnected("Crelate") };
        return crelateAdapter.listJobs(ctx.crelateToken, args);
      },
    }),

    crelate_search_contacts: tool({
      description:
        "Search contacts in the connected Crelate ATS by keyword (name, skill, company) and get full rows back (name, title, company, email, phone, LinkedIn). Use this when you have search terms; use crelate_list_contacts to browse or filter by type.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Keyword query: name, skill, company, …"),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.crelateToken) return { error: notConnected("Crelate") };
        return crelateAdapter.searchContacts(ctx.crelateToken, args);
      },
    }),

    crelate_list_contacts: tool({
      description:
        "List contacts in the connected Crelate ATS as a Markdown table (name, title, company, email, phone, LinkedIn). Filter by recordType (candidate, client, vendor, …) or email; paginate with offset.",
      inputSchema: z.object({
        recordType: z
          .string()
          .optional()
          .describe("Record type filter, e.g. candidate or client."),
        email: z.string().optional().describe("Find a contact by email."),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.crelateToken) return { error: notConnected("Crelate") };
        return crelateAdapter.listContacts(ctx.crelateToken, args);
      },
    }),

    dropcontact_enrich: tool({
      description:
        "Enrich one contact via Dropcontact (GDPR-compliant, EU-focused): finds and verifies a professional email, and may add phone, job title, company, and LinkedIn. Provide whatever you know — at least one of email, fullName (or firstName + lastName), company, website, or linkedin. Enrichment is asynchronous: this returns a request id; read the result with dropcontact_get_result after a few seconds.",
      inputSchema: z.object({
        email: z.string().optional().describe("Known email, to verify/enrich."),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        fullName: z.string().optional().describe("Full name if first/last aren't split."),
        company: z.string().optional().describe("Company name."),
        website: z.string().optional().describe("Company website or domain."),
        linkedin: z.string().optional().describe("LinkedIn profile URL."),
      }),
      execute: async (args) => {
        if (!ctx.dropcontactToken) return { error: notConnected("Dropcontact") };
        return dropcontactAdapter.enrich(ctx.dropcontactToken, args);
      },
    }),

    dropcontact_get_result: tool({
      description:
        "Read the result of a Dropcontact enrichment using the request id returned by dropcontact_enrich. May report the batch is still processing — if so, call again after working on something else for a moment.",
      inputSchema: z.object({
        requestId: z.string().describe("Request id from dropcontact_enrich."),
      }),
      execute: async (args) => {
        if (!ctx.dropcontactToken) return { error: notConnected("Dropcontact") };
        return dropcontactAdapter.getResult(ctx.dropcontactToken, args);
      },
    }),

    contactout_people_search: tool({
      description:
        "Search ContactOut's database of LinkedIn profiles by name, job title, company, location, seniority, or skills. Returns name, title, company, location, and the LinkedIn URL per person as a Markdown table. Contact details are NOT revealed by default (search is free); set revealInfo only when you need contacts for every row — it consumes email and phone credits PER PROFILE. Prefer searching first, then enriching only the selected people with contactout_linkedin_enrich.",
      inputSchema: z.object({
        name: z.string().optional().describe("Person name to search for."),
        jobTitles: z
          .array(z.string())
          .optional()
          .describe('Job titles to match, e.g. ["VP Engineering", "Head of Talent"].'),
        companies: z
          .array(z.string())
          .optional()
          .describe('Company names, e.g. ["Stripe", "Acme"].'),
        locations: z
          .array(z.string())
          .optional()
          .describe('Locations, e.g. ["San Francisco, CA", "London"].'),
        seniorities: z
          .array(z.string())
          .optional()
          .describe(
            'Seniority levels, e.g. ["director", "vice president", "c-level"].',
          ),
        skills: z
          .array(z.string())
          .optional()
          .describe('Skills to match, e.g. ["Network Security"].'),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Result page, starting at 1."),
        revealInfo: z
          .boolean()
          .optional()
          .describe(
            "Reveal emails/phones for every returned profile. COSTS credits per profile — leave unset unless contacts are needed for all results.",
          ),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max profiles to return, up to 25 (default 10)."),
      }),
      execute: async (args) => {
        if (!ctx.contactoutToken) return { error: notConnected("ContactOut") };
        return contactoutAdapter.peopleSearch(ctx.contactoutToken, args);
      },
    }),

    contactout_linkedin_enrich: tool({
      description:
        "Get a person's contact details (work emails, personal emails, phone numbers) from their LinkedIn profile URL via ContactOut. COSTS one email credit and one phone credit per call — only enrich people you actually intend to contact. Set profileOnly to fetch the profile without contact info (no contact credits).",
      inputSchema: z.object({
        profileUrl: z
          .string()
          .describe(
            "Full LinkedIn profile URL, e.g. https://linkedin.com/in/janedoe.",
          ),
        profileOnly: z
          .boolean()
          .optional()
          .describe("Fetch the profile without revealing contacts (free)."),
      }),
      execute: async (args) => {
        if (!ctx.contactoutToken) return { error: notConnected("ContactOut") };
        return contactoutAdapter.linkedinEnrich(ctx.contactoutToken, args);
      },
    }),

    contactout_person_enrich: tool({
      description:
        "Find a person's contact details via ContactOut when you don't have their LinkedIn URL — provide their name plus at least one anchor (companies, companyDomain, jobTitle, location, or a known email). Returns work/personal emails and phones. Consumes credits per successful match.",
      inputSchema: z.object({
        fullName: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        companies: z
          .array(z.string())
          .optional()
          .describe('Current or past companies, e.g. ["Stripe"].'),
        companyDomain: z
          .string()
          .optional()
          .describe("Company domain, e.g. acme.com."),
        jobTitle: z.string().optional(),
        location: z.string().optional(),
        linkedinUrl: z
          .string()
          .optional()
          .describe("If you have the LinkedIn URL, prefer contactout_linkedin_enrich."),
        email: z
          .string()
          .optional()
          .describe("A known email of theirs, to find the rest."),
        include: z
          .array(z.enum(["work_email", "personal_email", "phone"]))
          .optional()
          .describe("Contact types to reveal (defaults to all three)."),
      }),
      execute: async (args) => {
        if (!ctx.contactoutToken) return { error: notConnected("ContactOut") };
        return contactoutAdapter.personEnrich(ctx.contactoutToken, args);
      },
    }),

    contactout_email_verify: tool({
      description:
        "Verify the deliverability of an email address via ContactOut. Returns valid, invalid, accept_all, disposable, or unknown. Cheap — use before adding an email to an outreach list.",
      inputSchema: z.object({
        email: z.string().describe("The email address to verify."),
      }),
      execute: async ({ email }) => {
        if (!ctx.contactoutToken) return { error: notConnected("ContactOut") };
        return contactoutAdapter.emailVerify(ctx.contactoutToken, email);
      },
    }),

    loxo_list_jobs: tool({
      description:
        "List jobs in the connected Loxo ATS (title, status, company, location, job id). Optionally filter with a text query. Use to find the role you are sourcing for.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Text filter, e.g. a role title or client company."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.loxoToken) return { error: notConnected("Loxo") };
        return loxoAdapter.listJobs(ctx.loxoToken, args);
      },
    }),

    loxo_search_people: tool({
      description:
        "Search the connected Loxo people database by name, title, company, or email. Returns name, title, company, location, and email as a Markdown table.",
      inputSchema: z.object({
        query: z.string().describe("Search text, e.g. a name, title, or company."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.loxoToken) return { error: notConnected("Loxo") };
        return loxoAdapter.searchPeople(ctx.loxoToken, args);
      },
    }),

    loxo_list_job_candidates: tool({
      description:
        "List the candidates attached to a Loxo job's pipeline as a Markdown table. Get the jobId from loxo_list_jobs first.",
      inputSchema: z.object({
        jobId: z.string().describe("Job id (from loxo_list_jobs)."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.loxoToken) return { error: notConnected("Loxo") };
        return loxoAdapter.listJobCandidates(ctx.loxoToken, args);
      },
    }),

    instantly_campaign_analytics: tool({
      description:
        "Get outreach performance for Instantly.ai campaigns — leads, contacted, emails sent, unique opens/replies, bounces, unsubscribes, opportunities. Scope to one campaign with campaignId and/or a date range.",
      inputSchema: z.object({
        campaignId: z
          .string()
          .optional()
          .describe("Campaign id (from instantly_list_campaigns); omit for all."),
        startDate: z.string().optional().describe("YYYY-MM-DD."),
        endDate: z.string().optional().describe("YYYY-MM-DD."),
      }),
      execute: async (args) => {
        if (!ctx.instantlyToken) return { error: notConnected("Instantly.ai") };
        return instantlyAdapter.campaignAnalytics(ctx.instantlyToken, args);
      },
    }),

    instantly_add_lead: tool({
      description:
        "Add a lead to an Instantly.ai campaign. CAUTION: an Active campaign will start sending real cold emails to this person — only add leads the user explicitly asked to enroll, never in bulk without instruction. Skips emails already in the workspace or campaign by default. Provide firstName/companyName so sequence personalisation variables resolve.",
      inputSchema: z.object({
        campaignId: z
          .string()
          .describe("Target campaign id (from instantly_list_campaigns)."),
        email: z.string().describe("The lead's email address."),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        companyName: z.string().optional(),
        jobTitle: z.string().optional(),
        personalization: z
          .string()
          .optional()
          .describe("Personalised opening line, if the sequence uses one."),
        skipIfInWorkspace: z
          .boolean()
          .optional()
          .describe("Skip if the email exists anywhere in the workspace (default true)."),
      }),
      execute: async (args) => {
        if (!ctx.instantlyToken) return { error: notConnected("Instantly.ai") };
        return instantlyAdapter.addLead(ctx.instantlyToken, args);
      },
    }),

    jazzhr_list_jobs: tool({
      description:
        "List jobs in the connected JazzHR ATS (title, status, department, location, job id). Filter by status, e.g. open. 100 rows per page; paginate with page.",
      inputSchema: z.object({
        status: z.string().optional().describe('Job status filter, e.g. "open".'),
        page: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.jazzhrToken) return { error: notConnected("JazzHR") };
        return jazzhrAdapter.listJobs(ctx.jazzhrToken, args);
      },
    }),

    jazzhr_list_applicants: tool({
      description:
        "List applicants in the connected JazzHR ATS as a Markdown table (name, phone, job applied for, apply date). Filters combine: jobId scopes to one role, name finds a person. Emails are not in list rows — use jazzhr_get_applicant for full contact details.",
      inputSchema: z.object({
        jobId: z
          .string()
          .optional()
          .describe("Job id (from jazzhr_list_jobs) to scope to one role."),
        name: z.string().optional().describe("Filter by applicant name."),
        page: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.jazzhrToken) return { error: notConnected("JazzHR") };
        return jazzhrAdapter.listApplicants(ctx.jazzhrToken, args);
      },
    }),

    jazzhr_get_applicant: tool({
      description:
        "Get one JazzHR applicant's full details — email, phone, address, apply date — by applicant id (from jazzhr_list_applicants).",
      inputSchema: z.object({
        applicantId: z.string().describe("Applicant id."),
      }),
      execute: async ({ applicantId }) => {
        if (!ctx.jazzhrToken) return { error: notConnected("JazzHR") };
        return jazzhrAdapter.getApplicant(ctx.jazzhrToken, applicantId);
      },
    }),

    jobadder_list_jobs: tool({
      description:
        "List jobs in the connected JobAdder ATS (title, company, contact, status, job id). Pass title to filter by job title; set activeOnly for open roles; page with offset.",
      inputSchema: z.object({
        title: z.string().optional().describe("Filter by job title."),
        activeOnly: z
          .boolean()
          .optional()
          .describe("Only return active jobs."),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.jobadderToken) return { error: notConnected("JobAdder") };
        return jobadderAdapter.listJobs(ctx.jobadderToken, args);
      },
    }),

    jobadder_search_candidates: tool({
      description:
        "Search candidates in the connected JobAdder ATS as a Markdown table (name, email, phone, location, status). Filters combine: name, email, or keywords (skills/CV text); page with offset.",
      inputSchema: z.object({
        name: z.string().optional().describe("Search by candidate name."),
        email: z.string().optional().describe("Find a candidate by email."),
        keywords: z
          .string()
          .optional()
          .describe("Keyword search across candidate records."),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.jobadderToken) return { error: notConnected("JobAdder") };
        return jobadderAdapter.searchCandidates(ctx.jobadderToken, args);
      },
    }),

    jobadder_list_job_applications: tool({
      description:
        "List one JobAdder job's applications with each candidate's details and stage. Get the jobId from jobadder_list_jobs; set activeOnly to skip rejected/withdrawn applications.",
      inputSchema: z.object({
        jobId: z.number().int().describe("Job id from jobadder_list_jobs."),
        activeOnly: z
          .boolean()
          .optional()
          .describe("Only return active applications."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.jobadderToken) return { error: notConnected("JobAdder") };
        return jobadderAdapter.listJobApplications(ctx.jobadderToken, args);
      },
    }),

    lever_list_postings: tool({
      description:
        "List job postings in the connected Lever ATS (title, state, team, location, posting id). Filter by state, e.g. published. Use to find the role you are sourcing for.",
      inputSchema: z.object({
        state: z
          .string()
          .optional()
          .describe("Posting state filter, e.g. published, internal, closed."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.leverToken) return { error: notConnected("Lever") };
        return leverAdapter.listPostings(ctx.leverToken, args);
      },
    }),

    lever_list_opportunities: tool({
      description:
        "List candidates (opportunities) in the connected Lever ATS as a Markdown table (name, headline, email, phone, stage). Filters combine: postingId scopes to one role's pipeline, email finds a specific person.",
      inputSchema: z.object({
        postingId: z
          .string()
          .optional()
          .describe("Posting id (from lever_list_postings) to scope to one role."),
        email: z.string().optional().describe("Find a candidate by email."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.leverToken) return { error: notConnected("Lever") };
        return leverAdapter.listOpportunities(ctx.leverToken, args);
      },
    }),

    instantly_list_campaigns: tool({
      description:
        "List cold-email campaigns in the connected Instantly.ai workspace (name, status, campaign id). search filters by name; paginate by passing the startingAfter cursor from the previous page.",
      inputSchema: z.object({
        search: z.string().optional().describe("Filter campaigns by name."),
        startingAfter: z
          .string()
          .optional()
          .describe("Cursor from the previous page."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.instantlyToken) return { error: notConnected("Instantly.ai") };
        return instantlyAdapter.listCampaigns(ctx.instantlyToken, args);
      },
    }),

    instantly_list_leads: tool({
      description:
        "List leads in the connected Instantly.ai workspace as a Markdown table (name, email, company, status, reply count). Filters combine: campaignId scopes to one campaign (from instantly_list_campaigns), search matches name/email; paginate with the startingAfter cursor.",
      inputSchema: z.object({
        campaignId: z
          .string()
          .optional()
          .describe("Campaign id to scope to one campaign."),
        search: z.string().optional().describe("Search by name or email."),
        startingAfter: z
          .string()
          .optional()
          .describe("Cursor from the previous page."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.instantlyToken) return { error: notConnected("Instantly.ai") };
        return instantlyAdapter.listLeads(ctx.instantlyToken, args);
      },
    }),

    lemlist_list_campaigns: tool({
      description:
        "List outreach campaigns in the connected lemlist account (name, status, errors, campaign id). Filter by status: running, draft, paused, ended, archived, errors.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Campaign status filter, e.g. running."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.lemlistToken) return { error: notConnected("lemlist") };
        return lemlistAdapter.listCampaigns(ctx.lemlistToken, args);
      },
    }),

    lemlist_list_activities: tool({
      description:
        "List recent lemlist outreach activity (emails sent/opened/clicked/replied, per lead and campaign). Filter by campaignId and/or type (e.g. emailsReplied, emailsOpened, emailsSent) to report on campaign performance.",
      inputSchema: z.object({
        campaignId: z
          .string()
          .optional()
          .describe("Campaign id (from lemlist_list_campaigns)."),
        type: z
          .string()
          .optional()
          .describe("Activity type, e.g. emailsReplied, emailsOpened, emailsSent."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.lemlistToken) return { error: notConnected("lemlist") };
        return lemlistAdapter.listActivities(ctx.lemlistToken, args);
      },
    }),

    lemlist_add_lead: tool({
      description:
        "Add a lead to a lemlist outreach campaign. CAUTION: if the campaign is running, lemlist will start sending real outreach emails to this person — only add leads the user explicitly asked to enroll, and never enroll in bulk without instruction. Deduplicates by email across campaigns by default. Provide firstName/lastName/companyName so the sequence's personalisation variables resolve.",
      inputSchema: z.object({
        campaignId: z
          .string()
          .describe("Target campaign id (from lemlist_list_campaigns)."),
        email: z.string().describe("The lead's email address."),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        companyName: z.string().optional(),
        jobTitle: z.string().optional(),
        linkedinUrl: z.string().optional(),
        companyDomain: z.string().optional(),
        icebreaker: z
          .string()
          .optional()
          .describe("Personalised opening line, if the sequence uses one."),
        deduplicate: z
          .boolean()
          .optional()
          .describe("Skip if the email already exists in any campaign (default true)."),
      }),
      execute: async (args) => {
        if (!ctx.lemlistToken) return { error: notConnected("lemlist") };
        return lemlistAdapter.addLead(ctx.lemlistToken, args);
      },
    }),

    manatal_list_jobs: tool({
      description:
        "List jobs in the connected Manatal ATS (position, status, location, job id). Filter by positionName and/or status. Use to find the role you are sourcing for.",
      inputSchema: z.object({
        positionName: z
          .string()
          .optional()
          .describe("Filter by position name."),
        status: z.string().optional().describe("Filter by job status."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.manatalToken) return { error: notConnected("Manatal") };
        return manatalAdapter.listJobs(ctx.manatalToken, args);
      },
    }),

    manatal_search_candidates: tool({
      description:
        "Search candidates in the connected Manatal ATS by name, email, current company, or current position (the list endpoint is the search — filters combine). Omit all filters to list recent candidates.",
      inputSchema: z.object({
        fullName: z.string().optional(),
        email: z.string().optional(),
        company: z.string().optional().describe("Current company filter."),
        position: z.string().optional().describe("Current position/title filter."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.manatalToken) return { error: notConnected("Manatal") };
        return manatalAdapter.searchCandidates(ctx.manatalToken, args);
      },
    }),

    manatal_list_job_candidates: tool({
      description:
        "List a Manatal job's pipeline (matches) with each candidate's details and stage as a Markdown table. Get the jobId from manatal_list_jobs first. Max 25 candidates per call.",
      inputSchema: z.object({
        jobId: z.string().describe("Job id (from manatal_list_jobs)."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.manatalToken) return { error: notConnected("Manatal") };
        return manatalAdapter.listJobCandidates(ctx.manatalToken, args);
      },
    }),

    excel_list_workbooks: tool({
      description:
        "List the Excel workbooks (.xlsx/.xlsm) the connected Microsoft account can reach in OneDrive/SharePoint (name, folder, modified, item id). Pass query to search by file name.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Search workbooks by name; omit to list recent .xlsx files."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.microsoftExcelToken)
          return { error: notConnected("Microsoft Excel") };
        return microsoftExcelAdapter.listWorkbooks(ctx.microsoftExcelToken, args);
      },
    }),

    excel_list_worksheets: tool({
      description:
        "List the worksheet tabs of one Excel workbook. Get the itemId from excel_list_workbooks.",
      inputSchema: z.object({
        itemId: z.string().describe("Drive item id from excel_list_workbooks."),
      }),
      execute: async ({ itemId }) => {
        if (!ctx.microsoftExcelToken)
          return { error: notConnected("Microsoft Excel") };
        return microsoftExcelAdapter.listWorksheets(ctx.microsoftExcelToken, itemId);
      },
    }),

    excel_read_range: tool({
      description:
        "Read rows from an Excel worksheet as a Markdown table (the first row is treated as the header). Omit address to read the sheet's used range; pass an A1 block like A1:F50 to read part of a large sheet.",
      inputSchema: z.object({
        itemId: z.string().describe("Drive item id from excel_list_workbooks."),
        worksheet: z
          .string()
          .describe("Worksheet name from excel_list_worksheets."),
        address: z
          .string()
          .optional()
          .describe("A1 block, e.g. A1:F50; omit for the used range."),
        maxRows: z.number().int().positive().optional().describe("Max 200."),
      }),
      execute: async (args) => {
        if (!ctx.microsoftExcelToken)
          return { error: notConnected("Microsoft Excel") };
        return microsoftExcelAdapter.readRange(ctx.microsoftExcelToken, args);
      },
    }),

    outlook_send_email: tool({
      description:
        "Send a plain-text email from the user's connected Outlook / Microsoft 365 mailbox. Use ONLY for outreach the task explicitly asks for, to addresses found in the connected data — never to invented addresses. One recipient per call.",
      inputSchema: z.object({
        to: z.string().email().describe("Recipient email address."),
        subject: z.string().min(1).max(200),
        body: z.string().min(1).max(10_000).describe("Plain-text message body."),
        cc: z.string().email().optional(),
      }),
      execute: async (args) => {
        if (!ctx.microsoftOutlookToken)
          return { error: notConnected("Microsoft Outlook") };
        await microsoftOutlookAdapter.sendEmail(ctx.microsoftOutlookToken, args);
        return { sent: true, to: args.to };
      },
    }),

    monday_list_boards: tool({
      description:
        "List boards in the connected monday.com account (name, workspace, kind, item count, board id), sorted by recent use. Use to find the candidate or client tracker you need; page with page.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.mondayToken) return { error: notConnected("monday.com") };
        return mondayAdapter.listBoards(ctx.mondayToken, args);
      },
    }),

    monday_list_items: tool({
      description:
        "Read one monday.com board's items as a Markdown table whose columns come from the board itself (first 8 columns). Get the boardId from monday_list_boards; page large boards with the cursor the previous call returned.",
      inputSchema: z.object({
        boardId: z.string().describe("Board id from monday_list_boards."),
        cursor: z
          .string()
          .optional()
          .describe("Cursor from the previous monday_list_items call."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.mondayToken) return { error: notConnected("monday.com") };
        return mondayAdapter.listItems(ctx.mondayToken, args);
      },
    }),

    notion_search: tool({
      description:
        "Search the connected Notion workspace by keyword for databases and pages (title, type, last edited, id). Set databasesOnly to find trackers to query; omit query to list what the connection can reach.",
      inputSchema: z.object({
        query: z.string().optional().describe("Keyword to search titles for."),
        databasesOnly: z
          .boolean()
          .optional()
          .describe("Only return databases."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.notionToken) return { error: notConnected("Notion") };
        return notionAdapter.search(ctx.notionToken, args);
      },
    }),

    notion_query_database: tool({
      description:
        "Read one Notion database's rows as a Markdown table whose columns come from the database itself (first 8, title first). Get the databaseId from notion_search; page large databases with the cursor the previous call returned.",
      inputSchema: z.object({
        databaseId: z.string().describe("Database id from notion_search."),
        cursor: z
          .string()
          .optional()
          .describe("Cursor from the previous notion_query_database call."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.notionToken) return { error: notConnected("Notion") };
        return notionAdapter.queryDatabase(ctx.notionToken, args);
      },
    }),

    notion_read_page: tool({
      description:
        "Read one Notion page in full: its property values plus the page body as plain text. Get the pageId from notion_search or a notion_query_database row.",
      inputSchema: z.object({
        pageId: z.string().describe("Page id."),
      }),
      execute: async ({ pageId }) => {
        if (!ctx.notionToken) return { error: notConnected("Notion") };
        return notionAdapter.readPage(ctx.notionToken, pageId);
      },
    }),

    lusha_search_person: tool({
      description:
        "Look up a person in Lusha's B2B contact database — by LinkedIn URL, email, or firstName+lastName plus companyName/companyDomain. Returns a free preview: who matched, which data points exist, what each reveal costs in credits, and the contact id. Does NOT reveal emails/phones — use lusha_enrich_contacts with the contact id for that.",
      inputSchema: z.object({
        linkedinUrl: z.string().optional().describe("LinkedIn profile URL (preferred)."),
        email: z.string().optional().describe("A known email of theirs."),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        companyName: z.string().optional(),
        companyDomain: z.string().optional().describe("e.g. acme.com."),
      }),
      execute: async (args) => {
        if (!ctx.lushaToken) return { error: notConnected("Lusha") };
        return lushaAdapter.searchPerson(ctx.lushaToken, args);
      },
    }),

    lusha_enrich_contacts: tool({
      description:
        "Reveal emails and phone numbers for Lusha contacts found via lusha_search_person. COSTS credits per revealed data point (the search preview shows the price) — only enrich people you actually intend to contact, max 10 ids per call.",
      inputSchema: z.object({
        ids: z
          .array(z.string())
          .describe("Contact ids from lusha_search_person results."),
        reveal: z
          .array(z.enum(["emails", "phones"]))
          .optional()
          .describe("Data points to reveal (defaults to both)."),
      }),
      execute: async (args) => {
        if (!ctx.lushaToken) return { error: notConnected("Lusha") };
        return lushaAdapter.enrichContacts(ctx.lushaToken, args);
      },
    }),

    pinpoint_list_jobs: tool({
      description:
        "List jobs in the connected Pinpoint ATS (title, status, visibility, workplace type, job id). Paginate with page; no server-side filters.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.pinpointToken) return { error: notConnected("Pinpoint") };
        return pinpointAdapter.listJobs(ctx.pinpointToken, args);
      },
    }),

    pinpoint_list_candidates: tool({
      description:
        "List candidates in the connected Pinpoint ATS as a Markdown table (name, email, phone). No server-side search — paginate with page and scan; be economical.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.pinpointToken) return { error: notConnected("Pinpoint") };
        return pinpointAdapter.listCandidates(ctx.pinpointToken, args);
      },
    }),

    peopledatalabs_enrich_person: tool({
      description:
        "Resolve one person via People Data Labs from an email, a LinkedIn profile URL, or a name plus a company or location anchor. Returns title, company, work email, personal emails, phones, LinkedIn, and a 0-10 match likelihood. Costs a credit only when a match is found — enrich selectively, never in bulk.",
      inputSchema: z.object({
        email: z.string().optional().describe("A known email address."),
        profile: z.string().optional().describe("LinkedIn profile URL."),
        name: z.string().optional().describe("Full name."),
        company: z.string().optional().describe("Current employer name."),
        location: z.string().optional().describe("Location anchor."),
        minLikelihood: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Minimum 0-10 match confidence to accept (default none)."),
      }),
      execute: async (args) => {
        if (!ctx.peopledatalabsToken)
          return { error: notConnected("People Data Labs") };
        return peopledatalabsAdapter.enrichPerson(
          ctx.peopledatalabsToken,
          args,
        );
      },
    }),

    peopledatalabs_search_people: tool({
      description:
        "Search People Data Labs' person dataset with SQL: SELECT * FROM person WHERE job_title = 'recruiter' AND location_country = 'germany'. Useful fields: job_title, job_company_name, location_country, location_locality, skills. EVERY returned record costs a credit — keep size small (default 5) and filter tightly before searching.",
      inputSchema: z.object({
        sql: z
          .string()
          .describe(
            "SQL of the form SELECT * FROM person WHERE … (LIMIT is ignored; use size).",
          ),
        size: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Records to return (each is billed). Max 25."),
      }),
      execute: async (args) => {
        if (!ctx.peopledatalabsToken)
          return { error: notConnected("People Data Labs") };
        return peopledatalabsAdapter.searchPeople(
          ctx.peopledatalabsToken,
          args,
        );
      },
    }),

    pipedrive_search_persons: tool({
      description:
        "Search persons in the connected Pipedrive CRM by name, email, or phone (term must be 2+ characters). Returns name, email, phone, and organization.",
      inputSchema: z.object({
        term: z.string().describe("Search term, e.g. a name or email."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.pipedriveToken) return { error: notConnected("Pipedrive") };
        return pipedriveAdapter.searchPersons(ctx.pipedriveToken, args);
      },
    }),

    pipedrive_search_organizations: tool({
      description:
        "Search organizations in the connected Pipedrive CRM by name (term must be 2+ characters). Returns organization name and address.",
      inputSchema: z.object({
        term: z.string().describe("Search term, e.g. a company name."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.pipedriveToken) return { error: notConnected("Pipedrive") };
        return pipedriveAdapter.searchOrganizations(ctx.pipedriveToken, args);
      },
    }),

    pipedrive_search_deals: tool({
      description:
        "Search deals in the connected Pipedrive CRM by title (term must be 2+ characters). Returns deal title, value, status, and the linked organization/person.",
      inputSchema: z.object({
        term: z.string().describe("Search term, e.g. a deal or client name."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.pipedriveToken) return { error: notConnected("Pipedrive") };
        return pipedriveAdapter.searchDeals(ctx.pipedriveToken, args);
      },
    }),

    recruitee_list_offers: tool({
      description:
        "List jobs (offers) in the connected Recruitee ATS (title, status, department, location, offer id). Use to find the role you are sourcing for.",
      inputSchema: z.object({
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.recruiteeToken) return { error: notConnected("Recruitee") };
        return recruiteeAdapter.listOffers(ctx.recruiteeToken, args);
      },
    }),

    recruitee_list_candidates: tool({
      description:
        "List candidates in the connected Recruitee ATS as a Markdown table (name, email, phone, positions). Filters combine: query searches by name/email, offerId scopes to one job's pipeline (from recruitee_list_offers).",
      inputSchema: z.object({
        query: z.string().optional().describe("Search by name or email."),
        offerId: z
          .string()
          .optional()
          .describe("Offer id to scope to one job's pipeline."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.recruiteeToken) return { error: notConnected("Recruitee") };
        return recruiteeAdapter.listCandidates(ctx.recruiteeToken, args);
      },
    }),

    recruiterflow_list_jobs: tool({
      description:
        "List jobs in the connected Recruiterflow ATS (name, status, client company, location, job id). Set openOnly for live roles; paginate with page.",
      inputSchema: z.object({
        openOnly: z.boolean().optional().describe("Only open jobs."),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.recruiterflowToken)
          return { error: notConnected("Recruiterflow") };
        return recruiterflowAdapter.listJobs(ctx.recruiterflowToken, args);
      },
    }),

    recruiterflow_list_candidates: tool({
      description:
        "List candidates in the connected Recruiterflow ATS as a Markdown table (name, email, phone, title, company). No server-side search — paginate with page and scan; be economical.",
      inputSchema: z.object({
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.recruiterflowToken)
          return { error: notConnected("Recruiterflow") };
        return recruiterflowAdapter.listCandidates(ctx.recruiterflowToken, args);
      },
    }),

    recruitis_list_jobs: tool({
      description:
        "List jobs in the connected Recruitis ATS (title, status, location, salary, recruiter, job id). Set activeOnly for live roles; paginate with page (max 50 per page).",
      inputSchema: z.object({
        activeOnly: z.boolean().optional().describe("Only active jobs."),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.recruitisToken) return { error: notConnected("Recruitis") };
        return recruitisAdapter.listJobs(ctx.recruitisToken, args);
      },
    }),

    recruitis_list_candidates: tool({
      description:
        "List candidates (job applications) in the connected Recruitis ATS as a Markdown table (name, email, phone, job, pipeline stage, applied date, candidate id). Scope to one job's pipeline with jobId (from recruitis_list_jobs); paginate with page (max 50 per page).",
      inputSchema: z.object({
        jobId: z
          .string()
          .optional()
          .describe("Job id to scope to one job's pipeline."),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.recruitisToken) return { error: notConnected("Recruitis") };
        return recruitisAdapter.listCandidates(ctx.recruitisToken, args);
      },
    }),

    snov_find_email: tool({
      description:
        "Find a person's work email via Snov.io from their first name, last name, and company domain. Costs a credit. May return a pending task — finish it with snov_get_task_result.",
      inputSchema: z.object({
        firstName: z.string().describe("First name."),
        lastName: z.string().describe("Last name."),
        domain: z.string().describe("Company domain, e.g. acme.com."),
      }),
      execute: async (args) => {
        if (!ctx.snovToken) return { error: notConnected("Snov.io") };
        return snovAdapter.findEmail(ctx.snovToken, args);
      },
    }),

    snov_verify_email: tool({
      description:
        "Verify one email's deliverability via Snov.io (SMTP status, disposability). May return a pending task — finish it with snov_get_task_result.",
      inputSchema: z.object({
        email: z.string().describe("The email address to verify."),
      }),
      execute: async (args) => {
        if (!ctx.snovToken) return { error: notConnected("Snov.io") };
        return snovAdapter.verifyEmail(ctx.snovToken, args);
      },
    }),

    snov_get_task_result: tool({
      description:
        "Fetch the finished result of a pending Snov.io finder or verifier task (use the task hash the starting tool returned). Free to call.",
      inputSchema: z.object({
        type: z.enum(["finder", "verifier"]).describe("Which task type."),
        taskHash: z.string().describe("Task hash from the starting tool."),
      }),
      execute: async (args) => {
        if (!ctx.snovToken) return { error: notConnected("Snov.io") };
        return snovAdapter.getTaskResult(ctx.snovToken, args);
      },
    }),

    snov_get_profile: tool({
      description:
        "Look up the public profile behind an email via Snov.io (name, current position, social links). Useful to qualify an address before outreach.",
      inputSchema: z.object({
        email: z.string().describe("The email address to profile."),
      }),
      execute: async (args) => {
        if (!ctx.snovToken) return { error: notConnected("Snov.io") };
        return snovAdapter.getProfileByEmail(ctx.snovToken, args);
      },
    }),

    replyio_list_sequences: tool({
      description:
        "List outreach sequences in the connected Reply.io account as a Markdown table (name, status, health, created, sequence id). Filter by status (new, active, paused); page with skip.",
      inputSchema: z.object({
        status: z
          .enum(["new", "active", "paused"])
          .optional()
          .describe("Filter by sequence status."),
        skip: z.number().int().nonnegative().optional().describe("Offset for paging."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.replyioToken) return { error: notConnected("Reply.io") };
        return replyioAdapter.listSequences(ctx.replyioToken, args);
      },
    }),

    replyio_list_contacts: tool({
      description:
        "List contacts in the connected Reply.io account as a Markdown table (name, email, company, title, phone, LinkedIn, contact id). Pass email to look up one contact; page with skip.",
      inputSchema: z.object({
        email: z.string().optional().describe("Look up a contact by email."),
        skip: z.number().int().nonnegative().optional().describe("Offset for paging."),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.replyioToken) return { error: notConnected("Reply.io") };
        return replyioAdapter.listContacts(ctx.replyioToken, args);
      },
    }),

    smartlead_list_campaigns: tool({
      description:
        "List cold-email campaigns in the connected Smartlead account (name, status, created date, campaign id). Statuses: DRAFTED, ACTIVE, PAUSED, STOPPED, ARCHIVED.",
      inputSchema: z.object({
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.smartleadToken) return { error: notConnected("Smartlead") };
        return smartleadAdapter.listCampaigns(ctx.smartleadToken, args);
      },
    }),

    smartlead_list_leads: tool({
      description:
        "List leads in one Smartlead campaign as a Markdown table (name, email, company, status, opens, replies). Get the campaignId from smartlead_list_campaigns; page with offset.",
      inputSchema: z.object({
        campaignId: z
          .string()
          .describe("Campaign id from smartlead_list_campaigns."),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.smartleadToken) return { error: notConnected("Smartlead") };
        return smartleadAdapter.listLeads(ctx.smartleadToken, args);
      },
    }),

    smartlead_campaign_analytics: tool({
      description:
        "Aggregate performance metrics for one Smartlead campaign (sent, opens, clicks, replies, bounces, unsubscribes). Get the campaignId from smartlead_list_campaigns.",
      inputSchema: z.object({
        campaignId: z
          .string()
          .describe("Campaign id from smartlead_list_campaigns."),
      }),
      execute: async (args) => {
        if (!ctx.smartleadToken) return { error: notConnected("Smartlead") };
        return smartleadAdapter.campaignAnalytics(ctx.smartleadToken, args);
      },
    }),

    rocketreach_search_people: tool({
      description:
        "Search RocketReach profiles by name, titles, employers, or locations. Returns name, title, company, LinkedIn, and profile id — no contact details and no credit cost. Treat results as candidates for rocketreach_lookup_person.",
      inputSchema: z.object({
        name: z.string().optional().describe("Person name."),
        titles: z.array(z.string()).optional().describe("Job titles."),
        employers: z.array(z.string()).optional().describe("Company names."),
        locations: z.array(z.string()).optional().describe("Locations."),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional().describe("Max 25."),
      }),
      execute: async (args) => {
        if (!ctx.rocketreachToken) return { error: notConnected("RocketReach") };
        return rocketreachAdapter.searchPeople(ctx.rocketreachToken, args);
      },
    }),

    rocketreach_lookup_person: tool({
      description:
        "Reveal a person's emails and phones via RocketReach from a profileId (from rocketreach_search_people), an email, a LinkedIn URL, or a name plus currentEmployer. Costs a credit per match — look up selectively, never in bulk. May return an in-progress status; finish with rocketreach_check_lookup.",
      inputSchema: z.object({
        profileId: z
          .number()
          .int()
          .optional()
          .describe("Profile id from rocketreach_search_people."),
        name: z.string().optional().describe("Full name."),
        currentEmployer: z
          .string()
          .optional()
          .describe("Current employer (required with name)."),
        email: z.string().optional().describe("A known email address."),
        linkedinUrl: z.string().optional().describe("LinkedIn profile URL."),
      }),
      execute: async (args) => {
        if (!ctx.rocketreachToken) return { error: notConnected("RocketReach") };
        return rocketreachAdapter.lookupPerson(ctx.rocketreachToken, args);
      },
    }),

    rocketreach_check_lookup: tool({
      description:
        "Fetch the finished result of a RocketReach lookup that was still in progress (use the profile id rocketreach_lookup_person returned). Free to call.",
      inputSchema: z.object({
        profileId: z
          .number()
          .int()
          .describe("Profile id from the in-progress lookup."),
      }),
      execute: async ({ profileId }) => {
        if (!ctx.rocketreachToken) return { error: notConnected("RocketReach") };
        return rocketreachAdapter.checkLookup(ctx.rocketreachToken, profileId);
      },
    }),

    signalhire_search_people: tool({
      description:
        "Search SignalHire profiles by title, company, location, or keywords. Returns name, title, company, location, and profile UID — no contact details. Free of credit cost (draws from a daily search quota); treat results as candidates for signalhire_enrich_person.",
      inputSchema: z.object({
        title: z.string().optional().describe("Current job title to match."),
        company: z.string().optional().describe("Current company to match."),
        location: z
          .string()
          .optional()
          .describe("City, state, or country to match."),
        keywords: z
          .string()
          .optional()
          .describe("Skills or other profile keywords."),
        limit: z.number().int().positive().optional().describe("Max 25."),
      }),
      execute: async (args) => {
        if (!ctx.signalhireToken) return { error: notConnected("SignalHire") };
        return signalhireAdapter.searchPeople(ctx.signalhireToken, args);
      },
    }),

    signalhire_enrich_person: tool({
      description:
        "Reveal a person's emails and phones via SignalHire from a LinkedIn profile URL, an email, a phone number, or a profile UID (from signalhire_search_people). Costs a credit per successful match — enrich selectively, never in bulk.",
      inputSchema: z.object({
        identifier: z
          .string()
          .describe(
            "LinkedIn profile URL, email, phone number, or SignalHire profile UID.",
          ),
      }),
      execute: async (args) => {
        if (!ctx.signalhireToken) return { error: notConnected("SignalHire") };
        return signalhireAdapter.enrichPerson(ctx.signalhireToken, args);
      },
    }),

    smartrecruiters_list_jobs: tool({
      description:
        "List jobs in the connected SmartRecruiters ATS (title, status, department, location, job id). Optionally filter by status (e.g. SOURCING, OFFER, FILLED). Use to find the role you are sourcing for — the job id scopes candidate lookups.",
      inputSchema: z.object({
        status: z.string().optional().describe("Job status filter."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.smartrecruitersToken)
          return { error: notConnected("SmartRecruiters") };
        return smartrecruitersAdapter.listJobs(ctx.smartrecruitersToken, args);
      },
    }),

    smartrecruiters_list_candidates: tool({
      description:
        "List candidates in the connected SmartRecruiters ATS as a Markdown table (name, email, phone, location, stage, job). Filters combine: query searches by name/email, jobId scopes to one job's pipeline (from smartrecruiters_list_jobs).",
      inputSchema: z.object({
        query: z.string().optional().describe("Search by name or email."),
        jobId: z
          .string()
          .optional()
          .describe("Job id to scope to one role's pipeline."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.smartrecruitersToken)
          return { error: notConnected("SmartRecruiters") };
        return smartrecruitersAdapter.listCandidates(
          ctx.smartrecruitersToken,
          args,
        );
      },
    }),

    teamtailor_list_jobs: tool({
      description:
        "List jobs in the connected Teamtailor ATS (title, status, remote status, job id). Filter by status: published, draft, archived, scheduled, internal.",
      inputSchema: z.object({
        status: z.string().optional().describe("Job status filter."),
        limit: z.number().int().positive().optional().describe("Max 30."),
      }),
      execute: async (args) => {
        if (!ctx.teamtailorToken) return { error: notConnected("Teamtailor") };
        return teamtailorAdapter.listJobs(ctx.teamtailorToken, args);
      },
    }),

    teamtailor_list_candidates: tool({
      description:
        "List candidates in the connected Teamtailor ATS as a Markdown table (name, email, phone, pitch). Pass email to find a specific person; omit filters to list recent candidates.",
      inputSchema: z.object({
        email: z.string().optional().describe("Find a candidate by email."),
        limit: z.number().int().positive().optional().describe("Max 30."),
      }),
      execute: async (args) => {
        if (!ctx.teamtailorToken) return { error: notConnected("Teamtailor") };
        return teamtailorAdapter.listCandidates(ctx.teamtailorToken, args);
      },
    }),

    teamtailor_list_job_candidates: tool({
      description:
        "List the candidates who applied to a Teamtailor job as a Markdown table. Get the jobId from teamtailor_list_jobs first.",
      inputSchema: z.object({
        jobId: z.string().describe("Job id (from teamtailor_list_jobs)."),
        limit: z.number().int().positive().optional().describe("Max 30."),
      }),
      execute: async (args) => {
        if (!ctx.teamtailorToken) return { error: notConnected("Teamtailor") };
        return teamtailorAdapter.listJobApplications(ctx.teamtailorToken, args);
      },
    }),

    tldv_list_meetings: tool({
      description:
        "List meetings recorded by the connected tl;dv notetaker (name, date, duration, organizer, invitees, meeting id). query searches meeting names; paginate with page.",
      inputSchema: z.object({
        query: z.string().optional().describe("Search meeting names."),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional().describe("Max 50."),
      }),
      execute: async (args) => {
        if (!ctx.tldvToken) return { error: notConnected("tl;dv") };
        return tldvAdapter.listMeetings(ctx.tldvToken, args);
      },
    }),

    tldv_get_notes: tool({
      description:
        "Read the AI notes of one tl;dv meeting (markdown with per-topic summaries). Get the meetingId from tldv_list_meetings. Prefer this before the transcript.",
      inputSchema: z.object({
        meetingId: z.string().describe("Meeting id from tldv_list_meetings."),
      }),
      execute: async ({ meetingId }) => {
        if (!ctx.tldvToken) return { error: notConnected("tl;dv") };
        return tldvAdapter.getNotes(ctx.tldvToken, meetingId);
      },
    }),

    tldv_get_transcript: tool({
      description:
        "Read the speaker-attributed transcript of one tl;dv meeting, truncated if very long. Get the meetingId from tldv_list_meetings. Pull this when you need exact quotes or detail beyond the notes.",
      inputSchema: z.object({
        meetingId: z.string().describe("Meeting id from tldv_list_meetings."),
      }),
      execute: async ({ meetingId }) => {
        if (!ctx.tldvToken) return { error: notConnected("tl;dv") };
        return tldvAdapter.getTranscript(ctx.tldvToken, meetingId);
      },
    }),

    workable_list_jobs: tool({
      description:
        "List jobs in the connected Workable ATS (title, state, department, location, shortcode). Filter by state: draft, published, closed, archived. Use to find the role you are sourcing for — the shortcode scopes candidate lookups.",
      inputSchema: z.object({
        state: z
          .string()
          .optional()
          .describe("Job state filter: draft, published, closed, archived."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.workableToken) return { error: notConnected("Workable") };
        return workableAdapter.listJobs(ctx.workableToken, args);
      },
    }),

    workable_list_candidates: tool({
      description:
        "List candidates in the connected Workable ATS as a Markdown table (name, email, phone, headline, stage, job). Filters combine: shortcode (a job's pipeline, from workable_list_jobs), stage, and email (find a specific person).",
      inputSchema: z.object({
        shortcode: z
          .string()
          .optional()
          .describe("Job shortcode to scope to one role's pipeline."),
        stage: z.string().optional().describe("Stage slug filter."),
        email: z.string().optional().describe("Find a candidate by email."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.workableToken) return { error: notConnected("Workable") };
        return workableAdapter.listCandidates(ctx.workableToken, args);
      },
    }),

    wiza_reveal: tool({
      description:
        "Reveal a contact's verified email and mobile number via Wiza. Provide a LinkedIn profile URL, OR an email, OR a fullName with a company or domain. Asynchronous: this returns a reveal id; read the result with wiza_get_result after a few seconds.",
      inputSchema: z.object({
        linkedinUrl: z.string().optional().describe("LinkedIn profile URL (best input)."),
        email: z.string().optional().describe("A known email to enrich."),
        fullName: z.string().optional(),
        company: z.string().optional().describe("Company name."),
        domain: z.string().optional().describe("Company website or domain."),
      }),
      execute: async (args) => {
        if (!ctx.wizaToken) return { error: notConnected("Wiza") };
        return wizaAdapter.reveal(ctx.wizaToken, args);
      },
    }),

    wiza_get_result: tool({
      description:
        "Read the result of a Wiza reveal using the reveal id returned by wiza_reveal. May report the reveal is still running — if so, call again after working on something else for a moment.",
      inputSchema: z.object({
        revealId: z.string().describe("Reveal id from wiza_reveal."),
      }),
      execute: async (args) => {
        if (!ctx.wizaToken) return { error: notConnected("Wiza") };
        return wizaAdapter.getResult(ctx.wizaToken, args);
      },
    }),

    woodpecker_list_campaigns: tool({
      description:
        "List campaigns in the connected Woodpecker account (name, status, created, folder, daily limit, campaign id). Optionally filter by comma-separated statuses: RUNNING, DRAFT, EDITED, PAUSED, STOPPED, COMPLETED.",
      inputSchema: z.object({
        status: z
          .string()
          .optional()
          .describe("Comma-separated status filter, e.g. RUNNING,PAUSED."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.woodpeckerToken) return { error: notConnected("Woodpecker") };
        return woodpeckerAdapter.listCampaigns(ctx.woodpeckerToken, args);
      },
    }),

    woodpecker_list_prospects: tool({
      description:
        "List prospects in the connected Woodpecker account as a Markdown table (name, email, company, title, status, last contacted/replied). Filters combine: email or company (find specific prospects), campaignId (one campaign's prospects), status (ACTIVE, BOUNCED, REPLIED, BLACKLIST, INVALID), interested (INTERESTED, MAYBE-LATER, NOT-INTERESTED, NOT-MARKED). Page with page.",
      inputSchema: z.object({
        email: z.string().optional().describe("Find a prospect by email."),
        company: z.string().optional().describe("Filter by company name."),
        status: z
          .string()
          .optional()
          .describe("Global status filter, e.g. REPLIED."),
        campaignId: z
          .number()
          .int()
          .optional()
          .describe("Campaign id from woodpecker_list_campaigns."),
        interested: z
          .string()
          .optional()
          .describe("Interest filter, e.g. INTERESTED."),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional().describe("Max 200."),
      }),
      execute: async (args) => {
        if (!ctx.woodpeckerToken) return { error: notConnected("Woodpecker") };
        return woodpeckerAdapter.listProspects(ctx.woodpeckerToken, args);
      },
    }),

    woodpecker_campaign_stats: tool({
      description:
        "Aggregate performance statistics for one Woodpecker campaign (sent, opens, replies, bounces). Get the campaignId from woodpecker_list_campaigns.",
      inputSchema: z.object({
        campaignId: z
          .number()
          .int()
          .describe("Campaign id from woodpecker_list_campaigns."),
      }),
      execute: async (args) => {
        if (!ctx.woodpeckerToken) return { error: notConnected("Woodpecker") };
        return woodpeckerAdapter.campaignStats(ctx.woodpeckerToken, args);
      },
    }),

    zohocrm_search_contacts: tool({
      description:
        "Search contacts in the connected Zoho CRM by name, email, or other text (2+ characters). Returns name, email, phone, account, and title.",
      inputSchema: z.object({
        word: z.string().describe("Search text, e.g. a name or email."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.zohoCrmToken) return { error: notConnected("Zoho CRM") };
        return zohoCrmAdapter.searchContacts(ctx.zohoCrmToken, args);
      },
    }),

    zohocrm_search_accounts: tool({
      description:
        "Search accounts (companies) in the connected Zoho CRM by name (2+ characters). Returns account name, website, industry, and location.",
      inputSchema: z.object({
        word: z.string().describe("Search text, e.g. a company name."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.zohoCrmToken) return { error: notConnected("Zoho CRM") };
        return zohoCrmAdapter.searchAccounts(ctx.zohoCrmToken, args);
      },
    }),

    zohocrm_search_deals: tool({
      description:
        "Search deals in the connected Zoho CRM by name (2+ characters). Returns deal name, amount, stage, account, and closing date.",
      inputSchema: z.object({
        word: z.string().describe("Search text, e.g. a deal or client name."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.zohoCrmToken) return { error: notConnected("Zoho CRM") };
        return zohoCrmAdapter.searchDeals(ctx.zohoCrmToken, args);
      },
    }),

    zohorecruit_search_candidates: tool({
      description:
        "Search candidates in the connected Zoho Recruit ATS by name, email, or skill text (2+ characters). Returns name, email, phone, title, and city.",
      inputSchema: z.object({
        word: z.string().describe("Search text, e.g. a name, email, or skill."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.zohoRecruitToken)
          return { error: notConnected("Zoho Recruit") };
        return zohoRecruitAdapter.searchCandidates(ctx.zohoRecruitToken, args);
      },
    }),

    zohorecruit_search_job_openings: tool({
      description:
        "Search job openings in the connected Zoho Recruit ATS by title or client text (2+ characters). Returns posting title, client, status, city, and openings count.",
      inputSchema: z.object({
        word: z.string().describe("Search text, e.g. a role title or client."),
        limit: z.number().int().positive().optional(),
      }),
      execute: async (args) => {
        if (!ctx.zohoRecruitToken)
          return { error: notConnected("Zoho Recruit") };
        return zohoRecruitAdapter.searchJobOpenings(ctx.zohoRecruitToken, args);
      },
    }),

    zoom_list_recordings: tool({
      description:
        "List cloud recordings in the connected Zoom account as a Markdown table (topic, date, duration, whether a transcript exists, meeting uuid, link). Defaults to the last 30 days; narrow with fromDate/toDate (YYYY-MM-DD).",
      inputSchema: z.object({
        fromDate: z.string().optional().describe("Start date YYYY-MM-DD (defaults to 30 days ago)."),
        toDate: z.string().optional().describe("End date YYYY-MM-DD (defaults to today)."),
        pageSize: z.number().int().positive().optional().describe("Max 100."),
      }),
      execute: async (args) => {
        if (!ctx.zoomToken) return { error: notConnected("Zoom") };
        return zoomAdapter.listRecordings(ctx.zoomToken, args);
      },
    }),

    zoom_get_transcript: tool({
      description:
        "Read the transcript of one Zoom cloud recording, truncated if very long. Get the meetingUuid from zoom_list_recordings (only meetings whose Transcript? column says yes have one).",
      inputSchema: z.object({
        meetingUuid: z.string().describe("Meeting uuid from zoom_list_recordings."),
      }),
      execute: async (args) => {
        if (!ctx.zoomToken) return { error: notConnected("Zoom") };
        return zoomAdapter.getTranscript(ctx.zoomToken, args);
      },
    }),

    calyflow_create_document: tool({
      description:
        "Save a Markdown document into the current project (e.g. your final analysis/summary). Returns the new document id.",
      inputSchema: z.object({
        title: z.string().describe("Short document title."),
        content: z.string().describe("Markdown body."),
      }),
      execute: async ({ title, content }) => {
        const { data, error } = await db()
          .from("documents")
          .insert({
            scope_type: "project",
            scope_id: ctx.projectId,
            workspace_id: ctx.workspaceId,
            kind: "file",
            doc_type: "output",
            source: "agent",
            filename: title,
            extracted_text: content,
            created_by: ctx.userId,
          })
          .select("id")
          .single();
        if (error || !data) return { error: "Could not save the document." };
        ctx.createdDocIds.push(data.id as string);
        return { documentId: data.id, title };
      },
    }),
  };
}

/** Returns the AI SDK ToolSet for the agent's allowed tool names. */
export function buildTools(ctx: ToolContext, allowed: string[]): ToolSet {
  const all = buildAll(ctx);
  const set: ToolSet = {};
  for (const name of allowed) {
    if (all[name]) set[name] = all[name];
  }
  return set;
}

export const ALL_TOOL_NAMES = [
  "calyflow_search_documents",
  "calyflow_read_document",
  "airtable_list_bases",
  "airtable_list_tables",
  "airtable_query_records",
  "ashby_list_jobs",
  "ashby_list_candidates",
  "ashby_search_candidates",
  "attio_list_objects",
  "attio_query_records",
  "bamboohr_list_jobs",
  "bamboohr_list_applications",
  "breezyhr_list_positions",
  "breezyhr_list_candidates",
  "breezyhr_search_candidates",
  "hunter_domain_search",
  "hunter_email_finder",
  "hunter_email_verifier",
  "apollo_search_people",
  "apollo_enrich_person",
  "apollo_search_organizations",
  "brightdata_scrape_linkedin_profiles",
  "brightdata_scrape_linkedin_companies",
  "brightdata_get_snapshot",
  "bullhorn_list_jobs",
  "bullhorn_search_candidates",
  "bullhorn_list_job_submissions",
  "vincere_search_candidates",
  "vincere_search_companies",
  "vincere_search_contacts",
  "vincere_search_applications",
  "vincere_list_talent_pools",
  "cats_list_jobs",
  "cats_list_candidates",
  "close_search_leads",
  "close_list_opportunities",
  "crelate_list_jobs",
  "crelate_search_contacts",
  "crelate_list_contacts",
  "dropcontact_enrich",
  "dropcontact_get_result",
  "contactout_people_search",
  "contactout_linkedin_enrich",
  "contactout_person_enrich",
  "contactout_email_verify",
  "coresignal_search_employees",
  "coresignal_collect_employee",
  "github_search_repos",
  "github_contributors",
  "github_forks",
  "github_commit_emails",
  "web_search",
  "web_scrape",
  "avoma_list_meetings",
  "avoma_get_transcript",
  "fathom_list_meetings",
  "fathom_get_summary",
  "fathom_get_transcript",
  "findymail_find_email",
  "findymail_find_phone",
  "findymail_verify_email",
  "fireflies_list_meetings",
  "fireflies_get_meeting",
  "folk_list_people",
  "folk_list_companies",
  "fullenrich_enrich",
  "fullenrich_get_result",
  "gmail_send_email",
  "slack_list_channels",
  "slack_post_message",
  "gong_list_calls",
  "gong_get_summary",
  "gong_get_transcript",
  "grain_list_recordings",
  "grain_get_transcript",
  "googlesheets_list_spreadsheets",
  "googlesheets_list_sheets",
  "googlesheets_read_range",
  "greenhouse_list_jobs",
  "greenhouse_list_candidates",
  "greenhouse_search_candidates",
  "hubspot_search_contacts",
  "hubspot_search_companies",
  "hubspot_search_deals",
  "instantly_list_campaigns",
  "instantly_list_leads",
  "instantly_campaign_analytics",
  "instantly_add_lead",
  "jazzhr_list_jobs",
  "jazzhr_list_applicants",
  "jazzhr_get_applicant",
  "jobadder_list_jobs",
  "jobadder_search_candidates",
  "jobadder_list_job_applications",
  "lever_list_postings",
  "lever_list_opportunities",
  "lemlist_list_campaigns",
  "lemlist_list_activities",
  "lemlist_add_lead",
  "loxo_list_jobs",
  "loxo_search_people",
  "loxo_list_job_candidates",
  "lusha_search_person",
  "lusha_enrich_contacts",
  "manatal_list_jobs",
  "manatal_search_candidates",
  "manatal_list_job_candidates",
  "excel_list_workbooks",
  "excel_list_worksheets",
  "excel_read_range",
  "outlook_send_email",
  "monday_list_boards",
  "monday_list_items",
  "notion_search",
  "notion_query_database",
  "notion_read_page",
  "peopledatalabs_enrich_person",
  "peopledatalabs_search_people",
  "pinpoint_list_jobs",
  "pinpoint_list_candidates",
  "pipedrive_search_persons",
  "pipedrive_search_organizations",
  "pipedrive_search_deals",
  "recruitee_list_offers",
  "recruitee_list_candidates",
  "recruiterflow_list_jobs",
  "recruiterflow_list_candidates",
  "recruitis_list_jobs",
  "recruitis_list_candidates",
  "rocketreach_search_people",
  "rocketreach_lookup_person",
  "rocketreach_check_lookup",
  "signalhire_search_people",
  "signalhire_enrich_person",
  "replyio_list_sequences",
  "replyio_list_contacts",
  "smartlead_list_campaigns",
  "smartlead_list_leads",
  "smartlead_campaign_analytics",
  "smartrecruiters_list_jobs",
  "smartrecruiters_list_candidates",
  "snov_find_email",
  "snov_verify_email",
  "snov_get_task_result",
  "snov_get_profile",
  "teamtailor_list_jobs",
  "teamtailor_list_candidates",
  "teamtailor_list_job_candidates",
  "tldv_list_meetings",
  "tldv_get_notes",
  "tldv_get_transcript",
  "wiza_reveal",
  "wiza_get_result",
  "woodpecker_list_campaigns",
  "woodpecker_list_prospects",
  "woodpecker_campaign_stats",
  "workable_list_jobs",
  "workable_list_candidates",
  "zohocrm_search_contacts",
  "zohocrm_search_accounts",
  "zohocrm_search_deals",
  "zohorecruit_search_candidates",
  "zohorecruit_search_job_openings",
  "zoom_list_recordings",
  "zoom_get_transcript",
  "calyflow_create_document",
] as const;
