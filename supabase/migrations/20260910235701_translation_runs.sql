-- Reviewed local CLI diff: dependency-ordered functions and explicit least-privilege ACLs.
create table "private"."translation_run_leases" (
    "run_id" uuid not null,
    "lease_id" uuid not null,
    "completion_digest" bytea
      );


alter table "private"."translation_run_leases" enable row level security;


  create table "private"."translation_run_quotas" (
    "owner_id" uuid not null,
    "remaining" integer not null default 0
      );


alter table "private"."translation_run_quotas" enable row level security;


  create table "private"."translation_runs" (
    "id" uuid not null,
    "owner_id" uuid not null,
    "blueprint_id" uuid not null,
    "node_id" uuid not null,
    "binding_id" uuid not null,
    "video_id" text not null,
    "source_run_id" uuid not null,
    "page_offset" integer not null,
    "target_language" text not null,
    "status" text not null,
    "created_at" timestamp with time zone not null default clock_timestamp(),
    "expires_at" timestamp with time zone not null,
    "source_started_at" timestamp with time zone not null,
    "content_expires_at" timestamp with time zone not null,
    "retention_policy_ref" text not null,
    "input_page" jsonb,
    "skill" jsonb,
    "model" text,
    "result" jsonb,
    "cleared_at" timestamp with time zone,
    "clear_reason" text
      );


alter table "private"."translation_runs" enable row level security;

CREATE INDEX translation_blueprint_owner ON private.translation_runs USING btree (blueprint_id, owner_id);

CREATE UNIQUE INDEX translation_one_active_owner ON private.translation_runs USING btree (owner_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX translation_owner ON private.translation_runs USING btree (owner_id);

CREATE UNIQUE INDEX translation_run_leases_pkey ON private.translation_run_leases USING btree (run_id);

CREATE UNIQUE INDEX translation_run_quotas_pkey ON private.translation_run_quotas USING btree (owner_id);

CREATE UNIQUE INDEX translation_runs_pkey ON private.translation_runs USING btree (id);

CREATE INDEX translation_source ON private.translation_runs USING btree (source_run_id);

alter table "private"."translation_run_leases" add constraint "translation_run_leases_pkey" PRIMARY KEY using index "translation_run_leases_pkey";

alter table "private"."translation_run_quotas" add constraint "translation_run_quotas_pkey" PRIMARY KEY using index "translation_run_quotas_pkey";

alter table "private"."translation_runs" add constraint "translation_runs_pkey" PRIMARY KEY using index "translation_runs_pkey";

alter table "private"."translation_run_leases" add constraint "translation_run_leases_run_id_fkey" FOREIGN KEY (run_id) REFERENCES private.translation_runs(id) ON DELETE CASCADE not valid;

alter table "private"."translation_run_leases" validate constraint "translation_run_leases_run_id_fkey";

alter table "private"."translation_run_quotas" add constraint "translation_run_quotas_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "private"."translation_run_quotas" validate constraint "translation_run_quotas_owner_id_fkey";

alter table "private"."translation_run_quotas" add constraint "translation_run_quotas_remaining_check" CHECK ((remaining >= 0)) not valid;

alter table "private"."translation_run_quotas" validate constraint "translation_run_quotas_remaining_check";

alter table "private"."translation_runs" add constraint "translation_runs_blueprint_id_owner_id_fkey" FOREIGN KEY (blueprint_id, owner_id) REFERENCES public.blueprints(id, owner_id) ON DELETE CASCADE not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_blueprint_id_owner_id_fkey";

alter table "private"."translation_runs" add constraint "translation_runs_check" CHECK ((source_started_at < content_expires_at)) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_check";

alter table "private"."translation_runs" add constraint "translation_runs_check1" CHECK ((((status = 'cleared'::text) AND (input_page IS NULL) AND (skill IS NULL) AND (model IS NULL) AND (result IS NULL) AND (cleared_at IS NOT NULL) AND (clear_reason IS NOT NULL)) OR ((status <> 'cleared'::text) AND (input_page IS NOT NULL) AND (cleared_at IS NULL) AND (clear_reason IS NULL)))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_check1";

alter table "private"."translation_runs" add constraint "translation_runs_check2" CHECK (((status = 'cleared'::text) OR ((status = ANY (ARRAY['queued'::text, 'running'::text])) = (result IS NULL)))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_check2";

alter table "private"."translation_runs" add constraint "translation_runs_check3" CHECK (((skill IS NULL) = (model IS NULL))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_check3";

alter table "private"."translation_runs" add constraint "translation_runs_check4" CHECK (((status <> ALL (ARRAY['running'::text, 'ready'::text])) OR (skill IS NOT NULL))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_check4";

alter table "private"."translation_runs" add constraint "translation_runs_check5" CHECK (((status <> 'queued'::text) OR (skill IS NULL))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_check5";

alter table "private"."translation_runs" add constraint "translation_runs_clear_reason_check" CHECK ((clear_reason = ANY (ARRAY['manual'::text, 'expired'::text, 'source_changed'::text]))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_clear_reason_check";

alter table "private"."translation_runs" add constraint "translation_runs_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_owner_id_fkey";

alter table "private"."translation_runs" add constraint "translation_runs_page_offset_check" CHECK ((((page_offset >= 0) AND (page_offset <= 19999)) AND ((page_offset % 20) = 0))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_page_offset_check";

alter table "private"."translation_runs" add constraint "translation_runs_source_run_id_fkey" FOREIGN KEY (source_run_id) REFERENCES public.resource_runs(id) ON DELETE CASCADE not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_source_run_id_fkey";

alter table "private"."translation_runs" add constraint "translation_runs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text, 'cleared'::text]))) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_status_check";

alter table "private"."translation_runs" add constraint "translation_runs_target_language_check" CHECK ((target_language = 'zh-Hans'::text)) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_target_language_check";

alter table "private"."translation_runs" add constraint "translation_runs_video_id_check" CHECK ((video_id ~ '^[A-Za-z0-9_-]{11}$'::text)) not valid;

alter table "private"."translation_runs" validate constraint "translation_runs_video_id_check";

CREATE OR REPLACE FUNCTION private.translation_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or auth.jwt() ? 'client_id' or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'TRANSLATION_FORBIDDEN' using errcode='42501';
 end if;
 return auth.uid();
end $function$
;

CREATE OR REPLACE FUNCTION private.translation_request_valid(v jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text;
begin
 if v is null or jsonb_typeof(v)<>'object' or not(v ?& array['runId','bindingId','videoId','sourceRunId','offset','targetLanguage'])
  or v-array['runId','bindingId','videoId','sourceRunId','offset','targetLanguage']<>'{}'::jsonb then return false; end if;
 foreach k in array array['runId','bindingId','sourceRunId'] loop
  if jsonb_typeof(v->k) is distinct from 'string' or v->>k!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 end loop;
 return coalesce(jsonb_typeof(v->'videoId')='string' and v->>'videoId'~'^[A-Za-z0-9_-]{11}$'
  and v->>'targetLanguage'='zh-Hans' and jsonb_typeof(v->'offset')='number'
  and (v->>'offset')::numeric between 0 and 19999 and mod((v->>'offset')::numeric,20)=0,false);
exception when others then return false;
end $function$
;

CREATE OR REPLACE FUNCTION private.translation_source_current(r private.translation_runs)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.resource_bindings b
  join public.path_nodes n on n.id=b.node_id and n.owner_id=b.owner_id
  join public.stages s on s.id=n.stage_id and s.owner_id=n.owner_id
  join public.goals g on g.id=s.goal_id and g.owner_id=s.owner_id
  join public.resource_runs src on src.id=r.source_run_id and src.owner_id=r.owner_id
  where b.id=r.binding_id and b.owner_id=r.owner_id and n.id=r.node_id and g.blueprint_id=r.blueprint_id
   and b.archived_at is null and n.archived_at is null and s.archived_at is null and g.archived_at is null
   and b.kind='youtube_video' and b.external_id=r.video_id and b.url='https://www.youtube.com/watch?v='||r.video_id
   and src.blueprint_id=r.blueprint_id and src.node_id=r.node_id and src.status in ('ready','stale')
   and src.source_started_at=r.source_started_at and src.content_expires_at=r.content_expires_at and src.retention_policy_ref=r.retention_policy_ref
   and r.content_expires_at>clock_timestamp())
$function$
;

CREATE OR REPLACE FUNCTION private.clear_translation_run(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r private.translation_runs;
begin
 select * into r from private.translation_runs where id=p_id for update;
 if not found or r.status='cleared' then return; end if;
 if r.status='queued' then update private.translation_run_quotas set remaining=remaining+1 where owner_id=r.owner_id; end if;
 update private.translation_runs set status='cleared',input_page=null,skill=null,model=null,result=null,
  cleared_at=clock_timestamp(),clear_reason=p_reason where id=r.id;
end $function$
;

CREATE OR REPLACE FUNCTION private.reconcile_translation_runs(p_owner_id uuid, p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r private.translation_runs;
begin
 for r in select * from private.translation_runs where owner_id=p_owner_id and status<>'cleared'
  and (id=p_run_id or status in ('queued','running')) order by id for update loop
  if r.content_expires_at<=clock_timestamp() then perform private.clear_translation_run(r.id,'expired');
  elsif not private.translation_source_current(r) then perform private.clear_translation_run(r.id,'source_changed');
  elsif r.status in ('queued','running') and r.expires_at<=clock_timestamp() then
   if r.status='queued' then update private.translation_run_quotas set remaining=remaining+1 where owner_id=p_owner_id; end if;
   update private.translation_runs set status=case when r.status='queued' then 'cancelled' else 'interrupted' end,
    result=jsonb_build_object('status',case when r.status='queued' then 'cancelled' else 'timed_out' end,'providerMayHaveRun',r.status='running','usage',null) where id=r.id;
  end if;
 end loop;
end $function$
;

CREATE OR REPLACE FUNCTION private.begin_translation_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.translation_actor(); bp uuid; r private.translation_runs; src public.resource_runs; page jsonb; started timestamptz;
begin
 if not private.translation_request_valid(p_request) then raise exception 'TRANSLATION_INVALID' using errcode='22023'; end if;
 select id into bp from public.blueprints where owner_id=actor for update;
 if bp is null then raise exception 'TRANSLATION_NOT_FOUND' using errcode='P0002'; end if;
 perform private.reconcile_translation_runs(actor,(p_request->>'runId')::uuid);
 select * into r from private.translation_runs where id=(p_request->>'runId')::uuid;
 if found then
  if r.owner_id<>actor then raise exception 'TRANSLATION_NOT_FOUND' using errcode='P0002'; end if;
  if r.binding_id<>(p_request->>'bindingId')::uuid or r.video_id<>p_request->>'videoId' or r.source_run_id<>(p_request->>'sourceRunId')::uuid
   or r.page_offset<>(p_request->>'offset')::integer or r.target_language<>p_request->>'targetLanguage' then
   raise exception 'TRANSLATION_ID_REUSED' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 page:=private.read_learning_transcript((p_request->>'bindingId')::uuid,p_request->>'videoId',(p_request->>'sourceRunId')::uuid,(p_request->>'offset')::integer);
 if page->>'status'<>'ready' or jsonb_array_length(page->'segments')=0 then raise exception 'TRANSLATION_NO_EVIDENCE' using errcode='P0001'; end if;
 select * into src from public.resource_runs where id=(p_request->>'sourceRunId')::uuid and owner_id=actor;
 if src.content_expires_at<=clock_timestamp() then raise exception 'TRANSLATION_NO_EVIDENCE' using errcode='P0001'; end if;
 if exists(select 1 from private.translation_runs where owner_id=actor and status in ('queued','running')) then raise exception 'TRANSLATION_BUSY' using errcode='P0001'; end if;
 update private.translation_run_quotas set remaining=remaining-1 where owner_id=actor and remaining>0;
 if not found then raise exception 'TRANSLATION_QUOTA_EXHAUSTED' using errcode='P0001'; end if;
 started:=clock_timestamp();
 if started>=src.content_expires_at then raise exception 'TRANSLATION_NO_EVIDENCE' using errcode='P0001'; end if;
 insert into private.translation_runs(id,owner_id,blueprint_id,node_id,binding_id,video_id,source_run_id,page_offset,target_language,status,created_at,expires_at,
  source_started_at,content_expires_at,retention_policy_ref,input_page)
 values((p_request->>'runId')::uuid,actor,bp,(page#>>'{context,nodeId}')::uuid,(p_request->>'bindingId')::uuid,p_request->>'videoId',src.id,
  (p_request->>'offset')::integer,'zh-Hans','queued',started,least(started+interval '120 seconds',src.content_expires_at),src.source_started_at,src.content_expires_at,src.retention_policy_ref,page)
 returning * into r;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION private.read_translation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.translation_actor(); r private.translation_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.reconcile_translation_runs(actor,p_run_id);
 select * into r from private.translation_runs where id=p_run_id and owner_id=actor;
 if not found then raise exception 'TRANSLATION_NOT_FOUND' using errcode='P0002'; end if;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION public.begin_translation_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.begin_translation_run(p_request)$function$
;

CREATE OR REPLACE FUNCTION public.read_translation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.read_translation_run(p_run_id)$function$
;

CREATE OR REPLACE FUNCTION private.cancel_translation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.translation_actor(); r private.translation_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.reconcile_translation_runs(actor,p_run_id);
 select * into r from private.translation_runs where id=p_run_id and owner_id=actor for update;
 if not found then raise exception 'TRANSLATION_NOT_FOUND' using errcode='P0002'; end if;
 if r.status in ('queued','running') then
  if r.status='queued' then update private.translation_run_quotas set remaining=remaining+1 where owner_id=actor; end if;
  update private.translation_runs set status='cancelled',result=jsonb_build_object('status','cancelled','providerMayHaveRun',r.status='running','usage',null)
   where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION private.translation_skill_valid(v jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_typeof(v)='object' and v ?& array['name','version','sha256','instructions']
  and v-array['name','version','sha256','instructions']='{}'::jsonb
  and v->>'name'='blueprint-translate-transcript' and v->>'version'='1.0.0'
  and jsonb_typeof(v->'instructions')='string' and length(v->>'instructions')>0
  and octet_length(v->>'instructions')<=65536
  and length(v->>'instructions')+length(regexp_replace(v->>'instructions',U&'[^\+010000-\+10FFFF]','','g'))<=32000
  and v->>'sha256'=encode(sha256(convert_to(v->>'instructions','UTF8')),'hex'),false)
$function$
;

CREATE OR REPLACE FUNCTION private.claim_translation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_skill jsonb, p_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r private.translation_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'TRANSLATION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'TRANSLATION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.reconcile_translation_runs(p_owner_id,p_run_id);
 select * into r from private.translation_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'TRANSLATION_NOT_FOUND' using errcode='P0002'; end if;
 if r.status<>'queued' then return jsonb_build_object('acquired',false,'run',to_jsonb(r),'observed_at',clock_timestamp()); end if;
 if not private.translation_skill_valid(p_skill) or p_model is null or p_model!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
  raise exception 'TRANSLATION_INVALID' using errcode='22023'; end if;
 if r.content_expires_at<=clock_timestamp() then
  perform private.clear_translation_run(r.id,'expired');
  select * into r from private.translation_runs where id=r.id;
  return jsonb_build_object('acquired',false,'run',to_jsonb(r),'observed_at',clock_timestamp());
 end if;
 insert into private.translation_run_leases(run_id,lease_id) values(r.id,p_lease_id);
 update private.translation_runs set status='running',skill=p_skill,model=p_model,
  expires_at=least(clock_timestamp()+interval '120 seconds',content_expires_at) where id=r.id returning * into r;
 return jsonb_build_object('acquired',true,'run',to_jsonb(r),'observed_at',clock_timestamp());
end $function$
;

CREATE OR REPLACE FUNCTION public.cancel_translation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.cancel_translation_run(p_run_id)$function$
;

CREATE OR REPLACE FUNCTION public.claim_translation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_skill jsonb, p_model text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.claim_translation_run(p_owner_id,p_run_id,p_lease_id,p_skill,p_model)$function$
;

CREATE OR REPLACE FUNCTION private.translation_result_valid(v jsonb, p_page jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare s jsonb; k text; i integer:=0; u jsonb;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>2097152
  or not(v ?& array['status','providerMayHaveRun','usage']) or jsonb_typeof(v->'providerMayHaveRun') is distinct from 'boolean' then return false; end if;
 u:=v->'usage';
 if u<>'null'::jsonb then
  if jsonb_typeof(u)<>'object' or not(u ?& array['inputTokens','outputTokens','totalTokens']) or u-array['inputTokens','outputTokens','totalTokens']<>'{}'::jsonb then return false; end if;
  foreach k in array array['inputTokens','outputTokens','totalTokens'] loop
   if u->k<>'null'::jsonb and (jsonb_typeof(u->k)<>'number' or (u->>k)::numeric not between 0 and 9007199254740991 or mod((u->>k)::numeric,1)<>0) then return false; end if;
  end loop;
 end if;
 if v->>'status'='translated' then
  if v-array['status','providerMayHaveRun','usage','segments']<>'{}'::jsonb or v->'providerMayHaveRun'<>'true'::jsonb
   or jsonb_typeof(v->'segments') is distinct from 'array' or jsonb_array_length(v->'segments')<>jsonb_array_length(p_page->'segments') then return false; end if;
  for s in select value from jsonb_array_elements(v->'segments') loop
   if jsonb_typeof(s)<>'object' or not(s ?& array['segmentIndex','translation']) or s-array['segmentIndex','translation']<>'{}'::jsonb
    or jsonb_typeof(s->'segmentIndex') is distinct from 'number' or (s->>'segmentIndex')::numeric<>(p_page->>'offset')::integer+i
    or jsonb_typeof(s->'translation') is distinct from 'string' then return false; end if;
   if length(s->>'translation')+length(regexp_replace(s->>'translation',U&'[^\+010000-\+10FFFF]','','g')) not between 1 and 20000
    or btrim(s->>'translation',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' then return false; end if;
   i:=i+1;
  end loop;
  return i between 1 and 20;
 end if;
 return coalesce(v->>'status' in ('invalid_input','no_evidence','unavailable','cancelled','timed_out','invalid_output','expired')
  and v-array['status','providerMayHaveRun','usage']='{}'::jsonb,false);
exception when others then return false;
end $function$
;

CREATE OR REPLACE FUNCTION private.finish_translation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r private.translation_runs; lease private.translation_run_leases; fingerprint bytea;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'TRANSLATION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'TRANSLATION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.reconcile_translation_runs(p_owner_id,p_run_id);
 select * into r from private.translation_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'TRANSLATION_NOT_FOUND' using errcode='P0002'; end if;
 select * into lease from private.translation_run_leases where run_id=r.id;
 if lease.run_id is null or lease.lease_id<>p_lease_id then raise exception 'TRANSLATION_LEASE_INVALID' using errcode='42501'; end if;
 if r.status='cleared' then return to_jsonb(r); end if;
 if not private.translation_result_valid(p_result,r.input_page) then raise exception 'TRANSLATION_INVALID_RESULT' using errcode='22023'; end if;
 -- Validation/hashing can take time; the retained source deadline is authoritative.
 if r.content_expires_at<=clock_timestamp() then
  perform private.clear_translation_run(r.id,'expired');
  select * into r from private.translation_runs where id=r.id;
  return to_jsonb(r);
 end if;
 fingerprint:=sha256(convert_to(p_result::text,'UTF8'));
 if lease.completion_digest is not null then
  if lease.completion_digest<>fingerprint then raise exception 'TRANSLATION_COMPLETION_REUSED' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 update private.translation_run_leases set completion_digest=fingerprint where run_id=r.id;
 if r.status='running' then
  update private.translation_runs set status=case p_result->>'status' when 'translated' then 'ready' when 'cancelled' then 'cancelled' when 'timed_out' then 'interrupted' else 'failed' end,
   result=p_result where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION public.finish_translation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.finish_translation_run(p_owner_id,p_run_id,p_lease_id,p_result)$function$
;

CREATE OR REPLACE FUNCTION private.clear_resource_translations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r record;
begin
 for r in select id from private.translation_runs where source_run_id=new.id and status<>'cleared' order by id for update loop
  perform private.clear_translation_run(r.id,case when new.clear_reason='expired' then 'expired' else 'manual' end);
 end loop;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.protect_translation_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if row(new.id,new.owner_id,new.blueprint_id,new.node_id,new.binding_id,new.video_id,new.source_run_id,new.page_offset,new.target_language,
  new.created_at,new.source_started_at,new.content_expires_at,new.retention_policy_ref) is distinct from
  row(old.id,old.owner_id,old.blueprint_id,old.node_id,old.binding_id,old.video_id,old.source_run_id,old.page_offset,old.target_language,
  old.created_at,old.source_started_at,old.content_expires_at,old.retention_policy_ref)
  or (new.status<>'cleared' and new.input_page is distinct from old.input_page)
  or (old.status='cleared' and new is distinct from old)
  or (new.status<>'cleared' and old.skill is not null and row(new.skill,new.model) is distinct from row(old.skill,old.model)) then
  raise exception 'TRANSLATION_SOURCE_IMMUTABLE' using errcode='22023';
 end if;
 return new;
end $function$
;

CREATE TRIGGER resource_translation_clear AFTER UPDATE OF status ON public.resource_runs FOR EACH ROW WHEN (((new.status = 'cleared'::text) AND (old.status IS DISTINCT FROM 'cleared'::text))) EXECUTE FUNCTION private.clear_resource_translations();
CREATE TRIGGER translation_source_immutable BEFORE UPDATE ON private.translation_runs FOR EACH ROW EXECUTE FUNCTION private.protect_translation_source();

revoke all on private.translation_runs,private.translation_run_quotas,private.translation_run_leases from public,anon,authenticated,service_role;
revoke all on function private.translation_actor(),private.translation_request_valid(jsonb),private.translation_source_current(private.translation_runs),
 private.clear_translation_run(uuid,text),private.reconcile_translation_runs(uuid,uuid),private.begin_translation_run(jsonb),private.read_translation_run(uuid),
 public.begin_translation_run(jsonb),public.read_translation_run(uuid) from public,anon,authenticated,service_role;
grant execute on function private.begin_translation_run(jsonb),private.read_translation_run(uuid),public.begin_translation_run(jsonb),public.read_translation_run(uuid) to authenticated;
revoke all on function private.cancel_translation_run(uuid),private.translation_skill_valid(jsonb),private.claim_translation_run(uuid,uuid,uuid,jsonb,text),
 public.cancel_translation_run(uuid),public.claim_translation_run(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.cancel_translation_run(uuid),public.cancel_translation_run(uuid) to authenticated;
grant execute on function private.claim_translation_run(uuid,uuid,uuid,jsonb,text),public.claim_translation_run(uuid,uuid,uuid,jsonb,text) to service_role;
revoke all on function private.translation_result_valid(jsonb,jsonb),private.finish_translation_run(uuid,uuid,uuid,jsonb),public.finish_translation_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.finish_translation_run(uuid,uuid,uuid,jsonb),public.finish_translation_run(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function private.clear_resource_translations(),private.protect_translation_source() from public,anon,authenticated,service_role;
