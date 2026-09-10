begin;
select no_plan();
-- A transaction-local reset of only the new aggregate receipt; rollback restores it.
delete from private.resource_maintenance_state;
select is(private.resource_maintenance_snapshot()->>'last_status','never_run','operator can distinguish maintenance that never ran');
select is(private.run_resource_maintenance(1)->>'status','succeeded','operator can record a successful bounded sweep');
select set_config('maintenance.before',private.resource_maintenance_snapshot()::text,true);
select is(current_setting('maintenance.before')::jsonb->>'success_count','1','successful invocation increments bounded singleton aggregate');
select ok((current_setting('maintenance.before')::jsonb->>'last_duration_ms')::double precision>=0,'duration is nonnegative');
select is((select array_agg(key order by key) from jsonb_object_keys(private.resource_maintenance_snapshot()) key),
 array['failure_count','last_attempt_at','last_duration_ms','last_error_code','last_finished_at','last_processed_owners','last_status','last_success_at','observed_at','oldest_overdue_at','overdue_roots','success_count','version'],'snapshot exposes only exact aggregate allowlist');
select throws_ok($$select private.run_resource_maintenance(0)$$,'22023','RESOURCE_SWEEP_LIMIT_INVALID','lower bound preserved');
select throws_ok($$select private.run_resource_maintenance(1001)$$,'22023','RESOURCE_SWEEP_LIMIT_INVALID','upper bound preserved');
select throws_ok($$select private.run_resource_maintenance(null)$$,'22023','RESOURCE_SWEEP_LIMIT_INVALID','null is not a maintenance limit');
select is(private.resource_maintenance_snapshot()-'observed_at'-'overdue_roots'-'oldest_overdue_at',current_setting('maintenance.before')::jsonb-'observed_at'-'overdue_roots'-'oldest_overdue_at','invalid requests do not overwrite last receipt');

create function pg_temp.mid(n integer) returns uuid language sql as $$select ('ef670000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email) values(pg_temp.mid(1),'maintenance-one@example.test'),(pg_temp.mid(2),'maintenance-two@example.test');
insert into public.goals(id,owner_id,blueprint_id,title,position) select pg_temp.mid(10+n),owner_id,id,'Goal',0 from public.blueprints join generate_series(1,2) n on owner_id=pg_temp.mid(n);
insert into public.stages(id,owner_id,goal_id,title,position) select pg_temp.mid(20+n),pg_temp.mid(n),pg_temp.mid(10+n),'Stage',0 from generate_series(1,2) n;
insert into public.path_nodes(id,owner_id,stage_id,node_type,title,position) select pg_temp.mid(30+n),pg_temp.mid(n),pg_temp.mid(20+n),'learn','Node',0 from generate_series(1,2) n;
insert into private.resource_quotas select pg_temp.mid(n),'discover',5 from generate_series(1,2) n;
insert into private.resource_retention_policies select pg_temp.mid(n),1,'local-maintenance-fixture' from generate_series(1,2) n;
create function pg_temp.discover(n integer) returns jsonb language sql as $$select jsonb_build_object('kind','discover','runId',pg_temp.mid(40+n),'nodeId',pg_temp.mid(30+n),'expectedBlueprintVersion',0,
 'preferences',jsonb_build_object('regionCode','US','language','en','allowLanguageFallback',false,'maxDurationSeconds',3600,'publishedAfter',null),
 'learnerContext',jsonb_build_object('startingPoint',null,'constraints',null))$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.mid(1),'role','authenticated')::text,true);
select public.begin_resource_run(pg_temp.discover(1));
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.mid(2),'role','authenticated')::text,true);
select public.begin_resource_run(pg_temp.discover(2));
reset role;
select pg_sleep(1.05);
select is(private.resource_maintenance_snapshot()->>'overdue_roots','2','current snapshot counts due managed roots independently of last success');
select ok((private.resource_maintenance_snapshot()->>'oldest_overdue_at')::timestamptz<=clock_timestamp(),'snapshot identifies oldest overdue instant');

-- A real database write failure on the second fixture proves the entire sweep
-- subtransaction rolls back, including an earlier owner's clearing and refund.
create function pg_temp.reject_fixture_clear() returns trigger language plpgsql as $$begin
 if new.id=pg_temp.mid(42) and new.status='cleared' then
  raise exception 'PRIVATE_SENTINEL_BODY' using errcode='23514',detail='PRIVATE_SENTINEL_DETAIL';
 end if; return new;
end $$;
create trigger maintenance_fixture_fault before update on public.resource_runs for each row execute function pg_temp.reject_fixture_clear();
select set_config('maintenance.failed',private.run_resource_maintenance(2)::text,true);
select is(current_setting('maintenance.failed')::jsonb->>'status','failed','caught write failure produces a failed operation receipt');
select is(current_setting('maintenance.failed')::jsonb->>'error_code','23514','operator receives only SQLSTATE');
select is(private.resource_maintenance_snapshot()->>'overdue_roots','2','failed sweep leaves both roots overdue');
select is((select count(*) from public.resource_runs where id in(pg_temp.mid(41),pg_temp.mid(42)) and status='queued'),2::bigint,'earlier clear rolls back with later failure');
select is((select sum(available_attempts) from private.resource_quotas where owner_id in(pg_temp.mid(1),pg_temp.mid(2))),8::bigint,'failed sweep refunds roll back atomically');
select is(private.resource_maintenance_snapshot()->>'last_success_at',current_setting('maintenance.before')::jsonb->>'last_success_at','failure preserves last successful instant for stale detection');
select is(private.resource_maintenance_snapshot()->>'failure_count','1','failure increments one sanitized aggregate');
select is(private.resource_maintenance_snapshot()->>'last_processed_owners',null,'failed work never claims a processed count');
select ok((current_setting('maintenance.failed')||private.resource_maintenance_snapshot()::text) not like '%PRIVATE_SENTINEL%','error prose and detail never enter diagnostics');
drop trigger maintenance_fixture_fault on public.resource_runs;
select set_config('maintenance.recovered',private.run_resource_maintenance(1)::text,true);
select is(current_setting('maintenance.recovered')::jsonb->>'processed_owners','1','one-owner limit remains effective during recovery');
select is(private.resource_maintenance_snapshot()->>'overdue_roots','1','current backlog differs from last processed count');
select is(private.resource_maintenance_snapshot()->>'last_error_code',null,'successful recovery resets current error code');
select is(private.run_resource_maintenance(1)->>'processed_owners','1','next bounded invocation clears remaining owner');
select is(private.resource_maintenance_snapshot()->>'overdue_roots','0','all fixture overdue roots cleared');
select is(private.resource_maintenance_snapshot()->>'oldest_overdue_at',null,'empty backlog has no oldest deadline');
select is(private.run_resource_maintenance(1)->>'processed_owners','0','idempotent sweep does not claim already cleared work');
select is((select sum(available_attempts) from private.resource_quotas where owner_id in(pg_temp.mid(1),pg_temp.mid(2))),10::bigint,'successful queued clearing refunds exactly once');
select is((select count(*) from private.resource_maintenance_state),1::bigint,'repeated runs retain only one aggregate row');
select is(private.resource_maintenance_snapshot()->>'success_count','4','four successes counted independently of one failure');

select ok((select relrowsecurity from pg_class where oid='private.resource_maintenance_state'::regclass),'private singleton has RLS defense in depth');
select is((select count(*) from pg_policy where polrelid='private.resource_maintenance_state'::regclass),0::bigint,'singleton exposes no application RLS policies');
select ok((select bool_and(not prosecdef) from pg_proc where oid in('private.resource_maintenance_snapshot()'::regprocedure,'private.run_resource_maintenance(integer)'::regprocedure)),'both operator entrypoints are invoker functions');
set local role anon;
select throws_ok($$select private.resource_maintenance_snapshot()$$,'42501',null,'anonymous cannot read aggregate operator state');
select throws_ok($$select private.run_resource_maintenance(1)$$,'42501',null,'anonymous cannot execute maintenance');
select throws_ok($$select * from private.resource_maintenance_state$$,'42501',null,'anonymous cannot access private table');
reset role;
set local role authenticated;
select throws_ok($$select private.resource_maintenance_snapshot()$$,'42501',null,'authenticated cannot read operator state');
select throws_ok($$select private.run_resource_maintenance(1)$$,'42501',null,'authenticated cannot execute maintenance');
select throws_ok($$select * from private.resource_maintenance_state$$,'42501',null,'authenticated cannot access private table');
reset role;
set local role service_role;
select throws_ok($$select private.resource_maintenance_snapshot()$$,'42501',null,'worker cannot read operator state');
select throws_ok($$select private.run_resource_maintenance(1)$$,'42501',null,'worker cannot execute maintenance');
select throws_ok($$select * from private.resource_maintenance_state$$,'42501',null,'worker cannot access private table');
reset role;
select * from finish();
rollback;
