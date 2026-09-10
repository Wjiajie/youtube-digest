-- Reviewed CLI pull. Pure, bounded transcript projection for current bindings;
-- raw resource policies and existing RPCs remain unchanged. Helper precedes wrapper.
CREATE OR REPLACE FUNCTION private.read_learning_transcript(p_resource_binding_id uuid, p_video_id text, p_source_run_id uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); blueprint uuid; context jsonb; source public.resource_runs; discovery jsonb; candidate jsonb;
 reason text:='not_acquired'; body jsonb; transcript jsonb; segments jsonb; segment jsonb; total integer;
 segment_offset numeric; segment_duration numeric; observed timestamptz;
begin
 if actor is null or not private.can_access_progress_evidence() or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'LEARNING_TRANSCRIPT_FORBIDDEN' using errcode='42501';
 end if;
 if p_resource_binding_id is null or p_video_id is null or p_video_id!~'^[A-Za-z0-9_-]{11}$'
  or p_offset is null or p_offset not between 0 and 19999 or p_offset%20<>0 or (p_source_run_id is null and p_offset<>0) then
  raise exception 'LEARNING_TRANSCRIPT_INVALID' using errcode='22023';
 end if;
 -- Same Blueprint-first order as binding writes and resource-chain clearing.
 select id into blueprint from public.blueprints where owner_id=actor for share;
 select jsonb_build_object('bindingId',r.id,'nodeId',n.id,'nodeTitle',n.title,'goalId',g.id,'goalTitle',g.title,'videoId',r.external_id)
 into context from public.resource_bindings r
 join public.path_nodes n on n.id=r.node_id and n.owner_id=r.owner_id
 join public.stages s on s.id=n.stage_id and s.owner_id=n.owner_id
 join public.goals g on g.id=s.goal_id and g.owner_id=s.owner_id
 where r.id=p_resource_binding_id and r.owner_id=actor and g.blueprint_id=blueprint
  and r.archived_at is null and n.archived_at is null and s.archived_at is null and g.archived_at is null
  and r.kind='youtube_video' and r.external_id=p_video_id and r.url='https://www.youtube.com/watch?v='||p_video_id;
 if context is null then raise exception 'LEARNING_TRANSCRIPT_SOURCE_NOT_FOUND' using errcode='P0002'; end if;
 if p_source_run_id is not null then
  select * into source from public.resource_runs r where r.id=p_source_run_id and r.owner_id=actor
   and r.blueprint_id=blueprint and r.node_id=(context->>'nodeId')::uuid;
 else
  select r.* into source from public.resource_runs r where r.owner_id=actor and r.blueprint_id=blueprint
   and r.node_id=(context->>'nodeId')::uuid and r.status in ('ready','stale') and exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof((case when r.result->>'status'='discovered' then r.result else r.input_discovery end)->'candidates')='array'
     then (case when r.result->>'status'='discovered' then r.result else r.input_discovery end)->'candidates' else '[]'::jsonb end) c
    where c#>>'{video,videoId}'=p_video_id
   ) order by r.created_at desc,r.id desc limit 1;
 end if;
 if source.id is not null then
  if source.status='cleared' then reason:='cleared';
  elsif source.status in ('ready','stale') then
   discovery:=case when source.result->>'status'='discovered' then source.result else source.input_discovery end;
   select c into candidate from jsonb_array_elements(case when jsonb_typeof(discovery->'candidates')='array' then discovery->'candidates' else '[]'::jsonb end) c
    where c#>>'{video,videoId}'=p_video_id limit 1;
   if candidate is not null then
    reason:='not_available';
    if source.source_started_at is not null and source.content_expires_at is not null and source.retention_policy_ref is not null then
     if source.content_expires_at<=clock_timestamp() then reason:='expired';
     elsif candidate#>>'{transcript,status}'='pending' then reason:='pending';
     elsif candidate#>>'{transcript,status}'='ready' then
      transcript:=candidate->'transcript';
      if jsonb_typeof(transcript->'segments')='array' and jsonb_typeof(transcript->'language')='string'
       and transcript->>'language' ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$'
       and jsonb_typeof(candidate#>'{video,title}')='string'
       and length(candidate#>>'{video,title}')+length(regexp_replace(candidate#>>'{video,title}',U&'[^\+010000-\+10FFFF]','','g')) between 1 and 1000 then
       total:=jsonb_array_length(transcript->'segments');
       if total between 1 and 20000 then
        segments:='[]'::jsonb;
        for segment in select value from jsonb_array_elements(transcript->'segments') with ordinality s(value,ord)
         where ord>p_offset and ord<=p_offset+20 order by ord loop
         if jsonb_typeof(segment->'text') is distinct from 'string' or jsonb_typeof(segment->'offset') is distinct from 'number'
          or jsonb_typeof(segment->'duration') is distinct from 'number' then segments:=null; exit; end if;
         if length(segment->>'text')+length(regexp_replace(segment->>'text',U&'[^\+010000-\+10FFFF]','','g')) not between 1 and 20000
          or btrim(segment->>'text',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' then segments:=null; exit; end if;
         segment_offset:=(segment->>'offset')::numeric; segment_duration:=(segment->>'duration')::numeric;
         if segment_offset<0 or segment_duration<0 or segment_offset+segment_duration>9007199254740991 then segments:=null; exit; end if;
         segments:=segments||jsonb_build_array(jsonb_build_object('text',segment->>'text','offsetMs',segment_offset,'durationMs',segment_duration));
        end loop;
        if segments is not null then
         body:=jsonb_build_object('status','ready','sourceRunId',source.id,'sourceBlueprintVersion',source.blueprint_version,
          'sourceCreatedAt',source.created_at,'contentExpiresAt',source.content_expires_at,'title',candidate#>>'{video,title}',
          'language',transcript->>'language','offset',p_offset,'totalSegments',total,'segments',segments);
        end if;
       end if;
      end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 -- Recheck after projection, under the same lock; reading never renews or clears.
 observed:=clock_timestamp();
 if body is not null and (source.content_expires_at<=observed or source.created_at>observed) then body:=null; reason:='expired'; end if;
 return jsonb_build_object('ownerId',actor,'context',context,'observedAt',observed)||
  coalesce(body,jsonb_build_object('status','unavailable','reason',reason));
end $function$
;

revoke all on function private.read_learning_transcript(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function private.read_learning_transcript(uuid,text,uuid,integer) to authenticated;

CREATE OR REPLACE FUNCTION public.read_learning_transcript(p_resource_binding_id uuid, p_video_id text, p_source_run_id uuid DEFAULT NULL::uuid, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select private.read_learning_transcript(p_resource_binding_id,p_video_id,p_source_run_id,p_offset)
$function$
;
revoke all on function public.read_learning_transcript(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_learning_transcript(uuid,text,uuid,integer) to authenticated;
