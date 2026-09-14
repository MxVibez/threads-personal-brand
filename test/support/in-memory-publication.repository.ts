import type { PublicationRepository } from "../../src/domain/publication/publication.repository";
import type {
  PublicationJobRecord,
  PublicationSegmentRecord
} from "../../src/domain/publication/publication.types";

export class InMemoryPublicationRepository implements PublicationRepository {
  readonly job: PublicationJobRecord;
  completed = false;

  constructor(job: PublicationJobRecord) {
    this.job = structuredClone(job);
  }

  async claimJob(publicationJobId: string): Promise<PublicationJobRecord | null> {
    if (this.job.id !== publicationJobId || ["PUBLISHED", "CANCELLED", "NEEDS_REVIEW"].includes(this.job.status)) return null;
    this.job.status = "PROCESSING";
    return structuredClone(this.job);
  }

  async saveContainer(segmentId: string, containerId: string): Promise<void> {
    const segment = this.segment(segmentId);
    segment.status = "CONTAINER_CREATED";
    segment.threadsContainerId = containerId;
  }

  async markSegmentPublished(segmentId: string, mediaId: string): Promise<void> {
    const segment = this.segment(segmentId);
    segment.status = "PUBLISHED";
    segment.threadsMediaId = mediaId;
  }

  async markSegmentPublishing(segmentId: string): Promise<void> {
    this.segment(segmentId).status = "PUBLISHING";
  }

  async markSegmentFailed(segmentId: string): Promise<void> {
    this.segment(segmentId).status = "FAILED";
    this.job.status = this.hasPublishedSegment() ? "PARTIAL_FAILED" : "FAILED";
  }

  async markSegmentNeedsReview(segmentId: string): Promise<void> {
    this.segment(segmentId).status = "NEEDS_REVIEW";
    this.job.status = "NEEDS_REVIEW";
  }

  async markJobCompleted(): Promise<void> {
    this.job.status = "PUBLISHED";
    this.completed = true;
  }

  private segment(segmentId: string): PublicationSegmentRecord {
    const segment = this.job.segments.find((item) => item.id === segmentId);
    if (!segment) throw new Error("Segment not found");
    return segment;
  }

  private hasPublishedSegment(): boolean {
    return this.job.segments.some((segment) => segment.status === "PUBLISHED");
  }
}
