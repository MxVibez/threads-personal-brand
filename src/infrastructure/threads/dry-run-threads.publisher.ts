import type {
  CreateThreadsContainerInput,
  ThreadsPublisher
} from "../../domain/publication/threads-publisher";

export class DryRunThreadsPublisher implements ThreadsPublisher {
  readonly dryRun = true;

  async createTextContainer(input: CreateThreadsContainerInput): Promise<string> {
    return `dry-container-${input.publicationJobId}-${input.segmentPosition}`;
  }

  async publishContainer(containerId: string): Promise<string> {
    return containerId.replace("dry-container", "dry-post");
  }
}
