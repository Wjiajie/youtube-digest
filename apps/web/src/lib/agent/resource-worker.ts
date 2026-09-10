type Receipt = { data: unknown; error: { code: string; message: string } | null };
export type ResourceFinish = { runId: string; leaseId: string; result: unknown };
/** Privileged writes require independently verified user identity in the production adapter. */
export interface ResourceWorker {
  claim(input: { runId: string; leaseId: string; skill: unknown }): Promise<Receipt>;
  finish(input: ResourceFinish): Promise<Receipt>;
}
