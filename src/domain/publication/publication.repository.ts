import type { PublicationJobRecord } from "./publication.types";

export const PUBLICATION_REPOSITORY = Symbol("PUBLICATION_REPOSITORY");

export interface PublicationRepository {
  claimJob(publicationJobId: string): Promise<PublicationJobRecord | null>;
  saveContainer(segmentId: string, containerId: string): Promise<void>;
  markSegmentPublishing(segmentId: string): Promise<void>;
  markSegmentPublished(segmentId: string, mediaId: string): Promise<void>;
  markSegmentFailed(segmentId: string, error: string): Promise<void>;
  markSegmentNeedsReview(segmentId: string, error: string): Promise<void>;
  markJobCompleted(publicationJobId: string): Promise<void>;
}
