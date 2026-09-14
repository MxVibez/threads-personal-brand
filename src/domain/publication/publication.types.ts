export type PublicationSegmentStatus =
  | "PENDING"
  | "CONTAINER_CREATED"
  | "PUBLISHING"
  | "PUBLISHED"
  | "FAILED"
  | "NEEDS_REVIEW";

export interface PublicationSegmentRecord {
  id: string;
  position: number;
  text: string;
  status: PublicationSegmentStatus;
  threadsContainerId: string | null;
  threadsMediaId: string | null;
}

export interface PublicationJobRecord {
  id: string;
  draftId: string;
  expertTelegramId: string;
  dryRun: boolean;
  status:
    | "PENDING"
    | "PROCESSING"
    | "PUBLISHED"
    | "FAILED"
    | "PARTIAL_FAILED"
    | "NEEDS_REVIEW"
    | "CANCELLED";
  segments: PublicationSegmentRecord[];
}
