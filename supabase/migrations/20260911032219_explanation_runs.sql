-- Local CLI schema pull, dependency-ordered with explicit least-privilege ACLs.
  create table "private"."explanation_run_leases" (
    "run_id" uuid not null,
    "lease_id" uuid not null,
    "completion_digest" bytea
      );


alter table "private"."explanation_run_leases" enable row level security;


  create table "private"."explanation_run_quotas" (
    "owner_id" uuid not null,
    "remaining" integer not null default 0
      );


alter table "private"."explanation_run_quotas" enable row level security;


  create table "private"."explanation_runs" (
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
    "selection" jsonb,
    "question" text,
    "request_fingerprint" text not null,
    "skill" jsonb,
    "model" text,
    "result" jsonb,
    "cleared_at" timestamp with time zone,
    "clear_reason" text
      );


alter table "private"."explanation_runs" enable row level security;

CREATE INDEX explanation_blueprint_owner ON private.explanation_runs USING btree (blueprint_id, owner_id);

CREATE UNIQUE INDEX explanation_one_active_owner ON private.explanation_runs USING btree (owner_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]));

CREATE INDEX explanation_owner ON private.explanation_runs USING btree (owner_id);

CREATE UNIQUE INDEX explanation_run_leases_pkey ON private.explanation_run_leases USING btree (run_id);

CREATE UNIQUE INDEX explanation_run_quotas_pkey ON private.explanation_run_quotas USING btree (owner_id);

CREATE INDEX explanation_runs_page_latest_idx ON private.explanation_runs USING btree (owner_id, request_fingerprint, created_at DESC, id DESC);

CREATE UNIQUE INDEX explanation_runs_pkey ON private.explanation_runs USING btree (id);

CREATE INDEX explanation_source ON private.explanation_runs USING btree (source_run_id);

alter table "private"."explanation_run_leases" add constraint "explanation_run_leases_pkey" PRIMARY KEY using index "explanation_run_leases_pkey";

alter table "private"."explanation_run_quotas" add constraint "explanation_run_quotas_pkey" PRIMARY KEY using index "explanation_run_quotas_pkey";

alter table "private"."explanation_runs" add constraint "explanation_runs_pkey" PRIMARY KEY using index "explanation_runs_pkey";

alter table "private"."explanation_run_leases" add constraint "explanation_run_leases_run_id_fkey" FOREIGN KEY (run_id) REFERENCES private.explanation_runs(id) ON DELETE CASCADE not valid;

alter table "private"."explanation_run_leases" validate constraint "explanation_run_leases_run_id_fkey";

alter table "private"."explanation_run_quotas" add constraint "explanation_run_quotas_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "private"."explanation_run_quotas" validate constraint "explanation_run_quotas_owner_id_fkey";

alter table "private"."explanation_run_quotas" add constraint "explanation_run_quotas_remaining_check" CHECK ((remaining >= 0)) not valid;

alter table "private"."explanation_run_quotas" validate constraint "explanation_run_quotas_remaining_check";

alter table "private"."explanation_runs" add constraint "explanation_runs_blueprint_id_owner_id_fkey" FOREIGN KEY (blueprint_id, owner_id) REFERENCES public.blueprints(id, owner_id) ON DELETE CASCADE not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_blueprint_id_owner_id_fkey";

alter table "private"."explanation_runs" add constraint "explanation_runs_check" CHECK ((source_started_at < content_expires_at)) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_check";

alter table "private"."explanation_runs" add constraint "explanation_runs_check1" CHECK ((((status = 'cleared'::text) AND (input_page IS NULL) AND (selection IS NULL) AND (question IS NULL) AND (skill IS NULL) AND (model IS NULL) AND (result IS NULL) AND (cleared_at IS NOT NULL) AND (clear_reason IS NOT NULL)) OR ((status <> 'cleared'::text) AND (input_page IS NOT NULL) AND (selection IS NOT NULL) AND (question IS NOT NULL) AND (cleared_at IS NULL) AND (clear_reason IS NULL)))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_check1";

alter table "private"."explanation_runs" add constraint "explanation_runs_check2" CHECK (((status = 'cleared'::text) OR ((status = ANY (ARRAY['queued'::text, 'running'::text])) = (result IS NULL)))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_check2";

alter table "private"."explanation_runs" add constraint "explanation_runs_check3" CHECK (((skill IS NULL) = (model IS NULL))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_check3";

alter table "private"."explanation_runs" add constraint "explanation_runs_check4" CHECK (((status <> ALL (ARRAY['running'::text, 'ready'::text])) OR (skill IS NOT NULL))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_check4";

alter table "private"."explanation_runs" add constraint "explanation_runs_check5" CHECK (((status <> 'queued'::text) OR (skill IS NULL))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_check5";

alter table "private"."explanation_runs" add constraint "explanation_runs_clear_reason_check" CHECK ((clear_reason = ANY (ARRAY['manual'::text, 'expired'::text, 'source_changed'::text]))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_clear_reason_check";

alter table "private"."explanation_runs" add constraint "explanation_runs_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_owner_id_fkey";

alter table "private"."explanation_runs" add constraint "explanation_runs_page_offset_check" CHECK (((page_offset >= 0) AND (page_offset <= 19999) AND ((page_offset % 20) = 0))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_page_offset_check";

alter table "private"."explanation_runs" add constraint "explanation_runs_request_fingerprint_check" CHECK ((request_fingerprint ~ '^[0-9a-f]{64}$'::text)) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_request_fingerprint_check";

alter table "private"."explanation_runs" add constraint "explanation_runs_source_run_id_fkey" FOREIGN KEY (source_run_id) REFERENCES public.resource_runs(id) ON DELETE CASCADE not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_source_run_id_fkey";

alter table "private"."explanation_runs" add constraint "explanation_runs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text, 'cancelled'::text, 'interrupted'::text, 'cleared'::text]))) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_status_check";

alter table "private"."explanation_runs" add constraint "explanation_runs_target_language_check" CHECK ((target_language = 'zh-Hans'::text)) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_target_language_check";

alter table "private"."explanation_runs" add constraint "explanation_runs_video_id_check" CHECK ((video_id ~ '^[A-Za-z0-9_-]{11}$'::text)) not valid;

alter table "private"."explanation_runs" validate constraint "explanation_runs_video_id_check";

-- UTF16 offsets are browser offsets, not PostgreSQL character offsets.
create function private.explanation_utf16_length(t text) returns integer language sql immutable strict set search_path='' as $$
 select length(t)+length(regexp_replace(t,U&'[^\+010000-\+10FFFF]','','g'))
$$;
create function private.explanation_nonblank(t text) returns boolean language sql immutable strict set search_path='' as $$
 select btrim(t,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>''
$$;
-- A zero-based codepoint boundary, or NULL when the requested UTF16 boundary splits an astral character.
create function private.explanation_boundary(t text, u integer) returns integer language plpgsql immutable strict set search_path='' as $$
declare i integer:=0; units integer:=0; c text;
begin
 if u<0 then return null; end if;
 if u=0 then return 0; end if;
 for c in select regexp_split_to_table(t,'') loop
  i:=i+1; units:=units+case when ascii(c)>65535 then 2 else 1 end;
  if units=u then return i; elsif units>u then return null; end if;
 end loop;
 return null;
end $$;
create function private.explanation_fingerprint(v jsonb) returns text language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(((v-'runId')||jsonb_build_object('bindingId',(v->>'bindingId')::uuid,'sourceRunId',(v->>'sourceRunId')::uuid,'offset',(v->>'offset')::numeric::integer,
 'selection',jsonb_build_object('start',jsonb_build_object('segmentIndex',(v#>>'{selection,start,segmentIndex}')::numeric::integer,'charOffset',(v#>>'{selection,start,charOffset}')::numeric::integer),'end',jsonb_build_object('segmentIndex',(v#>>'{selection,end,segmentIndex}')::numeric::integer,'charOffset',(v#>>'{selection,end,charOffset}')::numeric::integer))))::text,'UTF8')),'hex')
$$;
-- Returns only bounded excerpt text and selected codepoint boundaries, never accepts supplied caption text.
create function private.explanation_evidence(p_page jsonb, p_selection jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare a integer; b integer; ao integer; bo integer; off integer; neighbor_index integer; lo integer; hi integer; lcp integer; hcp integer; elo integer; ehi integer; total integer:=0; parts integer:=0; alltext text:=''; t text; piece text; n integer; entries jsonb:='[]'::jsonb;
begin
 a:=(p_selection#>>'{start,segmentIndex}')::numeric::integer; b:=(p_selection#>>'{end,segmentIndex}')::numeric::integer;
 ao:=(p_selection#>>'{start,charOffset}')::numeric::integer; bo:=(p_selection#>>'{end,charOffset}')::numeric::integer; off:=(p_page->>'offset')::integer;
 if a<off or b<a or b-a>=5 or b>=off+jsonb_array_length(p_page->'segments') then return null; end if;
 for i in a..b loop
  t:=p_page#>>array['segments',(i-off)::text,'text']; n:=private.explanation_utf16_length(t);
  lo:=case when i=a then ao else 0 end; hi:=case when i=b then bo else n end;
  lcp:=private.explanation_boundary(t,lo); hcp:=private.explanation_boundary(t,hi);
  if lcp is null or hcp is null or hi<lo then return null; end if;
  if hi>lo then
   piece:=substring(t from lcp+1 for hcp-lcp); total:=total+hi-lo+case when parts>0 then 1 else 0 end; parts:=parts+1; alltext:=alltext||piece;
  end if;
  if total>2000 then return null; end if;
  elo:=greatest(0,lo-256); ehi:=least(n,hi+256);
  if private.explanation_boundary(t,elo) is null then elo:=elo+1; end if;
  if private.explanation_boundary(t,ehi) is null then ehi:=ehi-1; end if;
  elo:=private.explanation_boundary(t,elo); ehi:=private.explanation_boundary(t,ehi);
  entries:=entries||jsonb_build_array(jsonb_build_object('segmentIndex',i,'text',substring(t from elo+1 for ehi-elo),'start',lcp-elo,'end',hcp-elo,'startChar',private.explanation_utf16_length(substring(t from 1 for elo)),'selectionStartChar',lo,'selectionEndChar',hi));
 end loop;
 if parts=0 or not private.explanation_nonblank(alltext) then return null; end if;
 -- Neighbor context is based on the requested first/last segment, matching the engine.
 for neighbor_index in select x from unnest(array[a-1,b+1]) x where x>=off and x<off+jsonb_array_length(p_page->'segments') loop
  t:=p_page#>>array['segments',(neighbor_index-off)::text,'text']; n:=private.explanation_utf16_length(t);
  elo:=case when neighbor_index<a then greatest(0,n-256) else 0 end; ehi:=case when neighbor_index<a then n else least(n,256) end;
  if private.explanation_boundary(t,elo) is null then elo:=elo+1; end if;
  if private.explanation_boundary(t,ehi) is null then ehi:=ehi-1; end if;
  elo:=private.explanation_boundary(t,elo); ehi:=private.explanation_boundary(t,ehi);
  entries:=entries||jsonb_build_array(jsonb_build_object('segmentIndex',neighbor_index,'text',substring(t from elo+1 for ehi-elo),'start',null,'end',null,'startChar',private.explanation_utf16_length(substring(t from 1 for elo))));
 end loop;
 return entries;
exception when others then return null;
end $$;
revoke all on function private.explanation_utf16_length(text),private.explanation_nonblank(text),private.explanation_boundary(text,integer),private.explanation_fingerprint(jsonb),private.explanation_evidence(jsonb,jsonb) from public,anon,authenticated,service_role;


-- Compact JSON serialization size, preserving whitespace and escapes INSIDE strings.
-- These payloads contain strings, nulls, arrays, objects and normalized integer offsets.
create function private.explanation_json_bytes(v jsonb) returns integer language plpgsql stable strict set search_path='' as $$
declare total integer:=2; n integer:=0; entry record;
begin
 if jsonb_typeof(v)='object' then
  for entry in select key,value from jsonb_each(v) loop
   total:=total+octet_length(to_jsonb(entry.key)::text)+1+private.explanation_json_bytes(entry.value); n:=n+1;
  end loop;
  return total+greatest(0,n-1);
 elsif jsonb_typeof(v)='array' then
  for entry in select value from jsonb_array_elements(v) loop total:=total+private.explanation_json_bytes(entry.value); n:=n+1; end loop;
  return total+greatest(0,n-1);
 end if;
 return octet_length(v::text);
end $$;
create function private.explanation_prompt_fits(p_page jsonb,p_selection jsonb,p_question text) returns boolean language plpgsql stable set search_path='' as $$
declare derived jsonb:=private.explanation_evidence(p_page,p_selection); entry jsonb; selected jsonb:='[]'::jsonb; excerpts jsonb:='[]'::jsonb; lo integer; hi integer;
begin
 if derived is null then return false; end if;
 for entry in select value from jsonb_array_elements(derived) loop
  excerpts:=excerpts||jsonb_build_array(jsonb_build_object('segmentIndex',(entry->>'segmentIndex')::integer,'startChar',(entry->>'startChar')::integer,'text',entry->>'text'));
  if entry->'start'<>'null'::jsonb and (entry->>'end')::integer>(entry->>'start')::integer then
   lo:=(entry->>'start')::integer; hi:=(entry->>'end')::integer;
   selected:=selected||jsonb_build_array(jsonb_build_object('segmentIndex',(entry->>'segmentIndex')::integer,'startChar',(entry->>'selectionStartChar')::integer,'endChar',(entry->>'selectionEndChar')::integer,'text',substring(entry->>'text' from lo+1 for hi-lo)));
  end if;
 end loop;
 return private.explanation_json_bytes(jsonb_build_object('sourceLanguage',p_page->'language','targetLanguage','zh-Hans','question',p_question,'selected',selected,'excerpts',excerpts))<=32768;
end $$;
revoke all on function private.explanation_json_bytes(jsonb),private.explanation_prompt_fits(jsonb,jsonb,text) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.explanation_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'EXPLANATION_FORBIDDEN' using errcode='42501';
 end if;
 if auth.jwt() ? 'client_id' and (jsonb_typeof(auth.jwt()->'client_id') is distinct from 'string' or btrim(auth.jwt()->>'client_id')='' or not private.can_access_progress_evidence()) then raise exception 'EXPLANATION_FORBIDDEN' using errcode='42501'; end if;
 return auth.uid();
end $function$
;

CREATE OR REPLACE FUNCTION private.explanation_request_valid(v jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare k text;
begin
 if v is null or jsonb_typeof(v)<>'object' or not(v ?& array['runId','bindingId','videoId','sourceRunId','offset','targetLanguage','selection','question'])
  or v-array['runId','bindingId','videoId','sourceRunId','offset','targetLanguage','selection','question']<>'{}'::jsonb then return false; end if;
 foreach k in array array['runId','bindingId','sourceRunId'] loop
  if jsonb_typeof(v->k) is distinct from 'string' or v->>k!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
 end loop;
 if jsonb_typeof(v->'question') is distinct from 'string' or private.explanation_utf16_length(v->>'question')>1000 or jsonb_typeof(v->'selection') is distinct from 'object' or not(v->'selection' ?& array['start','end']) or (v->'selection')-array['start','end']<>'{}'::jsonb then return false; end if;
 foreach k in array array['start','end'] loop
  if jsonb_typeof(v#>array['selection',k]) is distinct from 'object' or not(v#>array['selection',k] ?& array['segmentIndex','charOffset']) or (v#>array['selection',k])-array['segmentIndex','charOffset']<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(v#>array['selection',k,'segmentIndex']) is distinct from 'number' or jsonb_typeof(v#>array['selection',k,'charOffset']) is distinct from 'number' or (v#>>array['selection',k,'segmentIndex'])::numeric not between 0 and 19999 or mod((v#>>array['selection',k,'segmentIndex'])::numeric,1)<>0 or (v#>>array['selection',k,'charOffset'])::numeric not between 0 and 20000 or mod((v#>>array['selection',k,'charOffset'])::numeric,1)<>0 then return false; end if;
 end loop;
 return coalesce(jsonb_typeof(v->'videoId')='string' and v->>'videoId'~'^[A-Za-z0-9_-]{11}$'
  and v->>'targetLanguage'='zh-Hans' and jsonb_typeof(v->'offset')='number'
  and (v->>'offset')::numeric between 0 and 19999 and mod((v->>'offset')::numeric,20)=0,false);
exception when others then return false;
end $function$
;

CREATE OR REPLACE FUNCTION private.explanation_source_current(r private.explanation_runs)
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

CREATE OR REPLACE FUNCTION private.clear_explanation_run(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r private.explanation_runs;
begin
 select * into r from private.explanation_runs where id=p_id for update;
 if not found or r.status='cleared' then return; end if;
 if r.status='queued' then update private.explanation_run_quotas set remaining=remaining+1 where owner_id=r.owner_id; end if;
 update private.explanation_runs set status='cleared',input_page=null,selection=null,question=null,skill=null,model=null,result=null,
  cleared_at=clock_timestamp(),clear_reason=p_reason where id=r.id;
end $function$
;

CREATE OR REPLACE FUNCTION private.reconcile_explanation_runs(p_owner_id uuid, p_run_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r private.explanation_runs;
begin
 for r in select * from private.explanation_runs where owner_id=p_owner_id and status<>'cleared'
  and (id=p_run_id or status in ('queued','running')) order by id for update loop
  if r.content_expires_at<=clock_timestamp() then perform private.clear_explanation_run(r.id,'expired');
  elsif not private.explanation_source_current(r) then perform private.clear_explanation_run(r.id,'source_changed');
  elsif r.status in ('queued','running') and r.expires_at<=clock_timestamp() then
   if r.status='queued' then update private.explanation_run_quotas set remaining=remaining+1 where owner_id=p_owner_id; end if;
   update private.explanation_runs set status=case when r.status='queued' then 'cancelled' else 'interrupted' end,
    result=jsonb_build_object('status',case when r.status='queued' then 'cancelled' else 'timed_out' end,'providerMayHaveRun',r.status='running','usage',null) where id=r.id;
  end if;
 end loop;
end $function$
;

CREATE OR REPLACE FUNCTION private.begin_explanation_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.explanation_actor(); bp uuid; r private.explanation_runs; src public.resource_runs; page jsonb; started timestamptz;
begin
 if not private.explanation_request_valid(p_request) then raise exception 'EXPLANATION_INVALID' using errcode='22023'; end if;
 select id into bp from public.blueprints where owner_id=actor for update;
 if bp is null then raise exception 'EXPLANATION_NOT_FOUND' using errcode='P0002'; end if;
 perform private.reconcile_explanation_runs(actor,(p_request->>'runId')::uuid);
 select * into r from private.explanation_runs where id=(p_request->>'runId')::uuid;
 if found then
  if r.owner_id<>actor then raise exception 'EXPLANATION_NOT_FOUND' using errcode='P0002'; end if;
  if r.request_fingerprint<>private.explanation_fingerprint(p_request) then
   raise exception 'EXPLANATION_ID_REUSED' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 page:=private.read_learning_transcript((p_request->>'bindingId')::uuid,p_request->>'videoId',(p_request->>'sourceRunId')::uuid,(p_request->>'offset')::numeric::integer);
 if page->>'status'<>'ready' or jsonb_array_length(page->'segments')=0 then raise exception 'EXPLANATION_NO_EVIDENCE' using errcode='P0001'; end if;
 if not private.explanation_prompt_fits(page,p_request->'selection',p_request->>'question') then raise exception 'EXPLANATION_INVALID' using errcode='22023'; end if;
 select * into src from public.resource_runs where id=(p_request->>'sourceRunId')::uuid and owner_id=actor;
 if src.content_expires_at<=clock_timestamp() then raise exception 'EXPLANATION_NO_EVIDENCE' using errcode='P0001'; end if;
 if exists(select 1 from private.explanation_runs where owner_id=actor and status in ('queued','running')) then raise exception 'EXPLANATION_BUSY' using errcode='P0001'; end if;
 update private.explanation_run_quotas set remaining=remaining-1 where owner_id=actor and remaining>0;
 if not found then raise exception 'EXPLANATION_QUOTA_EXHAUSTED' using errcode='P0001'; end if;
 started:=clock_timestamp();
 if started>=src.content_expires_at then raise exception 'EXPLANATION_NO_EVIDENCE' using errcode='P0001'; end if;
 insert into private.explanation_runs(id,owner_id,blueprint_id,node_id,binding_id,video_id,source_run_id,page_offset,target_language,status,created_at,expires_at,
  source_started_at,content_expires_at,retention_policy_ref,input_page,selection,question,request_fingerprint)
 values((p_request->>'runId')::uuid,actor,bp,(page#>>'{context,nodeId}')::uuid,(p_request->>'bindingId')::uuid,p_request->>'videoId',src.id,
  (p_request->>'offset')::numeric::integer,'zh-Hans','queued',started,least(started+interval '120 seconds',src.content_expires_at),src.source_started_at,src.content_expires_at,src.retention_policy_ref,page,p_request->'selection',p_request->>'question',private.explanation_fingerprint(p_request))
 returning * into r;
 return to_jsonb(r);
end $function$
;

create function public.begin_explanation_run(p_request jsonb) returns jsonb language sql set search_path='' as $$select private.begin_explanation_run(p_request)$$;
revoke all on private.explanation_runs,private.explanation_run_quotas,private.explanation_run_leases from public,anon,authenticated,service_role;
revoke all on function private.explanation_actor(),private.explanation_request_valid(jsonb),private.explanation_source_current(private.explanation_runs),private.clear_explanation_run(uuid,text),private.reconcile_explanation_runs(uuid,uuid),private.begin_explanation_run(jsonb),public.begin_explanation_run(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.begin_explanation_run(jsonb),public.begin_explanation_run(jsonb) to authenticated;
CREATE OR REPLACE FUNCTION private.read_explanation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.explanation_actor(); r private.explanation_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.reconcile_explanation_runs(actor,p_run_id);
 select * into r from private.explanation_runs where id=p_run_id and owner_id=actor;
 if not found then raise exception 'EXPLANATION_NOT_FOUND' using errcode='P0002'; end if;
 return to_jsonb(r);
end $function$
;


CREATE OR REPLACE FUNCTION public.read_explanation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.read_explanation_run(p_run_id)$function$
;

CREATE OR REPLACE FUNCTION private.cancel_explanation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=private.explanation_actor(); r private.explanation_runs;
begin
 perform 1 from public.blueprints where owner_id=actor for update;
 perform private.reconcile_explanation_runs(actor,p_run_id);
 select * into r from private.explanation_runs where id=p_run_id and owner_id=actor for update;
 if not found then raise exception 'EXPLANATION_NOT_FOUND' using errcode='P0002'; end if;
 if r.status in ('queued','running') then
  if r.status='queued' then update private.explanation_run_quotas set remaining=remaining+1 where owner_id=actor; end if;
  update private.explanation_runs set status='cancelled',result=jsonb_build_object('status','cancelled','providerMayHaveRun',r.status='running','usage',null)
   where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION private.explanation_skill_valid(v jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_typeof(v)='object' and v ?& array['name','version','sha256','instructions']
  and v-array['name','version','sha256','instructions']='{}'::jsonb
  and v->>'name'='blueprint-explain-selection' and v->>'version'='1.0.0'
  and jsonb_typeof(v->'instructions')='string' and length(v->>'instructions')>0
  and octet_length(v->>'instructions')<=65536
  and length(v->>'instructions')+length(regexp_replace(v->>'instructions',U&'[^\+010000-\+10FFFF]','','g'))<=32000
  and v->>'sha256'=encode(sha256(convert_to(v->>'instructions','UTF8')),'hex'),false)
$function$
;

CREATE OR REPLACE FUNCTION private.claim_explanation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_skill jsonb, p_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r private.explanation_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'EXPLANATION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'EXPLANATION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.reconcile_explanation_runs(p_owner_id,p_run_id);
 select * into r from private.explanation_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'EXPLANATION_NOT_FOUND' using errcode='P0002'; end if;
 if r.status<>'queued' then return jsonb_build_object('acquired',false,'run',to_jsonb(r),'observed_at',clock_timestamp()); end if;
 if not private.explanation_skill_valid(p_skill) or p_model is null or p_model!~'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
  raise exception 'EXPLANATION_INVALID' using errcode='22023'; end if;
 if r.content_expires_at<=clock_timestamp() then
  perform private.clear_explanation_run(r.id,'expired');
  select * into r from private.explanation_runs where id=r.id;
  return jsonb_build_object('acquired',false,'run',to_jsonb(r),'observed_at',clock_timestamp());
 end if;
 -- Skill validation must not revive a queue whose operation deadline elapsed.
 perform private.reconcile_explanation_runs(p_owner_id,p_run_id);
 select * into r from private.explanation_runs where id=p_run_id and owner_id=p_owner_id;
 if r.status<>'queued' then return jsonb_build_object('acquired',false,'run',to_jsonb(r),'observed_at',clock_timestamp()); end if;
 insert into private.explanation_run_leases(run_id,lease_id) values(r.id,p_lease_id);
 update private.explanation_runs set status='running',skill=p_skill,model=p_model,
  expires_at=least(clock_timestamp()+interval '120 seconds',content_expires_at) where id=r.id returning * into r;
 return jsonb_build_object('acquired',true,'run',to_jsonb(r),'observed_at',clock_timestamp());
end $function$
;

CREATE OR REPLACE FUNCTION public.cancel_explanation_run(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.cancel_explanation_run(p_run_id)$function$
;

CREATE OR REPLACE FUNCTION public.claim_explanation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_skill jsonb, p_model text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.claim_explanation_run(p_owner_id,p_run_id,p_lease_id,p_skill,p_model)$function$
;

revoke all on function private.read_explanation_run(uuid),public.read_explanation_run(uuid),private.cancel_explanation_run(uuid),public.cancel_explanation_run(uuid),private.explanation_skill_valid(jsonb),private.claim_explanation_run(uuid,uuid,uuid,jsonb,text),public.claim_explanation_run(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function private.read_explanation_run(uuid),public.read_explanation_run(uuid),private.cancel_explanation_run(uuid),public.cancel_explanation_run(uuid) to authenticated;
grant execute on function private.claim_explanation_run(uuid,uuid,uuid,jsonb,text),public.claim_explanation_run(uuid,uuid,uuid,jsonb,text) to service_role;

create function private.explanation_prose(v jsonb, lim integer) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and private.explanation_utf16_length(v#>>'{}') between 1 and lim and private.explanation_nonblank(v#>>'{}'),false)
$$;
create function private.explanation_result_valid(v jsonb, p_page jsonb, p_selection jsonb) returns boolean language plpgsql stable set search_path='' as $$
declare u jsonb; k text; a jsonb; e jsonb; excerpts jsonb; ex jsonb; seen jsonb:='[]'::jsonb; quoted text; at integer; rel integer; lo integer; hi integer; hit boolean:=false;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>2097152 or not(v ?& array['status','providerMayHaveRun','usage']) or jsonb_typeof(v->'providerMayHaveRun') is distinct from 'boolean' or jsonb_typeof(v->'status') is distinct from 'string' then return false; end if;
 u:=v->'usage';
 if u<>'null'::jsonb then
  if jsonb_typeof(u)<>'object' or not(u ?& array['inputTokens','outputTokens','totalTokens']) or u-array['inputTokens','outputTokens','totalTokens']<>'{}'::jsonb then return false; end if;
  foreach k in array array['inputTokens','outputTokens','totalTokens'] loop
   if u->k<>'null'::jsonb and (jsonb_typeof(u->k)<>'number' or (u->>k)::numeric not between 0 and 9007199254740991 or mod((u->>k)::numeric,1)<>0) then return false; end if;
  end loop;
 end if;
 if v->>'status' not in ('explained','insufficient_context') then
  return coalesce(v->>'status' in ('invalid_input','no_evidence','unavailable','cancelled','timed_out','invalid_output','expired') and v-array['status','providerMayHaveRun','usage']='{}'::jsonb,false);
 end if;
 if v-array['status','providerMayHaveRun','usage','answer']<>'{}'::jsonb or v->'providerMayHaveRun'<>'true'::jsonb or jsonb_typeof(v->'answer') is distinct from 'object' then return false; end if;
 a:=v->'answer';
 if v->>'status'='insufficient_context' then
  if not(a ?& array['kind','reason','missingContext']) or a-array['kind','reason','missingContext']<>'{}'::jsonb or a->>'kind' is distinct from 'insufficient_context' or not private.explanation_prose(a->'reason',1000) or jsonb_typeof(a->'missingContext') is distinct from 'array' or jsonb_array_length(a->'missingContext') not between 1 and 3 then return false; end if;
  for e in select value from jsonb_array_elements(a->'missingContext') loop if not private.explanation_prose(e,500) then return false; end if; end loop;
  return true;
 end if;
 if not(a ?& array['kind','meaning','reasoning','background','checkQuestion','limitations','evidence']) or a-array['kind','meaning','reasoning','background','checkQuestion','limitations','evidence']<>'{}'::jsonb or a->>'kind' is distinct from 'explanation'
  or not private.explanation_prose(a->'meaning',2000) or not private.explanation_prose(a->'reasoning',3000)
  or (a->'background'<>'null'::jsonb and not private.explanation_prose(a->'background',2000))
  or (a->'checkQuestion'<>'null'::jsonb and not private.explanation_prose(a->'checkQuestion',500))
  or jsonb_typeof(a->'limitations') is distinct from 'array' or jsonb_array_length(a->'limitations')>3
  or jsonb_typeof(a->'evidence') is distinct from 'array' or jsonb_array_length(a->'evidence') not between 1 and 3 then return false; end if;
 for e in select value from jsonb_array_elements(a->'limitations') loop if not private.explanation_prose(e,500) then return false; end if; end loop;
 excerpts:=private.explanation_evidence(p_page,p_selection); if excerpts is null then return false; end if;
 for e in select value from jsonb_array_elements(a->'evidence') loop
  if jsonb_typeof(e)<>'object' or not(e ?& array['segmentIndex','quote']) or e-array['segmentIndex','quote']<>'{}'::jsonb or jsonb_typeof(e->'segmentIndex') is distinct from 'number' or (e->>'segmentIndex')::numeric not between 0 and 19999 or mod((e->>'segmentIndex')::numeric,1)<>0 or not private.explanation_prose(e->'quote',300) or seen @> jsonb_build_array(e) then return false; end if;
  seen:=seen||jsonb_build_array(e);
  select x into ex from jsonb_array_elements(excerpts) x where (x->>'segmentIndex')::integer=(e->>'segmentIndex')::numeric::integer;
  quoted:=e->>'quote'; if ex is null or strpos(ex->>'text',quoted)=0 then return false; end if;
  -- Enumerate every occurrence; an earlier context occurrence cannot hide a later selected one.
  at:=0;
  loop
   rel:=strpos(substring(ex->>'text' from at+1),quoted); exit when rel=0; at:=at+rel-1;
   if ex->'start'<>'null'::jsonb then
    lo:=greatest((ex->>'start')::integer,at); hi:=least((ex->>'end')::integer,at+length(quoted));
    if hi>lo and private.explanation_nonblank(substring(ex->>'text' from lo+1 for hi-lo)) then hit:=true; end if;
   end if;
   at:=at+1;
  end loop;
 end loop;
 return hit;
exception when others then return false;
end $$;
revoke all on function private.explanation_prose(jsonb,integer),private.explanation_result_valid(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.finish_explanation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r private.explanation_runs; lease private.explanation_run_leases; fingerprint bytea;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'EXPLANATION_FORBIDDEN' using errcode='42501'; end if;
 if p_owner_id is null or p_run_id is null or p_lease_id is null then raise exception 'EXPLANATION_INVALID' using errcode='22023'; end if;
 perform 1 from public.blueprints where owner_id=p_owner_id for update;
 perform private.reconcile_explanation_runs(p_owner_id,p_run_id);
 select * into r from private.explanation_runs where id=p_run_id and owner_id=p_owner_id for update;
 if not found then raise exception 'EXPLANATION_NOT_FOUND' using errcode='P0002'; end if;
 select * into lease from private.explanation_run_leases where run_id=r.id;
 if lease.run_id is null or lease.lease_id<>p_lease_id then raise exception 'EXPLANATION_LEASE_INVALID' using errcode='42501'; end if;
 if r.status='cleared' then return to_jsonb(r); end if;
 if not private.explanation_result_valid(p_result,r.input_page,r.selection) then raise exception 'EXPLANATION_INVALID_RESULT' using errcode='22023'; end if;
 -- Validation/hashing can take time; the retained source deadline is authoritative.
 if r.content_expires_at<=clock_timestamp() then
  perform private.clear_explanation_run(r.id,'expired');
  select * into r from private.explanation_runs where id=r.id;
  return to_jsonb(r);
 end if;
 -- Unicode/quotation validation can cross the execution deadline as well as source TTL.
 perform private.reconcile_explanation_runs(p_owner_id,p_run_id);
 select * into r from private.explanation_runs where id=p_run_id and owner_id=p_owner_id;
 if r.status='cleared' then return to_jsonb(r); end if;
 fingerprint:=sha256(convert_to(p_result::text,'UTF8'));
 if lease.completion_digest is not null then
  if lease.completion_digest<>fingerprint then raise exception 'EXPLANATION_COMPLETION_REUSED' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 update private.explanation_run_leases set completion_digest=fingerprint where run_id=r.id;
 if r.status='running' then
  update private.explanation_runs set status=case p_result->>'status' when 'explained' then 'ready' when 'insufficient_context' then 'ready' when 'cancelled' then 'cancelled' when 'timed_out' then 'interrupted' else 'failed' end,
   result=p_result where id=r.id returning * into r;
 end if;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION public.finish_explanation_run(p_owner_id uuid, p_run_id uuid, p_lease_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.finish_explanation_run(p_owner_id,p_run_id,p_lease_id,p_result)$function$
;

revoke all on function private.finish_explanation_run(uuid,uuid,uuid,jsonb),public.finish_explanation_run(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.finish_explanation_run(uuid,uuid,uuid,jsonb),public.finish_explanation_run(uuid,uuid,uuid,jsonb) to service_role;
CREATE OR REPLACE FUNCTION private.clear_resource_explanations()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r record;
begin
 for r in select id from private.explanation_runs where source_run_id=new.id and status<>'cleared' order by id for update loop
  perform private.clear_explanation_run(r.id,case when new.clear_reason='expired' then 'expired' else 'manual' end);
 end loop;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION private.protect_explanation_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if row(new.id,new.owner_id,new.blueprint_id,new.node_id,new.binding_id,new.video_id,new.source_run_id,new.page_offset,new.target_language,
  new.request_fingerprint,new.created_at,new.source_started_at,new.content_expires_at,new.retention_policy_ref) is distinct from
  row(old.id,old.owner_id,old.blueprint_id,old.node_id,old.binding_id,old.video_id,old.source_run_id,old.page_offset,old.target_language,
  old.request_fingerprint,old.created_at,old.source_started_at,old.content_expires_at,old.retention_policy_ref)
  or (new.status<>'cleared' and row(new.input_page,new.selection,new.question) is distinct from row(old.input_page,old.selection,old.question))
  or (old.status='cleared' and new is distinct from old)
  or (new.status<>'cleared' and old.skill is not null and row(new.skill,new.model) is distinct from row(old.skill,old.model)) then
  raise exception 'EXPLANATION_SOURCE_IMMUTABLE' using errcode='22023';
 end if;
 return new;
end $function$
;

CREATE TRIGGER resource_explanation_clear AFTER UPDATE OF status ON public.resource_runs FOR EACH ROW WHEN (((new.status = 'cleared'::text) AND (old.status IS DISTINCT FROM 'cleared'::text))) EXECUTE FUNCTION private.clear_resource_explanations();
CREATE TRIGGER explanation_source_immutable BEFORE UPDATE ON private.explanation_runs FOR EACH ROW EXECUTE FUNCTION private.protect_explanation_source();
revoke all on function private.clear_resource_explanations(),private.protect_explanation_source() from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.find_explanation_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid; found_id uuid;
begin
  actor:=private.explanation_actor();
  -- Reuse the creation contract without accepting a client-selected run ID.
  if p_request is null or jsonb_typeof(p_request) is distinct from 'object' or p_request ? 'runId'
    or not private.explanation_request_valid(p_request||'{"runId":"00000000-0000-4000-8000-000000000000"}'::jsonb) then
    raise exception 'EXPLANATION_INVALID' using errcode='22023';
  end if;
  select id into found_id from private.explanation_runs
  where owner_id=actor and request_fingerprint=private.explanation_fingerprint(p_request)
  order by created_at desc,id desc limit 1;
  return jsonb_build_object('run_id',found_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.find_explanation_run(p_request jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select private.find_explanation_run(p_request)
$function$
;
REVOKE ALL ON FUNCTION private.find_explanation_run(jsonb), public.find_explanation_run(jsonb)
  FROM public, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.find_explanation_run(jsonb), public.find_explanation_run(jsonb)
  TO authenticated;
