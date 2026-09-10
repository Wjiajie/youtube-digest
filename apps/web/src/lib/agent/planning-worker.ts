export type WorkerReceipt = { data: unknown; error: { code: string; message: string } | null };
export type WorkerClaim = { runId: string; leaseId: string; skill: unknown };
export type WorkerFinish = { runId: string; leaseId: string; result: unknown };

/** The execution worker can only claim and finish an already user-created run. */
export type PlanningWorker = {
  claim(input: WorkerClaim): Promise<WorkerReceipt>;
  finish(input: WorkerFinish): Promise<WorkerReceipt>;
};
