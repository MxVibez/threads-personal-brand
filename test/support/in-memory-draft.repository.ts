import { randomUUID } from "node:crypto";
import {
  DraftAccessDeniedError,
  DraftNotFoundError,
  DraftStateError,
  DraftVersionConflictError
} from "../../src/domain/drafts/draft.errors";
import type {
  ApproveDraftInput,
  CancelPlannedPublicationInput,
  DraftRepository,
  RejectDraftInput
} from "../../src/domain/drafts/draft.repository";
import type {
  ApprovalResult,
  DraftView,
  PlannedPublicationView,
  PublicationJobView
} from "../../src/domain/drafts/draft.types";

export class InMemoryDraftRepository implements DraftRepository {
  private readonly drafts = new Map<string, DraftView>();
  private readonly jobs = new Map<string, PublicationJobView>();

  async createDemo(expertTelegramId: string): Promise<DraftView> {
    return this.create({ expertTelegramId, version: 1 });
  }

  create(input: { expertTelegramId: string; version?: number }): DraftView {
    const id = randomUUID();
    const draft: DraftView = {
      id,
      expertTelegramId: input.expertTelegramId,
      title: "Тестовая ветка",
      status: "WAITING_APPROVAL",
      currentVersion: input.version ?? 1,
      versionId: randomUUID(),
      segments: ["Первое сообщение", "Второе сообщение"],
      sources: [{ label: "Источник", url: "https://example.com/source" }],
      analysis: {},
      createdAt: new Date()
    };
    this.drafts.set(id, draft);
    return structuredClone(draft);
  }

  async findById(draftId: string): Promise<DraftView | null> {
    const draft = this.drafts.get(draftId);
    return draft ? structuredClone(draft) : null;
  }

  async listWaitingByExpert(expertTelegramId: string, limit = 20): Promise<DraftView[]> {
    return [...this.drafts.values()]
      .filter(
        (draft) =>
          draft.expertTelegramId === expertTelegramId &&
          draft.status === "WAITING_APPROVAL"
      )
      .slice(0, limit)
      .map((draft) => structuredClone(draft));
  }

  async listPlannedByExpert(expertTelegramId: string, limit = 30): Promise<PlannedPublicationView[]> {
    const drafts = new Map(
      [...this.drafts.values()]
        .filter((draft) => draft.expertTelegramId === expertTelegramId)
        .map((draft) => [draft.id, draft])
    );

    return [...this.jobs.values()]
      .filter((job) => drafts.has(job.draftId) && ["PENDING", "PROCESSING"].includes(job.status))
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime())
      .slice(0, limit)
      .map((job) => ({
        id: job.id,
        draftId: job.draftId,
        title: drafts.get(job.draftId)?.title ?? "Публикация",
        scheduledAt: new Date(job.scheduledAt),
        status: job.status
      }));
  }

  async cancelPlannedPublication(input: CancelPlannedPublicationInput): Promise<PlannedPublicationView> {
    const job = [...this.jobs.values()].find((candidate) => candidate.id === input.publicationJobId);
    if (!job) throw new DraftNotFoundError();
    const draft = this.drafts.get(job.draftId);
    if (!draft) throw new DraftNotFoundError();
    if (draft.expertTelegramId !== input.expertTelegramId) throw new DraftAccessDeniedError();
    if (job.status !== "PENDING" && job.status !== "CANCELLED") {
      throw new DraftStateError(job.status);
    }
    job.status = "CANCELLED";
    draft.status = "CANCELLED";
    return {
      id: job.id,
      draftId: draft.id,
      title: draft.title,
      scheduledAt: new Date(job.scheduledAt),
      status: job.status
    };
  }

  async approve(input: ApproveDraftInput): Promise<ApprovalResult> {
    const draft = this.drafts.get(input.draftId);
    if (!draft) throw new DraftNotFoundError();
    if (draft.expertTelegramId !== input.expertTelegramId) {
      throw new DraftAccessDeniedError();
    }

    const idempotencyKey = `publish:${input.draftId}:v${input.expectedVersion}`;
    const existing = this.jobs.get(idempotencyKey);
    if (existing) {
      return {
        draft: structuredClone(draft),
        publicationJob: structuredClone(existing),
        alreadyApproved: true
      };
    }

    if (draft.currentVersion !== input.expectedVersion) {
      throw new DraftVersionConflictError();
    }
    if (draft.status !== "WAITING_APPROVAL") {
      throw new DraftStateError(draft.status);
    }

    draft.status = "APPROVED";
    const job: PublicationJobView = {
      id: randomUUID(),
      draftId: draft.id,
      draftVersionId: draft.versionId,
      idempotencyKey,
      scheduledAt: input.scheduledAt ?? new Date(),
      status: "PENDING"
    };
    this.jobs.set(idempotencyKey, job);

    return {
      draft: structuredClone(draft),
      publicationJob: structuredClone(job),
      alreadyApproved: false
    };
  }

  async reject(input: RejectDraftInput): Promise<DraftView> {
    const draft = this.drafts.get(input.draftId);
    if (!draft) throw new DraftNotFoundError();
    if (draft.expertTelegramId !== input.expertTelegramId) {
      throw new DraftAccessDeniedError();
    }
    if (draft.currentVersion !== input.expectedVersion) {
      throw new DraftVersionConflictError();
    }
    if (draft.status === "REJECTED") return structuredClone(draft);
    if (draft.status !== "WAITING_APPROVAL") {
      throw new DraftStateError(draft.status);
    }
    draft.status = "REJECTED";
    return structuredClone(draft);
  }
}
