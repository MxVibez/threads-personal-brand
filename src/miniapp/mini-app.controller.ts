import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { TelegramAccessService } from "../access/telegram-access.service";
import { ApproveDraftService } from "../domain/drafts/approve-draft.service";
import {
  DraftAccessDeniedError,
  DraftNotFoundError,
  DraftStateError,
  DraftVersionConflictError
} from "../domain/drafts/draft.errors";
import {
  DRAFT_REPOSITORY,
  type DraftRepository
} from "../domain/drafts/draft.repository";
import type { DraftView } from "../domain/drafts/draft.types";
import {
  PUBLICATION_QUEUE,
  type PublicationQueue
} from "../domain/publication/publication-queue";
import { ThreadsResultsService } from "../results/threads-results.service";
import {
  TelegramMiniAppAuthService,
  type MiniAppIdentity
} from "./telegram-mini-app-auth.service";
import {
  EXPERT_TIMEZONES,
  ExpertSettingsService,
  type ExpertSettingsView
} from "./expert-settings.service";

const approveSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    scheduledAt: z.string().datetime({ offset: true }).optional()
  })
  .strict();

const rejectSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(160)
  })
  .strict();

const expertSettingsSchema = z
  .object({
    timezone: z.enum(EXPERT_TIMEZONES),
    dailyPublications: z.number().int().min(1).max(10),
    voice: z.object({
      description: z.string().trim().max(2_000),
      avoid: z.string().trim().max(2_000),
      examples: z.array(z.string().trim().min(1).max(5_000)).max(20)
    }).strict()
  })
  .strict();

@Controller("miniapp")
export class MiniAppController {
  constructor(
    private readonly auth: TelegramMiniAppAuthService,
    private readonly access: TelegramAccessService,
    private readonly approveDraft: ApproveDraftService,
    private readonly config: ConfigService,
    private readonly resultsService: ThreadsResultsService,
    private readonly expertSettings: ExpertSettingsService,
    @Inject(DRAFT_REPOSITORY) private readonly drafts: DraftRepository,
    @Inject(PUBLICATION_QUEUE) private readonly publicationQueue: PublicationQueue
  ) {}

  @Get("bootstrap")
  @Header("Cache-Control", "no-store")
  async bootstrap(
    @Headers("authorization") authorization: string | undefined
  ): Promise<{
    user: Pick<MiniAppIdentity, "telegramId" | "displayName" | "username" | "isOwner">;
    drafts: ReturnType<MiniAppController["draftDto"]>[];
    settings: ExpertSettingsView;
    mode: "dry-run" | "live";
  }> {
    const identity = await this.auth.authenticate(authorization);
    const workspaceTelegramId = this.access.workspaceTelegramId();
    const [drafts, settings] = await Promise.all([
      this.drafts.listWaitingByExpert(workspaceTelegramId),
      this.expertSettings.getOrCreate({
        telegramId: workspaceTelegramId,
        displayName: "Общий профиль Threads"
      })
    ]);
    return {
      user: {
        telegramId: identity.telegramId,
        displayName: identity.displayName,
        isOwner: identity.isOwner,
        ...(identity.username ? { username: identity.username } : {})
      },
      drafts: drafts.map((draft) => this.draftDto(draft)),
      settings,
      mode: this.config.get<string>("THREADS_DRY_RUN", "true") === "true"
        ? "dry-run"
        : "live"
    };
  }

  @Get("settings")
  @Header("Cache-Control", "no-store")
  async settings(
    @Headers("authorization") authorization: string | undefined
  ) {
    await this.auth.authenticate(authorization);
    const workspaceTelegramId = this.access.workspaceTelegramId();
    return this.expertSettings.getOrCreate({
      telegramId: workspaceTelegramId,
      displayName: "Общий профиль Threads"
    });
  }

  @Post("settings")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async saveSettings(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    const identity = await this.auth.authenticate(authorization);
    this.assertCanMutateWorkspace(identity);
    const workspaceTelegramId = this.access.workspaceTelegramId();
    const input = expertSettingsSchema.safeParse(body);
    if (!input.success) throw new BadRequestException("Invalid expert settings");
    return this.expertSettings.save({
      telegramId: workspaceTelegramId,
      displayName: "Общий профиль Threads",
      settings: input.data,
      actorTelegramId: identity.telegramId
    });
  }

  @Get("results")
  @Header("Cache-Control", "no-store")
  async results(
    @Headers("authorization") authorization: string | undefined
  ) {
    await this.auth.authenticate(authorization);
    return this.resultsService.dashboard(this.access.workspaceTelegramId());
  }

  @Get("plan")
  @Header("Cache-Control", "no-store")
  async plan(
    @Headers("authorization") authorization: string | undefined
  ) {
    await this.auth.authenticate(authorization);
    const publications = await this.drafts.listPlannedByExpert(this.access.workspaceTelegramId());
    return {
      publications: publications.map((publication) => ({
        id: publication.id,
        draftId: publication.draftId,
        title: publication.title,
        scheduledAt: publication.scheduledAt.toISOString(),
        status: publication.status
      }))
    };
  }

  @Post("publications/:publicationJobId/cancel")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async cancelPublication(
    @Headers("authorization") authorization: string | undefined,
    @Param("publicationJobId") publicationJobId: string
  ): Promise<{ ok: true }> {
    const identity = await this.auth.authenticate(authorization);
    this.assertCanMutateWorkspace(identity);
    if (!z.string().uuid().safeParse(publicationJobId).success) {
      throw new BadRequestException("Invalid publication job id");
    }
    try {
      await this.drafts.cancelPlannedPublication({
        publicationJobId,
        expertTelegramId: this.access.workspaceTelegramId(),
        actorTelegramId: identity.telegramId
      });
      await this.publicationQueue.cancel(publicationJobId);
      return { ok: true };
    } catch (error) {
      throw this.httpDraftError(error);
    }
  }

  @Post("demo")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async demo(
    @Headers("authorization") authorization: string | undefined
  ): Promise<{ draft: ReturnType<MiniAppController["draftDto"]>; existing: boolean }> {
    const identity = await this.auth.authenticate(authorization);
    this.assertCanMutateWorkspace(identity);
    const workspaceTelegramId = this.access.workspaceTelegramId();
    const waiting = await this.drafts.listWaitingByExpert(workspaceTelegramId, 1);
    const existing = waiting[0];
    const draft = existing ?? await this.drafts.createDemo(workspaceTelegramId);
    return { draft: this.draftDto(draft), existing: Boolean(existing) };
  }

  @Post("drafts/:draftId/approve")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async approve(
    @Headers("authorization") authorization: string | undefined,
    @Param("draftId") draftId: string,
    @Body() body: unknown
  ): Promise<{
    ok: true;
    alreadyApproved: boolean;
    publicationJobId: string;
    scheduledAt: string;
  }> {
    const identity = await this.auth.authenticate(authorization);
    this.assertCanMutateWorkspace(identity);
    const workspaceTelegramId = this.access.workspaceTelegramId();
    const input = approveSchema.safeParse(body);
    if (!input.success || !z.string().uuid().safeParse(draftId).success) {
      throw new BadRequestException("Invalid approval request");
    }

    const scheduledAt = input.data.scheduledAt
      ? new Date(input.data.scheduledAt)
      : new Date();
    const now = Date.now();
    if (
      scheduledAt.getTime() < now - 60_000 ||
      scheduledAt.getTime() > now + 1000 * 60 * 60 * 24 * 30
    ) {
      throw new BadRequestException("Scheduled time is outside the allowed range");
    }

    try {
      const result = await this.approveDraft.execute({
        draftId,
        expectedVersion: input.data.expectedVersion,
        expertTelegramId: workspaceTelegramId,
        actorTelegramId: identity.telegramId,
        scheduledAt
      });
      return {
        ok: true,
        alreadyApproved: result.alreadyApproved,
        publicationJobId: result.publicationJob.id,
        scheduledAt: result.publicationJob.scheduledAt.toISOString()
      };
    } catch (error) {
      throw this.httpDraftError(error);
    }
  }

  @Post("drafts/:draftId/reject")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async reject(
    @Headers("authorization") authorization: string | undefined,
    @Param("draftId") draftId: string,
    @Body() body: unknown
  ): Promise<{ ok: true }> {
    const identity = await this.auth.authenticate(authorization);
    this.assertCanMutateWorkspace(identity);
    const workspaceTelegramId = this.access.workspaceTelegramId();
    const input = rejectSchema.safeParse(body);
    if (!input.success || !z.string().uuid().safeParse(draftId).success) {
      throw new BadRequestException("Invalid rejection request");
    }

    try {
      await this.drafts.reject({
        draftId,
        expectedVersion: input.data.expectedVersion,
        expertTelegramId: workspaceTelegramId,
        actorTelegramId: identity.telegramId,
        reason: input.data.reason
      });
      return { ok: true };
    } catch (error) {
      throw this.httpDraftError(error);
    }
  }

  private draftDto(draft: DraftView) {
    return {
      id: draft.id,
      version: draft.currentVersion,
      title: draft.title,
      status: draft.status,
      segments: draft.segments,
      sources: draft.sources,
      analysis: draft.analysis,
      createdAt: draft.createdAt.toISOString()
    };
  }

  private assertCanMutateWorkspace(identity: MiniAppIdentity): void {
    if (!this.access.canMutateWorkspace(identity.telegramId)) {
      throw new ForbiddenException(
        "В рабочем режиме менять общий контент может только владелец"
      );
    }
  }

  private httpDraftError(error: unknown): Error {
    if (error instanceof DraftNotFoundError) {
      return new NotFoundException(error.message);
    }
    if (error instanceof DraftAccessDeniedError) {
      return new ForbiddenException(error.message);
    }
    if (
      error instanceof DraftVersionConflictError ||
      error instanceof DraftStateError
    ) {
      return new ConflictException(error.message);
    }
    return error instanceof Error ? error : new Error("Unknown draft error");
  }
}
