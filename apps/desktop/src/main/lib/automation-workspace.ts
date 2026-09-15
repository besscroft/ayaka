import type { CronJob, CronJobInput } from "../../shared/types";
import { prepareConversationWorkspace } from "./conversation-workspace";
import { createCronJob } from "./cron-store";

/** Ensure an automation's persistent conversation has a workspace. */
export async function ensureAutomationWorkspace(
  job: Pick<CronJob, "conversationId" | "name">,
): Promise<void> {
  await prepareConversationWorkspace(job.conversationId, `Automation: ${job.name}`);
}

/** Create a scheduled job and initialize its conversation workspace. */
export async function createCronJobWithWorkspace(input: CronJobInput): Promise<CronJob> {
  const job = await createCronJob(input);
  await ensureAutomationWorkspace(job);
  return job;
}
