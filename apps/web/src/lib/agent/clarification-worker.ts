export type ClarificationWorkerReceipt = { data: unknown; error: { code: string; message: string } | null };
export type ClarificationFinish = { turnId: string; leaseId: string; result: unknown };

/** Narrow execution seam. It cannot create sessions, spend unreserved quota or confirm a Goal Brief. */
export type ClarificationWorker = {
  claim(input: { turnId: string; leaseId: string; skill: unknown }): Promise<ClarificationWorkerReceipt>;
  finish(input: ClarificationFinish): Promise<ClarificationWorkerReceipt>;
};
