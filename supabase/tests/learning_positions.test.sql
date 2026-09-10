begin;
select no_plan();
create function pg_temp.pid(n integer) returns uuid language sql as $$select ('fd570000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into private.app_config(key,value) values('extension_oauth_client_id','position-extension') on conflict(key) do update set value=excluded.value;
insert into auth.users(id,email) values(pg_temp.pid(1),'position-owner@example.test'),(pg_temp.pid(2),'position-other@example.test');
insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.pid(10),owner_id,id,'Goal',0 from public.blueprints where owner_id=pg_temp.pid(1);
insert into public.stages(id,owner_id,goal_id,title,position) values(pg_temp.pid(11),pg_temp.pid(1),pg_temp.pid(10),'Stage',0);
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) values(pg_temp.pid(12),pg_temp.pid(1),pg_temp.pid(11),'learn','Node',0);
insert into public.resource_bindings(id,owner_id,node_id,kind,url,external_id,position)
 values(pg_temp.pid(13),pg_temp.pid(1),pg_temp.pid(12),'youtube_video','https://www.youtube.com/watch?v=abcdefghijk','abcdefghijk',0);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(1),'role','authenticated')::text,true);
select lives_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,0,0,pg_temp.pid(20))$$,'explicit first position accepts zero through public RPC');
select set_config('position.first',public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,0,0,pg_temp.pid(20))::text,true);
select is(current_setting('position.first')::jsonb->>'position_version','1','first receipt increments position version');
select lives_ok($$select public.read_learning_position_workspace(pg_temp.pid(1))$$,'public coherent workspace exposes latest positions');
select is(public.read_learning_position_workspace(pg_temp.pid(1)),jsonb_build_object('blueprint',public.read_blueprint_snapshot_v2(pg_temp.pid(1)),'records',jsonb_build_array(current_setting('position.first')::jsonb)),'workspace returns same frozen receipt and current Blueprint');
select is(current_setting('position.first')::jsonb->>'owner_id',pg_temp.pid(1)::text,'owner comes from authenticated identity');
select is(current_setting('position.first')::jsonb->>'resource_url','https://www.youtube.com/watch?v=abcdefghijk','canonical video resource frozen by server');
select is(current_setting('position.first')::jsonb->>'node_title','Node','historical node title frozen by server');
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,1,150,pg_temp.pid(21))->>'position_version','2','second explicit position advances version');
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,0,0,pg_temp.pid(20)),current_setting('position.first')::jsonb,'old exact replay returns its original receipt before position CAS');
select is(public.read_learning_position_workspace(pg_temp.pid(1))#>>'{records,0,position_seconds}','150','old replay cannot overwrite latest position');
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,2,25,pg_temp.pid(22))->>'position_version','3','explicit backwards movement is allowed');
select is(public.read_learning_position_workspace(pg_temp.pid(1))#>>'{records,0,position_seconds}','25','latest is version not maximum playback position');
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,2,99,pg_temp.pid(23))$$,'40001','LEARNING_POSITION_VERSION_CONFLICT','stale device cannot overwrite winner at same expected version');
select throws_ok(format($q$select public.record_learning_position(%L,%L,%s,%s,%s,%L)$q$,nid,bid,bp,pv,seconds,pg_temp.pid(20)),
 '22023','LEARNING_POSITION_MUTATION_REUSED','old mutation cannot change any command field') from (values
 (pg_temp.pid(99),pg_temp.pid(13),0,0,0),(pg_temp.pid(12),pg_temp.pid(99),0,0,0),(pg_temp.pid(12),pg_temp.pid(13),1,0,0),
 (pg_temp.pid(12),pg_temp.pid(13),0,1,0),(pg_temp.pid(12),pg_temp.pid(13),0,0,1)) v(nid,bid,bp,pv,seconds);
select throws_ok(format($q$select public.record_learning_position(%L,%L,%L,%L,%L,%L)$q$,nid,bid,bp,pv,seconds,mutation),
 '22023','LEARNING_POSITION_INVALID','null, negative and overflowing position-version input rejected') from (values
 (null::uuid,pg_temp.pid(13),0,0,0,pg_temp.pid(29)),(pg_temp.pid(12),null::uuid,0,0,0,pg_temp.pid(29)),
 (pg_temp.pid(12),pg_temp.pid(13),null::integer,0,0,pg_temp.pid(29)),(pg_temp.pid(12),pg_temp.pid(13),-1,0,0,pg_temp.pid(29)),
 (pg_temp.pid(12),pg_temp.pid(13),0,null::integer,0,pg_temp.pid(29)),(pg_temp.pid(12),pg_temp.pid(13),0,-1,0,pg_temp.pid(29)),
 (pg_temp.pid(12),pg_temp.pid(13),0,2147483647,0,pg_temp.pid(29)),(pg_temp.pid(12),pg_temp.pid(13),0,0,null::integer,pg_temp.pid(29)),
 (pg_temp.pid(12),pg_temp.pid(13),0,0,-1,pg_temp.pid(29)),(pg_temp.pid(12),pg_temp.pid(13),0,0,0,null::uuid)) v(nid,bid,bp,pv,seconds,mutation);
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),1,3,99,pg_temp.pid(29))$$,'40001','BLUEPRINT_VERSION_CONFLICT','new mutation requires current Blueprint');
select throws_ok($$select public.record_learning_position(pg_temp.pid(99),pg_temp.pid(13),0,3,99,pg_temp.pid(29))$$,'P0002','LEARNING_POSITION_SOURCE_NOT_FOUND','new mutation requires current node/resource pair');
select is((select count(*) from public.learning_positions),3::bigint,'failed and replayed commands append no receipts');
select throws_ok($$update public.learning_positions set position_seconds=999$$,'42501',null,'no direct receipt update');
select throws_ok($$delete from public.learning_positions$$,'42501',null,'no direct receipt deletion');
select throws_ok($$insert into public.learning_positions select * from public.learning_positions$$,'42501',null,'no direct receipt insertion');
reset role;
-- Preserve unrelated actual learning history across saves.
insert into public.learning_sessions(owner_id,node_id,resource_binding_id,source,started_at,client_mutation_id) values(pg_temp.pid(1),pg_temp.pid(12),pg_temp.pid(13),'extension',now(),pg_temp.pid(30));
set local role authenticated;
select lives_ok($$select public.record_learning_note(pg_temp.pid(12),pg_temp.pid(13),0,'Separate private note',75,pg_temp.pid(31))$$,'note timestamp is separate from resume position');
select set_config('position.unrelated',jsonb_build_object('blueprint',public.read_blueprint_snapshot_v2(pg_temp.pid(1)),
 'notes',(select jsonb_agg(to_jsonb(n)) from public.learning_notes n),'sessions',(select jsonb_agg(to_jsonb(s)) from public.learning_sessions s))::text,true);
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,3,2147483647,pg_temp.pid(32))->>'position_seconds','2147483647','maximum int32 position accepted without inventing duration');
select is(jsonb_build_object('blueprint',public.read_blueprint_snapshot_v2(pg_temp.pid(1)),
 'notes',(select jsonb_agg(to_jsonb(n)) from public.learning_notes n),'sessions',(select jsonb_agg(to_jsonb(s)) from public.learning_sessions s)),current_setting('position.unrelated')::jsonb,'saving position changes neither formal graph nor notes nor sessions');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(2))::text,true);
select is(public.read_learning_position_workspace(pg_temp.pid(1)),null::jsonb,'other account cannot read owner workspace');
select is_empty($$select id from public.learning_positions$$,'RLS hides other owner receipts');
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,4,60,pg_temp.pid(33))$$,'P0002','LEARNING_POSITION_SOURCE_NOT_FOUND','other owner cannot record against foreign binding');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(1),'client_id','position-extension')::text,true);
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,4,60,pg_temp.pid(33))->>'position_version','5','configured extension shares same position sequence');
select is(public.read_learning_position_workspace(pg_temp.pid(1))#>>'{records,0,position_seconds}','60','approved extension reads Web and extension shared history');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(1),'client_id','unknown')::text,true);
select is(public.read_learning_position_workspace(pg_temp.pid(1)),null::jsonb,'unknown OAuth client cannot read workspace');
select is_empty($$select id from public.learning_positions$$,'unknown client cannot bypass workspace through table');
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,5,90,pg_temp.pid(34))$$,'42501','LEARNING_POSITION_FORBIDDEN','unknown OAuth client cannot write');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(1),'is_anonymous',true)::text,true);
select is(public.read_learning_position_workspace(pg_temp.pid(1)),null::jsonb,'anonymous signed-in account cannot read');
select is_empty($$select id from public.learning_positions$$,'anonymous account cannot read table');
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,5,90,pg_temp.pid(34))$$,'42501','LEARNING_POSITION_FORBIDDEN','anonymous account cannot write');
reset role;
set local role anon;
select throws_ok($$select public.read_learning_position_workspace(pg_temp.pid(1))$$,'42501',null,'anon role lacks workspace execute');
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,5,90,pg_temp.pid(34))$$,'42501',null,'anon role lacks write execute');
reset role;
set local role service_role;
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,5,90,pg_temp.pid(34))$$,'42501',null,'service credential cannot impersonate user position write');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(1))::text,true);
-- Source disappearance never moves history to a replacement binding.
update public.resource_bindings set archived_at=now() where id=pg_temp.pid(13);
update public.path_nodes set title='Renamed node' where id=pg_temp.pid(12);
update public.blueprints set version=1 where owner_id=pg_temp.pid(1);
insert into public.resource_bindings(id,owner_id,node_id,kind,url,external_id,position)
 values(pg_temp.pid(14),pg_temp.pid(1),pg_temp.pid(12),'youtube_video','https://www.youtube.com/watch?v=lmnopqrstuv','lmnopqrstuv',0);
set local role authenticated;
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),0,0,0,pg_temp.pid(20)),current_setting('position.first')::jsonb,'exact replay survives changed Blueprint and removed binding');
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(13),1,5,90,pg_temp.pid(34))$$,'P0002','LEARNING_POSITION_SOURCE_NOT_FOUND','new write to archived binding denied');
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(14),1,0,10,pg_temp.pid(35))->>'position_version','1','replacement binding starts its own position sequence');
select is(jsonb_array_length(public.read_learning_position_workspace(pg_temp.pid(1))->'records'),2,'workspace retains old binding and new binding independently');
select is(public.read_learning_position_workspace(pg_temp.pid(1))#>>'{records,1,node_title}','Node','historical title not retroactively renamed');
select is(public.read_learning_position_workspace(pg_temp.pid(1))#>>'{records,0,node_title}','Renamed node','new receipt captures current source title');
reset role;
-- A completed high sequence cannot overflow; selection does not trust clock order.
update public.learning_positions set created_at='2000-01-01' where client_mutation_id=pg_temp.pid(33);
set local role authenticated;
select is((select value->>'position_version' from jsonb_array_elements(public.read_learning_position_workspace(pg_temp.pid(1))->'records') where value->>'resource_binding_id'=pg_temp.pid(13)::text),'5','highest sequence remains latest even if its timestamp is older');
reset role;
insert into public.learning_positions select (jsonb_populate_record(null::public.learning_positions,to_jsonb(p)||jsonb_build_object('id',pg_temp.pid(40),'client_mutation_id',pg_temp.pid(41),'expected_position_version',2147483645,'position_version',2147483646))).* from public.learning_positions p where client_mutation_id=pg_temp.pid(35);
set local role authenticated;
select is(public.record_learning_position(pg_temp.pid(12),pg_temp.pid(14),1,2147483646,0,pg_temp.pid(42))->>'position_version','2147483647','last valid expected position version reaches maximum without overflow');
reset role;
-- Archived ancestors disallow fresh saves without altering historical receipts.
update public.path_nodes set archived_at=now() where id=pg_temp.pid(12);
set local role authenticated;
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(14),1,0,2,pg_temp.pid(43))$$,'P0002','LEARNING_POSITION_SOURCE_NOT_FOUND','archived node cannot accept new position');
reset role;
update public.path_nodes set archived_at=null where id=pg_temp.pid(12);
update public.stages set archived_at=now() where id=pg_temp.pid(11);
set local role authenticated;
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(14),1,0,2,pg_temp.pid(43))$$,'P0002','LEARNING_POSITION_SOURCE_NOT_FOUND','archived stage cannot accept new position');
reset role;
update public.stages set archived_at=null where id=pg_temp.pid(11);
update public.goals set archived_at=now() where id=pg_temp.pid(10);
set local role authenticated;
select throws_ok($$select public.record_learning_position(pg_temp.pid(12),pg_temp.pid(14),1,0,2,pg_temp.pid(43))$$,'P0002','LEARNING_POSITION_SOURCE_NOT_FOUND','archived goal cannot accept new position');
reset role;
-- Historical receipts deliberately have no live binding FK; cap is applied after per-binding latest selection.
insert into public.learning_positions select (jsonb_populate_record(null::public.learning_positions,to_jsonb(p)||jsonb_build_object('id',pg_temp.pid(100+i),'client_mutation_id',pg_temp.pid(200+i),'resource_binding_id',pg_temp.pid(300+i),'created_at',to_jsonb('2100-01-01'::timestamptz+make_interval(secs=>i))))).* from public.learning_positions p cross join generate_series(1,55) i where client_mutation_id=pg_temp.pid(20);
set local role authenticated;
select is(jsonb_array_length(public.read_learning_position_workspace(pg_temp.pid(1))->'records'),50,'latest workspace has bounded fifty-binding history');
select is((select count(distinct value->>'resource_binding_id') from jsonb_array_elements(public.read_learning_position_workspace(pg_temp.pid(1))->'records')),50::bigint,'each returned binding occurs once');
select is(public.read_learning_position_workspace(pg_temp.pid(1))#>>'{records,0,id}',pg_temp.pid(155)::text,'latest-binding history ordered most recent first');
select is(public.read_learning_position_workspace(pg_temp.pid(1))#>>'{records,49,id}',pg_temp.pid(106)::text,'history cap applied after deterministic ordering');
select lives_ok($$select public.read_learning_position_workspace(pg_temp.pid(1),pg_temp.pid(13))$$,'binding lookup remains available beyond fifty-record history');
select is(public.read_learning_position_workspace(pg_temp.pid(1),pg_temp.pid(13))#>>'{records,0,position_version}','5','filtered lookup recovers exact latest sequence for omitted historical binding');
select is(jsonb_array_length(public.read_learning_position_workspace(pg_temp.pid(1),pg_temp.pid(13))->'records'),1,'filtered lookup returns at most one latest receipt');
select is(public.read_learning_position_workspace(pg_temp.pid(1),pg_temp.pid(13))->'blueprint',public.read_blueprint_snapshot_v2(pg_temp.pid(1)),'filtered lookup keeps coherent current Blueprint');
select is(public.read_learning_position_workspace(pg_temp.pid(1),pg_temp.pid(999))->'records','[]'::jsonb,'unknown binding yields empty owner workspace history');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.pid(2))::text,true);
select is(public.read_learning_position_workspace(pg_temp.pid(1),pg_temp.pid(13)),null::jsonb,'filtered lookup cannot reveal another owner receipt');
reset role;
select ok((select relrowsecurity from pg_class where oid='public.learning_positions'::regclass),'position history has RLS enabled');
select is((select provolatile::text from pg_proc where oid='public.read_learning_position_workspace(uuid,uuid)'::regprocedure),'s','workspace read has a stable single-statement snapshot');
select ok(not (select prosecdef from pg_proc where oid='public.read_learning_position_workspace(uuid,uuid)'::regprocedure),'workspace preserves invoker privileges');
select ok(not (select prosecdef from pg_proc where oid='public.record_learning_position(uuid,uuid,integer,integer,integer,uuid)'::regprocedure),'public mutation is invoker with narrow private writer');
select * from finish();
rollback;
