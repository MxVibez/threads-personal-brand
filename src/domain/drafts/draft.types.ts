export type DraftStatus =
  | "WAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "PARTIAL_FAILED"
  | "CANCELLED";

export interface DraftSource {
  label: string;
  url: string;
  meta?: string;
}

export interface DraftAnalysis {
  format?: string;
  signal?: string;
  mentions?: number;
  freshness?: string;
  goal?: string;
  discussionPotential?: string;
  risk?: string;
  audience?: string;
  insight?: string;
  evidence?: string[];
}

export interface DraftView {
  id: string;
  expertTelegramId: string;
  title: string;
  status: DraftStatus;
  currentVersion: number;
  versionId: string;
  segments: string[];
  sources: DraftSource[];
  analysis: DraftAnalysis;
  createdAt: Date;
}

export interface PublicationJobView {
  id: string;
  draftId: string;
  draftVersionId: string;
  idempotencyKey: string;
  scheduledAt: Date;
  status:
    | "PENDING"
    | "PROCESSING"
    | "PUBLISHED"
    | "FAILED"
    | "PARTIAL_FAILED"
    | "NEEDS_REVIEW"
    | "CANCELLED";
}

export interface PlannedPublicationView {
  id: string;
  draftId: string;
  title: string;
  scheduledAt: Date;
  status: PublicationJobView["status"];
}

export interface ApprovalResult {
  draft: DraftView;
  publicationJob: PublicationJobView;
  alreadyApproved: boolean;
}
