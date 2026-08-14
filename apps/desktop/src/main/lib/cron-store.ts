import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";
import type { CronJob, CronJobInput, CronPayload, CronRun, CronSchedule } from "../../shared/types";
import { createConversation, getDb, isDbWriterEnabled } from "./db";
import { isDbWriterWorker, writeDb } from "./db-writer";
import { cronJobs, cronRuns } from "./schema";
import { nextRunForSchedule, normalizeCronSchedule } from "./cron-schedule";

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const RETRY_DELAYS_MS = [30_000, 60_000, 5 * 60_000] as const;

export interface ClaimedCronRun {
  job: CronJob;
  run: CronRun;
  claimToken: string;
  manual: boolean;
}

export async function createCronJob(input: CronJobInput, now = Date.now()): Promise<CronJob> {
  if (isDbWriterEnabled() && !isDbWriterWorker) {
    return writeDb<CronJob>("createCronJob", [input, now]);
  }
  const schedule = normalizeCronSchedule(input.schedule);
  const payload = normalizeCronPayload(input.payload);
  const id = randomUUID();
  const conversationId = randomUUID();
  await createConversation(conversationId, `Automation: ${normalizeName(input.name)}`);
  const row: typeof cronJobs.$inferInsert = {
    id,
    name: normalizeName(input.name),
    description: input.description?.trim().slice(0, 1_000) ?? "",
    schedule_json: JSON.stringify(schedule),
    payload_json: JSON.stringify(payload),
    status: "active",
    conversation_id: conversationId,
    next_run_at: initialRunForSchedule(schedule, now),
    last_run_at: null,
    claimed_at: null,
    claim_token: null,
    retry_count: 0,
    created_at: now,
    updated_at: now,
  };
  getDb().insert(cronJobs).values(row).run();
  return toCronJob(row as typeof cronJobs.$inferSelect);
}

export function listCronJobs(): CronJob[] {
  return getDb()
    .select()
    .from(cronJobs)
    .orderBy(asc(cronJobs.next_run_at), asc(cronJobs.name))
    .all()
    .map(toCronJob);
}

export function getCronJob(id: string): CronJob | null {
  const row = getDb().select().from(cronJobs).where(eq(cronJobs.id, id)).get();
  return row ? toCronJob(row) : null;
}

export async function updateCronJob(
  id: string,
  patch: Partial<CronJobInput>,
  now = Date.now(),
): Promise<CronJob> {
  if (isDbWriterEnabled() && !isDbWriterWorker)
    return writeDb<CronJob>("updateCronJob", [id, patch, now]);
  const current = getDb().select().from(cronJobs).where(eq(cronJobs.id, id)).get();
  if (!current) throw new Error("Cron job does not exist.");
  if (current.claimed_at) throw new Error("Cron job is currently running.");
  const schedule = patch.schedule
    ? normalizeCronSchedule(patch.schedule)
    : parseSchedule(current.schedule_json);
  const payload = patch.payload
    ? normalizeCronPayload(patch.payload)
    : parsePayload(current.payload_json);
  getDb()
    .update(cronJobs)
    .set({
      name: patch.name === undefined ? current.name : normalizeName(patch.name),
      description:
        patch.description === undefined
          ? current.description
          : patch.description.trim().slice(0, 1_000),
      schedule_json: JSON.stringify(schedule),
      payload_json: JSON.stringify(payload),
      next_run_at:
        current.status === "active" ? initialRunForSchedule(schedule, now) : current.next_run_at,
      retry_count: 0,
      updated_at: now,
    })
    .where(eq(cronJobs.id, id))
    .run();
  return getCronJob(id)!;
}

export async function setCronJobPaused(
  id: string,
  paused: boolean,
  now = Date.now(),
): Promise<CronJob> {
  if (isDbWriterEnabled() && !isDbWriterWorker)
    return writeDb<CronJob>("setCronJobPaused", [id, paused, now]);
  const current = getDb().select().from(cronJobs).where(eq(cronJobs.id, id)).get();
  if (!current) throw new Error("Cron job does not exist.");
  if (current.claimed_at) throw new Error("Cron job is currently running.");
  const schedule = parseSchedule(current.schedule_json);
  getDb()
    .update(cronJobs)
    .set({
      status: paused ? "paused" : "active",
      next_run_at: paused ? current.next_run_at : initialRunForSchedule(schedule, now),
      updated_at: now,
    })
    .where(eq(cronJobs.id, id))
    .run();
  return getCronJob(id)!;
}

export async function deleteCronJob(id: string): Promise<boolean> {
  if (isDbWriterEnabled() && !isDbWriterWorker) return writeDb<boolean>("deleteCronJob", [id]);
  return getDb().delete(cronJobs).where(eq(cronJobs.id, id)).run().changes > 0;
}

export function listCronRuns(jobId: string, limit = 100): CronRun[] {
  return getDb()
    .select()
    .from(cronRuns)
    .where(eq(cronRuns.job_id, jobId))
    .orderBy(desc(cronRuns.created_at))
    .limit(Math.max(1, Math.min(500, limit)))
    .all()
    .map(toCronRun);
}

export async function claimDueCronJobs(now = Date.now(), limit = 2): Promise<ClaimedCronRun[]> {
  if (isDbWriterEnabled() && !isDbWriterWorker)
    return writeDb<ClaimedCronRun[]>("claimDueCronJobs", [now, limit]);
  const db = getDb();
  return db.transaction((tx) => {
    const due = tx
      .select()
      .from(cronJobs)
      .where(
        and(
          eq(cronJobs.status, "active"),
          isNull(cronJobs.claimed_at),
          lte(cronJobs.next_run_at, now),
        ),
      )
      .orderBy(asc(cronJobs.next_run_at))
      .limit(Math.max(0, limit))
      .all();
    const claimed: ClaimedCronRun[] = [];
    for (const row of due) {
      if (row.next_run_at === null) continue;
      const claimToken = randomUUID();
      const result = tx
        .update(cronJobs)
        .set({ claimed_at: now, claim_token: claimToken, updated_at: now })
        .where(and(eq(cronJobs.id, row.id), isNull(cronJobs.claimed_at)))
        .run();
      if (result.changes !== 1) continue;
      const runRow: typeof cronRuns.$inferInsert = {
        id: randomUUID(),
        job_id: row.id,
        conversation_id: row.conversation_id,
        status: "running",
        scheduled_for: row.next_run_at,
        started_at: now,
        finished_at: null,
        attempt: row.retry_count + 1,
        output: null,
        error: null,
        runtime_run_id: null,
        created_at: now,
      };
      tx.insert(cronRuns).values(runRow).run();
      claimed.push({
        job: toCronJob({ ...row, claimed_at: now, claim_token: claimToken }),
        run: toCronRun(runRow as typeof cronRuns.$inferSelect),
        claimToken,
        manual: false,
      });
    }
    return claimed;
  });
}

export async function claimCronJobNow(id: string, now = Date.now()): Promise<ClaimedCronRun> {
  if (isDbWriterEnabled() && !isDbWriterWorker)
    return writeDb<ClaimedCronRun>("claimCronJobNow", [id, now]);
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(cronJobs).where(eq(cronJobs.id, id)).get();
    if (!row) throw new Error("Cron job does not exist.");
    if (row.claimed_at) throw new Error("Cron job is already running.");
    const claimToken = randomUUID();
    tx.update(cronJobs)
      .set({ claimed_at: now, claim_token: claimToken, updated_at: now })
      .where(and(eq(cronJobs.id, id), isNull(cronJobs.claimed_at)))
      .run();
    const runRow: typeof cronRuns.$inferInsert = {
      id: randomUUID(),
      job_id: id,
      conversation_id: row.conversation_id,
      status: "running",
      scheduled_for: now,
      started_at: now,
      finished_at: null,
      attempt: 1,
      output: null,
      error: null,
      runtime_run_id: null,
      created_at: now,
    };
    tx.insert(cronRuns).values(runRow).run();
    return {
      job: toCronJob({ ...row, claimed_at: now, claim_token: claimToken }),
      run: toCronRun(runRow as typeof cronRuns.$inferSelect),
      claimToken,
      manual: true,
    };
  });
}

export async function completeCronRun(
  claim: ClaimedCronRun,
  result: { output?: string; error?: string; transient?: boolean; runtimeRunId?: string },
  now = Date.now(),
): Promise<void> {
  if (isDbWriterEnabled() && !isDbWriterWorker) {
    await writeDb<void>("completeCronRun", [claim, result, now]);
    return;
  }
  const db = getDb();
  db.transaction((tx) => {
    const row = tx.select().from(cronJobs).where(eq(cronJobs.id, claim.job.id)).get();
    if (!row || row.claim_token !== claim.claimToken) return;
    const schedule = parseSchedule(row.schedule_json);
    const succeeded = !result.error;
    tx.update(cronRuns)
      .set({
        status: succeeded ? "succeeded" : "failed",
        finished_at: now,
        output: result.output?.slice(0, 100_000) ?? null,
        error: result.error?.slice(0, 4_000) ?? null,
        runtime_run_id: result.runtimeRunId ?? null,
      })
      .where(eq(cronRuns.id, claim.run.id))
      .run();

    let status: typeof cronJobs.$inferSelect.status = row.status;
    let retryCount = 0;
    let nextRunAt: number | null;
    if (claim.manual) {
      nextRunAt = row.next_run_at;
      status = row.status;
    } else if (!succeeded && result.transient && row.retry_count < RETRY_DELAYS_MS.length) {
      retryCount = row.retry_count + 1;
      nextRunAt = now + RETRY_DELAYS_MS[row.retry_count]!;
      status = "active";
    } else if (schedule.kind === "once") {
      nextRunAt = null;
      status = succeeded ? "completed" : "error";
    } else {
      nextRunAt = nextRunForSchedule(schedule, now);
      status = "active";
    }
    tx.update(cronJobs)
      .set({
        status,
        next_run_at: nextRunAt,
        last_run_at: now,
        claimed_at: null,
        claim_token: null,
        retry_count: retryCount,
        updated_at: now,
      })
      .where(eq(cronJobs.id, row.id))
      .run();
  });
}

export async function recoverCronJobs(now = Date.now()): Promise<void> {
  if (isDbWriterEnabled() && !isDbWriterWorker) {
    await writeDb<void>("recoverCronJobs", [now]);
    return;
  }
  const db = getDb();
  db.transaction((tx) => {
    tx.update(cronRuns)
      .set({ status: "failed", finished_at: now, error: "Ayaka stopped during this run." })
      .where(eq(cronRuns.status, "running"))
      .run();
    const rows = tx.select().from(cronJobs).all();
    for (const row of rows) {
      const schedule = parseSchedule(row.schedule_json);
      let status = row.status;
      let nextRunAt = row.next_run_at;
      if (status === "active" && nextRunAt !== null && nextRunAt < now) {
        if (schedule.kind === "once") {
          if (now - nextRunAt > ONE_DAY_MS) {
            status = "error";
            tx.insert(cronRuns)
              .values({
                id: randomUUID(),
                job_id: row.id,
                conversation_id: row.conversation_id,
                status: "skipped",
                scheduled_for: nextRunAt,
                started_at: null,
                finished_at: now,
                attempt: 1,
                output: null,
                error: "One-time run missed its 24 hour grace period.",
                runtime_run_id: null,
                created_at: now,
              })
              .run();
            nextRunAt = null;
          }
        } else {
          tx.insert(cronRuns)
            .values({
              id: randomUUID(),
              job_id: row.id,
              conversation_id: row.conversation_id,
              status: "skipped",
              scheduled_for: nextRunAt,
              started_at: null,
              finished_at: now,
              attempt: 1,
              output: null,
              error: "Missed while Ayaka was not running.",
              runtime_run_id: null,
              created_at: now,
            })
            .run();
          nextRunAt = nextRunForSchedule(schedule, now);
        }
      }
      tx.update(cronJobs)
        .set({
          status,
          next_run_at: nextRunAt,
          claimed_at: null,
          claim_token: null,
          updated_at: now,
        })
        .where(eq(cronJobs.id, row.id))
        .run();
    }
  });
}

function initialRunForSchedule(schedule: CronSchedule, now: number): number | null {
  if (schedule.kind === "once") return Date.parse(schedule.at);
  return nextRunForSchedule(schedule, now);
}

function normalizeCronPayload(payload: CronPayload): CronPayload {
  const prompt = payload.prompt?.trim();
  if (!prompt) throw new Error("Cron prompt is required.");
  return {
    prompt: prompt.slice(0, 40_000),
    ...(payload.agentId ? { agentId: payload.agentId } : {}),
    ...(payload.modelRef ? { modelRef: payload.modelRef } : {}),
    ...(payload.reasoning && payload.reasoning !== "provider-default"
      ? { reasoning: payload.reasoning }
      : {}),
    ...(payload.skillIds?.length ? { skillIds: [...new Set(payload.skillIds)].slice(0, 50) } : {}),
    ...(payload.toolSelection ? { toolSelection: payload.toolSelection } : {}),
  };
}

function normalizeName(name: string): string {
  const value = name?.trim();
  if (!value) throw new Error("Cron job name is required.");
  return value.slice(0, 160);
}

function parseSchedule(json: string): CronSchedule {
  return normalizeCronSchedule(JSON.parse(json) as CronSchedule);
}

function parsePayload(json: string): CronPayload {
  return normalizeCronPayload(JSON.parse(json) as CronPayload);
}

function toCronJob(row: typeof cronJobs.$inferSelect): CronJob {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    schedule: parseSchedule(row.schedule_json),
    payload: parsePayload(row.payload_json),
    status: row.status,
    conversationId: row.conversation_id,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCronRun(row: typeof cronRuns.$inferSelect): CronRun {
  return {
    id: row.id,
    jobId: row.job_id,
    conversationId: row.conversation_id,
    status: row.status,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    attempt: row.attempt,
    output: row.output,
    error: row.error,
    runtimeRunId: row.runtime_run_id,
    createdAt: row.created_at,
  };
}
