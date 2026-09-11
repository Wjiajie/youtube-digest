CREATE INDEX translation_runs_page_latest_idx ON private.translation_runs USING btree (owner_id, binding_id, video_id, source_run_id, page_offset, target_language, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION private.find_translation_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; found_id uuid;
begin
  actor:=private.translation_actor();
  -- Reuse the creation contract without accepting a client-selected run ID.
  if p_request is null or jsonb_typeof(p_request) is distinct from 'object' or p_request ? 'runId'
    or not private.translation_request_valid(p_request||'{"runId":"00000000-0000-4000-8000-000000000000"}'::jsonb) then
    raise exception 'TRANSLATION_INVALID' using errcode='22023';
  end if;
  select id into found_id from private.translation_runs
  where owner_id=actor and binding_id=(p_request->>'bindingId')::uuid and video_id=p_request->>'videoId'
    and source_run_id=(p_request->>'sourceRunId')::uuid and page_offset=(p_request->>'offset')::numeric::integer
    and target_language=p_request->>'targetLanguage'
  order by created_at desc,id desc limit 1;
  return jsonb_build_object('run_id',found_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.find_translation_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.find_translation_run(p_request)
$function$
;
REVOKE ALL ON FUNCTION private.find_translation_run(jsonb), public.find_translation_run(jsonb)
  FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.find_translation_run(jsonb), public.find_translation_run(jsonb)
  TO authenticated;
