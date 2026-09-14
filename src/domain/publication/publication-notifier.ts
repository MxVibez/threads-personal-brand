export const PUBLICATION_NOTIFIER = Symbol("PUBLICATION_NOTIFIER");

export interface PublicationNotifier {
  notifyPublished(input: {
    expertTelegramId: string;
    publicationJobId: string;
    mediaIds: string[];
    dryRun: boolean;
  }): Promise<void>;
  notifyNeedsReview(input: {
    expertTelegramId: string;
    publicationJobId: string;
    reason: string;
  }): Promise<void>;
}
