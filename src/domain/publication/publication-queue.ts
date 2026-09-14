export const PUBLICATION_QUEUE = Symbol("PUBLICATION_QUEUE");
export const PUBLISH_DRAFT_QUEUE_NAME = "publish-draft";

export interface PublicationQueue {
  enqueue(publicationJobId: string, scheduledAt?: Date): Promise<void>;
  cancel(publicationJobId: string): Promise<void>;
}
