begin;
select no_plan();

-- Fixtures: two invited accounts. The auth trigger creates profile (cyberpunk/v1) and blueprint.
insert into auth.users(id,email) values
  ('a1000000-0000-4000-8000-000000000001','avatar-owner@example.test'),
  ('a1000000-0000-4000-8000-000000000002','avatar-other@example.test');

select has_table('public','avatar_runs','avatar runs table exists');
select has_table('private','avatar_quotas','avatar quotas table exists');
select has_table('private','avatar_leases','avatar leases table exists');

select set_config('avatar_test.request',
  '{"runId":"a1000000-0000-4000-8000-000000000020","kind":"generate","themeId":"cyberpunk","themeVersion":1}',true);

-- T09: no implicit free calls, and a rejected begin leaves no trace.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.begin_avatar_run(current_setting('avatar_test.request')::jsonb)$$,
  'P0001','AVATAR_QUOTA_EXHAUSTED','no implicit free calls');
select is((select count(*)::int from public.avatar_runs),0,'rejected begin inserts no run');
reset role;
select is((select count(*)::int from private.avatar_quotas),0,'rejected begin inserts no quota row');

insert into private.avatar_quotas values('a1000000-0000-4000-8000-000000000001','generate',2);

-- T01/T02: reserve once, replay returns the identical row, quota debited once.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.begin_avatar_run(current_setting('avatar_test.request')::jsonb)->>'status','queued','T01 begin reserves a queued run');
select is((public.begin_avatar_run(current_setting('avatar_test.request')::jsonb)->>'theme_id'),'cyberpunk','pinned theme id survives replay');
select is((public.begin_avatar_run(current_setting('avatar_test.request')::jsonb)->>'expires_at'),
  (select expires_at::text from public.avatar_runs where id='a1000000-0000-4000-8000-000000000020'),'exact replay returns the stored row');
reset role;
select is((select available_attempts from private.avatar_quotas where owner_id='a1000000-0000-4000-8000-000000000001' and kind='generate'),1,'replay debits exactly once');

-- T16: request shape is exactly four keys; theme shape and kind are constrained.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{kind}','"mesh"'))$$,
  '22023','AVATAR_INVALID','unknown kind rejected');
select throws_ok($$select public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{themeId}','"Neon"'))$$,
  '22023','AVATAR_INVALID','theme id shape rejected');
select throws_ok($$select public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{themeVersion}','0'))$$,
  '22023','AVATAR_INVALID','theme version must be positive');
select throws_ok($$select public.begin_avatar_run(current_setting('avatar_test.request')::jsonb||'{"extra":1}')$$,
  '22023','AVATAR_INVALID','extra keys rejected');
select throws_ok($$select public.begin_avatar_run((current_setting('avatar_test.request')::jsonb-'themeVersion'))$$,
  '22023','AVATAR_INVALID','missing key rejected');

-- T24: the same runId with different pinned parameters is a reuse, not a replay.
select throws_ok($$select public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{themeVersion}','2'))$$,
  '22023','AVATAR_RUN_REUSED','changed pinned parameters cannot replay the same runId');

-- T17: a fresh runId that disagrees with the account theme pair is a version conflict.
select throws_ok($$select public.begin_avatar_run(jsonb_set(jsonb_set(current_setting('avatar_test.request')::jsonb,'{runId}','"a1000000-0000-4000-8000-000000000026"'),'{themeVersion}','2'))$$,
  '40001','AVATAR_VERSION_CONFLICT','fresh runId must match the account theme pair');

-- T22: one active run per owner; the rejected begin must not debit.
select throws_ok($$select public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{runId}','"a1000000-0000-4000-8000-000000000021"'))$$,
  'P0001','AVATAR_BUSY','one active run per owner');
select throws_ok($$update public.avatar_runs set result='{}'$$,'42501',null,'client cannot write runs');
select throws_ok($$update public.avatar_runs set status='ready' where true$$,'42501',null,'client cannot advance status');
select throws_ok($$select * from private.avatar_leases$$,'42501',null,'leases stay private');
select throws_ok($$select public.claim_avatar_run(auth.uid(),'a1000000-0000-4000-8000-000000000020',gen_random_uuid())$$,
  '42501',null,'client cannot claim');
reset role;
select is((select available_attempts from private.avatar_quotas where owner_id='a1000000-0000-4000-8000-000000000001' and kind='generate'),1,'busy rejection debits nothing');

-- T23: the partial unique index is the single-flight arbiter.
select throws_ok($$insert into public.avatar_runs(id,owner_id,kind,theme_id,theme_version,status,expires_at)
  values('a1000000-0000-4000-8000-000000000022','a1000000-0000-4000-8000-000000000001','generate','cyberpunk',1,'queued',clock_timestamp()+interval '600 seconds')$$,
  '23505',null,'database enforces one active run per owner');

-- T20/T21/T19: extension, anonymous and other-account callers are all refused.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","client_id":"extension"}',true);
select is((select count(*)::int from public.avatar_runs),0,'extension client reads no rows');
select throws_ok($$select public.read_avatar_run('a1000000-0000-4000-8000-000000000020')$$,'42501','AVATAR_FORBIDDEN','extension client cannot read its own run');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
select throws_ok($$select public.read_avatar_run('a1000000-0000-4000-8000-000000000020')$$,'42501','AVATAR_FORBIDDEN','anonymous session refused');
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.avatar_runs),0,'another account sees no rows');
select throws_ok($$select public.read_avatar_run('a1000000-0000-4000-8000-000000000020')$$,'P0002','AVATAR_NOT_FOUND','another account cannot read the run');
reset role;

-- T03/T04: claim is single, lease is immutable.
set local role service_role;
select is(public.claim_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000030')->'acquired','true'::jsonb,'first claim acquires execution');
select is((select status from public.avatar_runs where id='a1000000-0000-4000-8000-000000000020'),'running','claim moves the run to running');
select is(public.claim_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000031')->'acquired','false'::jsonb,'second claim is refused');
select is((select lease_id from private.avatar_leases where run_id='a1000000-0000-4000-8000-000000000020'),'a1000000-0000-4000-8000-000000000030'::uuid,'existing lease is never rewritten');

-- T26/T27: lease ownership and result contract.
select throws_ok($$select public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000031','{"status":"generated"}')$$,
  '42501','AVATAR_FORBIDDEN','wrong lease cannot complete');
select throws_ok($$select public.finish_avatar_run('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000030','{"status":"generated"}')$$,
  'P0002','AVATAR_NOT_FOUND','wrong owner cannot complete');
select throws_ok($$select public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000030','{"status":"generated","bytes":1}')$$,
  '22023','AVATAR_INVALID_RESULT','incomplete success result rejected');
select throws_ok($$select public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000030','{"status":"timed_out","extra":1}')$$,
  '22023','AVATAR_INVALID_RESULT','failure result carries no extra keys');
reset role;
select is((select status from public.avatar_runs where id='a1000000-0000-4000-8000-000000000020'),'running','rejected results do not mutate the run');

-- T05/T06: success is persisted once and replays exactly.
select set_config('avatar_test.success',
  jsonb_build_object('status','generated',
    'objectPath','a1000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000020/avatar.glb',
    'mimeType','model/gltf-binary','bytes',1048576,'sha256',repeat('a',64))::text,true);
set local role service_role;
select is(public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000030',current_setting('avatar_test.success')::jsonb)->>'status','ready','T05 success completes the run');
select is(public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000030',current_setting('avatar_test.success')::jsonb)->'result',current_setting('avatar_test.success')::jsonb,'T06 exact replay returns the stored result');
select throws_ok($$select public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000020','a1000000-0000-4000-8000-000000000030',
  jsonb_set(current_setting('avatar_test.success')::jsonb,'{sha256}',to_jsonb(repeat('b',64))))$$,'22023','AVATAR_COMPLETION_REUSED','same lease cannot complete twice with a different result');
reset role;

-- T07: cancelling a queued run refunds once, never twice.
insert into private.avatar_quotas values('a1000000-0000-4000-8000-000000000001','generate',1)
  on conflict (owner_id,kind) do update set available_attempts=1;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{runId}','"a1000000-0000-4000-8000-000000000023"'))->>'status','queued','terminal runs do not block a new run');
select is(public.cancel_avatar_run('a1000000-0000-4000-8000-000000000023')->'result','{"status":"cancelled"}'::jsonb,'T07 cancel records the terminal result');
select is(public.cancel_avatar_run('a1000000-0000-4000-8000-000000000023')->'result','{"status":"cancelled"}'::jsonb,'repeat cancel returns the same row');
reset role;
select is((select available_attempts from private.avatar_quotas where owner_id='a1000000-0000-4000-8000-000000000001' and kind='generate'),1,'cancel refunds exactly once');

-- T31/T32: expiry refunds only a queued run.
insert into private.avatar_quotas values('a1000000-0000-4000-8000-000000000001','generate',2)
  on conflict (owner_id,kind) do update set available_attempts=2;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{runId}','"a1000000-0000-4000-8000-000000000024"'))->>'status','queued','third run reserved for expiry');
reset role;
update public.avatar_runs set expires_at=clock_timestamp()-interval '1 second' where id='a1000000-0000-4000-8000-000000000024';
set local role authenticated;
select is(public.read_avatar_run('a1000000-0000-4000-8000-000000000024')->>'status','cancelled','expired queued run becomes cancelled');
select is(public.read_avatar_run('a1000000-0000-4000-8000-000000000024')->'result','{"status":"cancelled"}'::jsonb,'expired queued run records cancelled');
reset role;
select is((select available_attempts from private.avatar_quotas where owner_id='a1000000-0000-4000-8000-000000000001' and kind='generate'),2,'queued expiry refunds once');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{runId}','"a1000000-0000-4000-8000-000000000025"'))->>'status','queued','fourth run reserved for claimed expiry');
reset role;
set local role service_role;
select is(public.claim_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000025','a1000000-0000-4000-8000-000000000040')->'acquired','true'::jsonb,'fourth run claimed');
reset role;
update public.avatar_runs set expires_at=clock_timestamp()-interval '1 second' where id='a1000000-0000-4000-8000-000000000025';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.read_avatar_run('a1000000-0000-4000-8000-000000000025')->>'status','interrupted','claimed expiry interrupts the run');
select is(public.read_avatar_run('a1000000-0000-4000-8000-000000000025')->'result','{"status":"timed_out"}'::jsonb,'claimed expiry records a timeout');
reset role;
select is((select available_attempts from private.avatar_quotas where owner_id='a1000000-0000-4000-8000-000000000001' and kind='generate'),1,'claimed expiry refunds nothing');

-- T33: a late success receipt cannot revive an interrupted run.
set local role service_role;
select is(public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000025','a1000000-0000-4000-8000-000000000040',current_setting('avatar_test.success')::jsonb)->>'status','interrupted','late success receipt does not revive the run');
reset role;
select is((select lease_id from private.avatar_leases where run_id='a1000000-0000-4000-8000-000000000025'),'a1000000-0000-4000-8000-000000000040'::uuid,'expiry never deletes or rewrites the lease');

-- A legitimate provider failure must complete the run as failed (contract 1.3 / 5.4).
insert into private.avatar_quotas values('a1000000-0000-4000-8000-000000000001','generate',1)
  on conflict (owner_id,kind) do update set available_attempts=1;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{runId}','"a1000000-0000-4000-8000-000000000027"'))->>'status','queued','run reserved for a failure receipt');
reset role;
set local role service_role;
select is(public.claim_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000027','a1000000-0000-4000-8000-000000000050')->'acquired','true'::jsonb,'failure run claimed');
select is(public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000027','a1000000-0000-4000-8000-000000000050','{"status":"unavailable"}')->>'status','failed','a valid failure receipt completes the run as failed');
select is(public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000027','a1000000-0000-4000-8000-000000000050','{"status":"unavailable"}')->'result','{"status":"unavailable"}'::jsonb,'the failure result is persisted verbatim');
select throws_ok($$select public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000027','a1000000-0000-4000-8000-000000000050','{"status":"rate_limited"}')$$,
  '22023','AVATAR_COMPLETION_REUSED','a different payload on a completed lease is refused');
reset role;
select is((select status from public.avatar_runs where id='a1000000-0000-4000-8000-000000000027'),'failed','no later receipt can overwrite the recorded failure');

-- The unknown-literal rule can only be observed BEFORE a digest exists, so it needs
-- its own fresh run and lease.
insert into private.avatar_quotas values('a1000000-0000-4000-8000-000000000001','generate',1)
  on conflict (owner_id,kind) do update set available_attempts=1;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select is(public.begin_avatar_run(jsonb_set(current_setting('avatar_test.request')::jsonb,'{runId}','"a1000000-0000-4000-8000-000000000028"'))->>'status','queued','fresh run reserved for the unknown-literal check');
reset role;
set local role service_role;
select is(public.claim_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000028','a1000000-0000-4000-8000-000000000051')->'acquired','true'::jsonb,'unknown-literal run claimed');
select throws_ok($$select public.finish_avatar_run('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000028','a1000000-0000-4000-8000-000000000051','{"status":"bogus"}')$$,
  '22023','AVATAR_INVALID_RESULT','an unknown failure literal is rejected before any receipt is accepted');
reset role;
select is((select status from public.avatar_runs where id='a1000000-0000-4000-8000-000000000028'),'running','a rejected literal leaves the run claimable for the true outcome');

-- T37: policy shape is exactly one owner-read policy on the public table.
select is((select count(*)::int from pg_policy where polrelid='public.avatar_runs'::regclass),1,'exactly one policy on avatar_runs');
select is((select count(*)::int from pg_policy where polrelid in ('private.avatar_quotas'::regclass,'private.avatar_leases'::regclass)),0,'no policy on private avatar tables');
select policies_are('public','avatar_runs',array['avatar_web_owner_read'],'avatar runs expose only the owner read policy');

select * from finish();
rollback;
