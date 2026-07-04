import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eq = vi.fn();
  const update = vi.fn();
  const deleteRows = vi.fn();
  const remove = vi.fn();
  const storageFrom = vi.fn();
  const from = vi.fn();
  const revalidatePath = vi.fn();
  const getDocument = vi.fn();
  const getProject = vi.fn();
  return {
    eq,
    update,
    deleteRows,
    remove,
    storageFrom,
    from,
    revalidatePath,
    getDocument,
    getProject,
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({
    userId: "user-1",
    workspaceId: "workspace-1",
    role: "admin",
    workspace: { id: "workspace-1", name: "Workspace" },
  })),
}));

vi.mock("@/lib/queries", () => ({
  getClient: vi.fn(),
  getDocument: mocks.getDocument,
  getProject: mocks.getProject,
  getProspect: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: () => ({
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  }),
}));

describe("document archive actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eq.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.deleteRows.mockImplementation(() => {
      throw new Error("documents should be archived, not deleted");
    });
    mocks.from.mockReturnValue({
      update: mocks.update,
      delete: mocks.deleteRows,
    });
    mocks.remove.mockImplementation(() => {
      throw new Error("storage should be preserved when archiving");
    });
    mocks.storageFrom.mockReturnValue({ remove: mocks.remove });
    mocks.getDocument.mockResolvedValue({
      id: "doc-1",
      workspace_id: "workspace-1",
      scope_type: "project",
      scope_id: "project-1",
      kind: "file",
      doc_type: "output",
      source: "workflow",
      filename: "Output.md",
      storage_path: "workspace-1/project/project-1/output.md",
      extracted_text: "text",
      is_active: true,
      created_by: "user-1",
      created_at: "2026-07-04T10:00:00Z",
    });
    mocks.getProject.mockResolvedValue({
      id: "project-1",
      client: { id: "client-1" },
    });
  });

  it("archives documents without hard-deleting rows or storage", async () => {
    const { archiveDocumentAction } = await import("@/lib/actions/documents");

    await archiveDocumentAction("doc-1");

    expect(mocks.from).toHaveBeenCalledWith("documents");
    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
    expect(mocks.eq).toHaveBeenCalledWith("id", "doc-1");
    expect(mocks.deleteRows).not.toHaveBeenCalled();
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps the deleteDocumentAction compatibility export as an archive", async () => {
    const { deleteDocumentAction } = await import("@/lib/actions/documents");

    await deleteDocumentAction("doc-1");

    expect(mocks.update).toHaveBeenCalledWith({ is_active: false });
    expect(mocks.deleteRows).not.toHaveBeenCalled();
  });

  it("revalidates the concrete project documents route and project layout", async () => {
    const { archiveDocumentAction } = await import("@/lib/actions/documents");

    await archiveDocumentAction("doc-1");

    expect(mocks.getProject).toHaveBeenCalledWith("workspace-1", "project-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/clients/client-1/projects/project-1/documents",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/clients/[clientId]/projects/[projectId]",
      "layout",
    );
  });
});
