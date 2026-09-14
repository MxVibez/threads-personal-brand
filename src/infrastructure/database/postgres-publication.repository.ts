import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { PublicationRepository } from "../../domain/publication/publication.repository";
import type {
  PublicationJobRecord,
  PublicationSegmentRecord,
  PublicationSegmentStatus
} from "../../domain/publication/publication.types";
import { DATABASE_POOL } from "./database.tokens";

interface JobRow {
  id: string;
  draft_id: string;
  expert_telegram_id: string;
  dry_run: boolean;
  status: PublicationJobRecord["status"];
}

interface SegmentRow {
  id: string;
  position: number;
  text: string;
  status: PublicationSegmentStatus;
  threads_container_id: string | null;
  threads_media_id: string | null;
}

@Injectable()
export class PostgresPublicationRepository implements PublicationRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async claimJob(publicationJobId: string): Promise<PublicationJobRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const jobResult = await client.query<JobRow>(
        `UPDATE publication_jobs pj
         SET status = 'PROCESSING', attempts = attempts + 1, updated_at = NOW(), last_error = NULL
         FROM drafts d
         WHERE pj.id = $1
           AND pj.scheduled_at <= NOW()
           AND d.id = pj.draft_id
           AND (
             pj.status IN ('PENDING', 'FAILED', 'PARTIAL_FAILED')
             OR (
               pj.status = 'PROCESSING'
               AND pj.updated_at < NOW() - INTERVAL '10 minutes'
             )
           )
         RETURNING pj.id, pj.draft_id, d.expert_telegram_id::text, pj.status, pj.dry_run`,
        [publicationJobId]
      );
      const job = jobResult.rows[0];
      if (!job) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query(
        `UPDATE drafts SET status = 'PUBLISHING', updated_at = NOW() WHERE id = $1`,
        [job.draft_id]
      );
      const segmentResult = await client.query<SegmentRow>(
        `SELECT
           id, position, text, status, threads_container_id, threads_media_id
         FROM publication_segments
         WHERE publication_job_id = $1
         ORDER BY position`,
        [publicationJobId]
      );
      await client.query("COMMIT");

      return {
        id: job.id,
        draftId: job.draft_id,
        expertTelegramId: job.expert_telegram_id,
        dryRun: job.dry_run,
        status: job.status,
        segments: segmentResult.rows.map((segment) => ({
          id: segment.id,
          position: segment.position,
          text: segment.text,
          status: segment.status,
          threadsContainerId: segment.threads_container_id,
          threadsMediaId: segment.threads_media_id
        }))
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async saveContainer(segmentId: string, containerId: string): Promise<void> {
    await this.pool.query(
      `UPDATE publication_segments
       SET status = 'CONTAINER_CREATED', threads_container_id = $2,
           attempts = attempts + 1, last_error = NULL
       WHERE id = $1`,
      [segmentId, containerId]
    );
  }

  async markSegmentPublished(segmentId: string, mediaId: string): Promise<void> {
    await this.pool.query(
      `UPDATE publication_segments
       SET status = 'PUBLISHED', threads_media_id = $2,
           published_at = NOW(), last_error = NULL
       WHERE id = $1`,
      [segmentId, mediaId]
    );
  }

  async markSegmentPublishing(segmentId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE publication_segments SET status = 'PUBLISHING'
       WHERE id = $1 AND status IN ('CONTAINER_CREATED', 'FAILED')
         AND threads_container_id IS NOT NULL`,
      [segmentId]
    );
    if (result.rowCount !== 1) throw new Error("Publication segment cannot be claimed");
  }

  async markSegmentFailed(segmentId: string, error: string): Promise<void> {
    await this.markSegmentProblem(segmentId, "FAILED", error);
  }

  async markSegmentNeedsReview(segmentId: string, error: string): Promise<void> {
    await this.markSegmentProblem(segmentId, "NEEDS_REVIEW", error);
  }

  async markJobCompleted(publicationJobId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const jobResult = await client.query<{ draft_id: string }>(
        `UPDATE publication_jobs
         SET status = 'PUBLISHED', updated_at = NOW(), published_at = NOW(), last_error = NULL
         WHERE id = $1
         RETURNING draft_id`,
        [publicationJobId]
      );
      const draftId = jobResult.rows[0]?.draft_id;
      if (draftId) {
        await client.query(
          `UPDATE drafts SET status = 'PUBLISHED', updated_at = NOW() WHERE id = $1`,
          [draftId]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async markSegmentProblem(
    segmentId: string,
    status: "FAILED" | "NEEDS_REVIEW",
    error: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const segmentResult = await client.query<{ publication_job_id: string }>(
        `UPDATE publication_segments
         SET status = $2, last_error = $3
         WHERE id = $1
         RETURNING publication_job_id`,
        [segmentId, status, error.slice(0, 1000)]
      );
      const publicationJobId = segmentResult.rows[0]?.publication_job_id;
      if (!publicationJobId) {
        await client.query("ROLLBACK");
        return;
      }

      const publishedResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM publication_segments
         WHERE publication_job_id = $1 AND status = 'PUBLISHED'`,
        [publicationJobId]
      );
      const hasPublishedSegments = Number(publishedResult.rows[0]?.count ?? "0") > 0;
      const jobStatus =
        status === "NEEDS_REVIEW"
          ? "NEEDS_REVIEW"
          : hasPublishedSegments
            ? "PARTIAL_FAILED"
            : "FAILED";
      const draftStatus = hasPublishedSegments ? "PARTIAL_FAILED" : "FAILED";

      const jobResult = await client.query<{ draft_id: string }>(
        `UPDATE publication_jobs
         SET status = $2, last_error = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING draft_id`,
        [publicationJobId, jobStatus, error.slice(0, 1000)]
      );
      const draftId = jobResult.rows[0]?.draft_id;
      if (draftId) {
        await client.query(
          `UPDATE drafts SET status = $2, updated_at = NOW() WHERE id = $1`,
          [draftId, draftStatus]
        );
      }
      await client.query("COMMIT");
    } catch (caught) {
      await client.query("ROLLBACK");
      throw caught;
    } finally {
      client.release();
    }
  }
}
