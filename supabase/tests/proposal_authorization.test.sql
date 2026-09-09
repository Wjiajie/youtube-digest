begin;
select plan(16);

insert into auth.users (id, email) values
  ('a2000000-0000-4000-8000-000000000001', 'proposal-owner@example.test'),
  ('a2000000-0000-4000-8000-000000000002', 'proposal-outsider@example.test');
insert into private.app_config (key, value)
values ('extension_oauth_client_id', 'proposal-test-extension')
on conflict (key) do update set value = excluded.value;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001"}', true);
insert into public.blueprint_proposals (id, owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
select 'a2000000-0000-4000-8000-000000000010', owner_id, id, 0,
  jsonb_build_object('schemaVersion', 2, 'id', id, 'version', 0, 'title', 'Authorized path', 'goals', '[]'::jsonb),
  'a2000000-0000-4000-8000-000000000011'
from public.blueprints;
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","client_id":"proposal-test-extension"}', true);
select throws_ok(
  $$select public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020')$$,
  '42501', 'BLUEPRINT_FORBIDDEN', 'configured extension cannot invoke the Web-only proposal RPC'
);

reset role;
delete from private.app_config where key = 'extension_oauth_client_id';
set local role authenticated;
select throws_ok(
  $$select public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020')$$,
  '42501', 'BLUEPRINT_FORBIDDEN', 'losing configuration never promotes an OAuth session to Web privileges'
);
select is_empty($$select id from public.blueprint_proposals$$,
  'missing configuration does not expose Web proposal drafts to OAuth clients');
select is_empty($$update public.profiles set theme_id = 'eastern' returning id$$,
  'missing configuration does not permit OAuth preference writes');
select throws_ok(
  $$insert into public.blueprint_proposals (owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
    select owner_id, id, 0, '{}'::jsonb, gen_random_uuid() from public.blueprints$$,
  '42501', null, 'OAuth clients cannot bypass the Web proposal creation flow through the Data API'
);
select results_eq($$select version from public.blueprints$$, $$values (0::bigint)$$,
  'OAuth clients retain owner Blueprint read access without formal writes');
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","client_id":"unknown-client"}', true);
select throws_ok(
  $$select public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020')$$,
  '42501', 'BLUEPRINT_FORBIDDEN', 'unknown OAuth clients also lack Web-only privileges'
);
select is_empty($$update public.profiles set theme_id = 'eastern' returning id$$,
  'unknown OAuth clients cannot write account preferences either');
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020')$$,
  '42501', 'BLUEPRINT_FORBIDDEN', 'an authenticated database role alone is not an identified user'
);
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000002"}', true);
select throws_ok(
  $$select public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020')$$,
  'P0002', 'PROPOSAL_NOT_FOUND', 'a second Web account cannot apply the owner proposal'
);
select is_empty($$select id from public.blueprint_proposals$$, 'a second account cannot inspect the owner proposal');
select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","user_metadata":{"client_id":"untrusted"}}', true);
select is(
  public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020'),
  1::bigint, 'the Web owner can confirm without extension config; user metadata is not authorization'
);
select is(
  public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020'),
  1::bigint, 'retrying the same confirmation does not apply it twice'
);
select throws_ok(
  $$select public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000021')$$,
  '23514', 'PROPOSAL_NOT_PENDING', 'another mutation cannot reapply a confirmed proposal'
);
select results_eq($$select count(*) from public.blueprint_revisions$$, $$values (1::bigint)$$,
  'confirmation and retries produce exactly one owned revision');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{}', true);
select throws_ok(
  $$select public.apply_blueprint_proposal('a2000000-0000-4000-8000-000000000010', 0, 'a2000000-0000-4000-8000-000000000020')$$,
  '42501', 'permission denied for function apply_blueprint_proposal', 'anonymous callers cannot execute the definer RPC'
);
reset role;
select * from finish();
rollback;
