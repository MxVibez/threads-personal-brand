export const THREADS_PUBLISHER = Symbol("THREADS_PUBLISHER");

export interface CreateThreadsContainerInput {
  publicationJobId: string;
  segmentPosition: number;
  text: string;
  replyToId: string | null;
}

export interface ThreadsPublisher {
  readonly dryRun: boolean;
  createTextContainer(input: CreateThreadsContainerInput): Promise<string>;
  publishContainer(containerId: string): Promise<string>;
}

export class ThreadsPublishError extends Error {
  constructor(
    message: string,
    readonly ambiguous: boolean
  ) {
    super(message);
    this.name = "ThreadsPublishError";
  }
}
