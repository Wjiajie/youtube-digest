import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { LearningTranscriptReader } from "@blueprint/ui/learning-transcript";
import "@blueprint/ui/learning-transcript.css";
import { resolveRequestActor } from "@/lib/supabase/request";
import { createSupabaseBlueprintStore } from "@/lib/supabase/store";
import { AccountThemeShell } from "../../account-theme-shell";
import { AuthUnavailable } from "../../auth-unavailable";
import { readLearningTranscriptAction } from "../../learning-transcript-actions";

export const metadata = { title: "原始字幕 · Blueprint" };
export default async function LearningTranscriptPage({ params }: { params: Promise<{ bindingId: string }> }) {
  const { bindingId } = await params;
  if (!z.uuid().safeParse(bindingId).success) notFound();
  const path = `/learn/${bindingId}`, identity = await resolveRequestActor();
  if (!identity.ok) {
    if (identity.code === "unavailable") return <AuthUnavailable retryPath={path} />;
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const { actor, client } = identity.value;
  let blueprint;
  try { blueprint = await createSupabaseBlueprintStore(client).getMainBlueprint(actor.userId); }
  catch { return <AuthUnavailable retryPath={path} />; }
  const selection = blueprint?.goals.flatMap(goal => goal.stages.flatMap(stage => stage.nodes.flatMap(node => node.resources.map(binding => ({ goal, node, binding })))))
    .find(item => item.binding.id === bindingId.toLowerCase());
  if (!selection) notFound();
  return <AccountThemeShell accountId={actor.userId} client={client}><main className="shell transcript-shell">
    <nav className="transcript-page-nav" aria-label="字幕阅读导航"><Link className="bp-button" href={`/paths/${selection.goal.id}`}>← 返回目标路径</Link>
      <Link className="bp-button" href="/progress/notes">私人笔记</Link><Link className="bp-button" href={`/resources/nodes/${selection.node.id}`}>节点资源</Link></nav>
    <LearningTranscriptReader accountId={actor.userId} bindingId={selection.binding.id} videoId={selection.binding.externalId}
      loadAction={readLearningTranscriptAction.bind(null, actor.userId)} />
  </main></AccountThemeShell>;
}
