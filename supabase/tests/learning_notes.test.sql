begin;
select no_plan();
insert into auth.users(id,email) values
 ('f5100000-0000-4000-8000-000000000001','learning-note-owner@example.test'),
 ('f5100000-0000-4000-8000-000000000002','learning-note-outsider@example.test');
insert into private.app_config(key,value) values('extension_oauth_client_id','notes-extension') on conflict(key) do update set value=excluded.value;
insert into public.goals(id,owner_id,blueprint_id,title,position)
 select 'f5100000-0000-4000-8000-000000000010',owner_id,id,'表达能力',0 from public.blueprints where owner_id='f5100000-0000-4000-8000-000000000001';
insert into public.stages(id,owner_id,goal_id,title,position) values
 ('f5100000-0000-4000-8000-000000000020','f5100000-0000-4000-8000-000000000001','f5100000-0000-4000-8000-000000000010','第一周',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values
 ('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000001','f5100000-0000-4000-8000-000000000020','learn','学习演讲',0);
insert into public.resource_bindings(id,owner_id,node_id,kind,url,external_id) values
 ('f5100000-0000-4000-8000-000000000040','f5100000-0000-4000-8000-000000000001','f5100000-0000-4000-8000-000000000030','youtube_video','https://www.youtube.com/watch?v=abcdefghijk','abcdefghijk');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001"}',true);
select lives_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,E'  第一段\n保留空白  ',75,'f5100000-0000-4000-8000-000000000050')$$,
 'a signed-in owner explicitly saves a timestamp note against their current resource');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{records,0,note_text}',E'  第一段\n保留空白  ',
 'the coherent public workspace returns the exact untrimmed saved note');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{blueprint,schemaVersion}','2','workspace uses the current Blueprint format');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{records,0,position_seconds}','75','timestamp is an explicit saved value');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{records,0,resource_url}','https://www.youtube.com/watch?v=abcdefghijk','resource URL is captured from the owned binding');
select is(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,E'  第一段\n保留空白  ',75,'f5100000-0000-4000-8000-000000000050'),
 public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>'{records,0}','exact replay returns the exact original receipt');
select throws_ok(format($q$select public.record_learning_note(%L,%L,%s,%L,%s,'f5100000-0000-4000-8000-000000000050')$q$,node_id,binding_id,version,body,position),
 '22023','LEARNING_NOTE_MUTATION_REUSED','changed replay field is rejected: '||label)
from (values
 ('node','f5100000-0000-4000-8000-000000000031','f5100000-0000-4000-8000-000000000040',0,E'  第一段\n保留空白  ','75'),
 ('binding','f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000041',0,E'  第一段\n保留空白  ','75'),
 ('version','f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',1,E'  第一段\n保留空白  ','75'),
 ('verbatim text','f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,E'第一段\n保留空白','75'),
 ('timestamp','f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,E'  第一段\n保留空白  ','null')
) cases(label,node_id,binding_id,version,body,position);
select throws_ok(format($q$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,%L,null,gen_random_uuid())$q$,body),
 '22023','LEARNING_NOTE_INVALID','reject empty/blank/oversized text: '||label)
from (values ('null',null::text),('empty',''),('linebreak',E' \n\t'),('all ECMAScript trim whitespace',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),('8001 codepoints',repeat('😀',8001))) cases(label,body);
select is(char_length(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,repeat('😀',8000),null,gen_random_uuid())->>'note_text'),8000,'8000 astral code points are valid, not counted as 16000 UTF16 units');
select is(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,U&'\0085',2147483647,gen_random_uuid())->>'note_text',U&'\0085','non-ECMAScript whitespace is not silently trimmed or rejected');
select is(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'没有时间戳',null,gen_random_uuid())->'position_seconds','null'::jsonb,'nullable timestamp is distinct from zero');
select is(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'视频开始',0,gen_random_uuid())->>'position_seconds','0','zero is a valid explicit timestamp');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'正文',-1,gen_random_uuid())$$,'22023','LEARNING_NOTE_INVALID','negative position is invalid');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',9007199254740992,'正文',null,gen_random_uuid())$$,'22023','LEARNING_NOTE_INVALID','unsafe expected version is invalid');
select throws_ok($$select public.record_learning_note(null,'f5100000-0000-4000-8000-000000000040',0,'正文',null,gen_random_uuid())$$,'22023','LEARNING_NOTE_INVALID','node identity is required');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030',null,0,'正文',null,gen_random_uuid())$$,'22023','LEARNING_NOTE_INVALID','binding identity is required');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',null,'正文',null,gen_random_uuid())$$,'22023','LEARNING_NOTE_INVALID','expected version is required');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'正文',null,null)$$,'22023','LEARNING_NOTE_INVALID','mutation identity is required');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',1,'正文',null,gen_random_uuid())$$,'40001','BLUEPRINT_VERSION_CONFLICT','new note rejects stale source');
select throws_ok($$insert into public.learning_notes(owner_id) values(auth.uid())$$,'42501',null,'direct insert cannot forge saved context');
select throws_ok($$update public.learning_notes set note_text='forged'$$,'42501',null,'direct update is denied');
select throws_ok($$delete from public.learning_notes$$,'42501',null,'direct delete is denied');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{blueprint,version}','0','saving notes does not advance the Blueprint');
select is_empty($$select id from public.learning_sessions$$,'notes do not manufacture learning sessions');
select is_empty($$select id from public.progress_evidence$$,'notes remain distinct from progress evidence');
select is_empty($$select id from public.node_status_confirmations$$,'notes never manufacture completion');
select is_empty($$select id from public.product_events$$,'notes do not emit product events as a side effect');
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001","client_id":"notes-extension","is_anonymous":false}',true);
select is(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,E'  第一段\n保留空白  ',75,'f5100000-0000-4000-8000-000000000050')->>'goal_title','表达能力','configured extension recovers the Web receipt with frozen goal context');
select lives_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'插件笔记',null,gen_random_uuid())$$,'configured extension may explicitly save a note');
select is(jsonb_array_length(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')->'records'),6,'Web and extension share the same note history');
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000002"}',true);
select is_empty($$select id from public.learning_notes$$,'other account cannot read owner notes');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001'),null::jsonb,'other owner workspace is unavailable');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'侵入',0,gen_random_uuid())$$,'P0002','LEARNING_NOTE_SOURCE_NOT_FOUND','other account cannot bind a note to owner source');
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001","client_id":"unknown","user_metadata":{"client_id":"notes-extension"}}',true);
select is_empty($$select id from public.learning_notes$$,'unknown OAuth client cannot read notes');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001'),null::jsonb,'unknown OAuth workspace fails closed');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'侵入',0,gen_random_uuid())$$,'42501','LEARNING_NOTE_FORBIDDEN','unknown client cannot write even with forged user metadata');
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001","is_anonymous":true}',true);
select is_empty($$select id from public.learning_notes$$,'anonymous authenticated identity cannot read notes');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001'),null::jsonb,'anonymous identity cannot read workspace');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,'侵入',0,gen_random_uuid())$$,'42501','LEARNING_NOTE_FORBIDDEN','anonymous identity cannot save notes');
reset role;
-- Capture only for historical replay equality; assertions use the public read/write seams.
create temporary table original_note as select to_jsonb(n) receipt from public.learning_notes n where client_mutation_id='f5100000-0000-4000-8000-000000000050';
grant select on original_note to authenticated;
update public.path_nodes set title='改名后的节点',archived_at=now() where id='f5100000-0000-4000-8000-000000000030';
update public.resource_bindings set archived_at=now() where id='f5100000-0000-4000-8000-000000000040';
update public.blueprints set version=1 where owner_id='f5100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001"}',true);
select is(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,E'  第一段\n保留空白  ',75,'f5100000-0000-4000-8000-000000000050'),(select receipt from original_note),'source rename/archive/version change cannot rewrite an exact historical receipt');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{records,0,node_title}','学习演讲','read history does not live-join renamed nodes');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',1,'新笔记',0,gen_random_uuid())$$,'P0002','LEARNING_NOTE_SOURCE_NOT_FOUND','archived source rejects new notes');
reset role;
update public.path_nodes set archived_at=null where id='f5100000-0000-4000-8000-000000000030';
set local role authenticated;
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',1,'新笔记',0,gen_random_uuid())$$,'P0002','LEARNING_NOTE_SOURCE_NOT_FOUND','archived binding alone rejects new notes');
reset role;
update public.resource_bindings set archived_at=null where id='f5100000-0000-4000-8000-000000000040';
delete from private.app_config where key='extension_oauth_client_id';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001","client_id":"notes-extension"}',true);
select is_empty($$select id from public.learning_notes$$,'missing extension configuration fails closed');
select throws_ok($$select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',1,'新笔记',0,gen_random_uuid())$$,'42501','LEARNING_NOTE_FORBIDDEN','missing extension configuration denies write');
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001"}',true);
select public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',1,'第'||i||'条',i,gen_random_uuid()) from generate_series(1,55) i;
select is(jsonb_array_length(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')->'records'),50,'workspace returns a bounded recent page, not a full export');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{records,0,note_text}','第55条','recent notes are ordered newest first');
select is(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')#>>'{records,49,note_text}','第6条','recent page excludes older notes without deleting them');
reset role;
select ok(not p.prosecdef and p.provolatile='s','coherent workspace is STABLE and caller-RLS invoker') from pg_proc p where oid='public.read_learning_note_workspace(uuid)'::regprocedure;
select ok(not p.prosecdef,'public write wrapper is invoker') from pg_proc p where oid='public.record_learning_note(uuid,uuid,bigint,text,integer,uuid)'::regprocedure;
select ok(not has_table_privilege('service_role','public.learning_notes','INSERT'),'service role has no accidental direct-write grant');
select ok(not has_function_privilege('service_role','private.record_learning_note(uuid,uuid,bigint,text,integer,uuid)','EXECUTE'),'privileged write helper has no accidental service-role grant');
update public.learning_notes set created_at='2026-09-10T00:00:00Z' where owner_id='f5100000-0000-4000-8000-000000000001';
set local role authenticated;
select results_eq($$select value->>'id' from jsonb_array_elements(public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')->'records')$$,
 $$select id::text from public.learning_notes order by id desc limit 50$$,'timestamp ties are ordered deterministically by ID descending');
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.record_learning_note(null,null,null,null,null,null)$$,'42501','LEARNING_NOTE_FORBIDDEN','authenticated role without user identity is insufficient');
reset role;
-- The history has no live-source FK: deletion or archival cannot rewrite a receipt.
delete from public.resource_bindings where id='f5100000-0000-4000-8000-000000000040';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"f5100000-0000-4000-8000-000000000001"}',true);
select is(public.record_learning_note('f5100000-0000-4000-8000-000000000030','f5100000-0000-4000-8000-000000000040',0,E'  第一段\n保留空白  ',75,'f5100000-0000-4000-8000-000000000050') - 'created_at',
 (select receipt - 'created_at' from original_note),'deleted live binding does not prevent historical replay (timestamp adjusted only for tie fixture)');
reset role;
delete from auth.users where id='f5100000-0000-4000-8000-000000000001';
select is((select count(*) from public.learning_notes),0::bigint,'owner deletion cascades notes without retaining detached private text');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select * from public.learning_notes$$,'42501',null,'anon cannot read notes');
select throws_ok($$select public.read_learning_note_workspace('f5100000-0000-4000-8000-000000000001')$$,'42501',null,'anon cannot call the read RPC');
select throws_ok($$select public.record_learning_note(null,null,null,null,null,null)$$,'42501',null,'anon cannot call the write RPC');
reset role;
select * from finish();
rollback;
