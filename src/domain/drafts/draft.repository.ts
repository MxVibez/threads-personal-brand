import type { ApprovalResult, DraftView, PlannedPublicationView } from "./draft.types";

export const DRAFT_REPOSITORY = Symbol("DRAFT_REPOSITORY");

export interface ApproveDraftInput {
  draftId: string;
  expectedVersion: number;
  expertTelegramId: string;
  actorTelegramId?: string;
  scheduledAt?: Date;
  dryRun?: boolean;
}

export interface RejectDraftInput extends ApproveDraftInput {
  reason: string;
}

export interface CancelPlannedPublicationInput {
  publicationJobId: string;
  expertTelegramId: string;
  actorTelegramId?: string;
}

export interface DraftRepository {
  createDemo(expertTelegramId: string): Promise<DraftView>;
  findById(draftId: string): Promise<DraftView | null>;
  listWaitingByExpert(expertTelegramId: string, limit?: number): Promise<DraftView[]>;
  listPlannedByExpert(expertTelegramId: string, limit?: number): Promise<PlannedPublicationView[]>;
  cancelPlannedPublication(input: CancelPlannedPublicationInput): Promise<PlannedPublicationView>;
  approve(input: ApproveDraftInput): Promise<ApprovalResult>;
  reject(input: RejectDraftInput): Promise<DraftView>;
}
