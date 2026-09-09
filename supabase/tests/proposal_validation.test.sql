begin;
select plan(36);

insert into auth.users (id, email) values
  ('a3000000-0000-4000-8000-000000000001', 'proposal-validation@example.test');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a3000000-0000-4000-8000-000000000001"}', true);

create temporary table valid_snapshot as
select jsonb_build_object('schemaVersion', 2, 'id', id, 'version', 0, 'title', 'Intact path',
  'goals', '[{"id":"a3000000-0000-4000-8000-000000000100","title":"Goal","position":0,"stages":[{"id":"a3000000-0000-4000-8000-000000000101","title":"Stage","position":0,"nodes":[{"id":"a3000000-0000-4000-8000-000000000102","title":"Learn","position":0,"type":"learn","estimatedMinutes":null,"completionCriteria":"","dependencyIds":[],"resources":[{"id":"a3000000-0000-4000-8000-000000000103","kind":"youtube_video","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","externalId":"dQw4w9WgXcQ"}]}]}]}]'::jsonb
) as value from public.blueprints;

insert into public.blueprint_proposals (id, owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
select 'a3000000-0000-4000-8000-000000000010', owner_id, id, 0,
  '{"schemaVersion":2,"version":0,"title":"Missing identity","goals":[]}'::jsonb,
  'a3000000-0000-4000-8000-000000000020'
from public.blueprints;
select throws_ok(
  $$select public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000010', 0, 'a3000000-0000-4000-8000-000000000030')$$,
  '23514', 'BLUEPRINT_ID_MISMATCH', 'a snapshot without identity cannot replace the official Blueprint'
);

update public.blueprint_proposals
set proposed_snapshot = proposed_snapshot || jsonb_build_object('id', blueprint_id);
select throws_ok(
  $$select public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000010', null, 'a3000000-0000-4000-8000-000000000030')$$,
  '22023', 'PROPOSAL_ARGUMENTS_INVALID', 'a NULL expected version cannot bypass optimistic concurrency'
);

update public.blueprint_proposals set proposed_snapshot = proposed_snapshot - 'goals';
select throws_ok(
  $$select public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000010', 0, 'a3000000-0000-4000-8000-000000000030')$$,
  '23514', 'BLUEPRINT_SNAPSHOT_INVALID', 'omitting goals must not silently clear the entire path'
);

update public.blueprint_proposals set proposed_snapshot = (select value from valid_snapshot);
select is(
  public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000010', 0, 'a3000000-0000-4000-8000-000000000030'),
  1::bigint, 'a valid nested snapshot still applies after rejected attempts'
);
update valid_snapshot set value = jsonb_set(value, '{version}', '1'::jsonb);
insert into public.blueprint_proposals (id, owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
select 'a3000000-0000-4000-8000-000000000011', owner_id, id, 1,
  (select value #- '{goals,0,stages}' from valid_snapshot),
  'a3000000-0000-4000-8000-000000000021'
from public.blueprints;
select throws_ok(
  $$select public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000011', 1, 'a3000000-0000-4000-8000-000000000031')$$,
  '23514', 'BLUEPRINT_SNAPSHOT_INVALID', 'missing nested stages cannot silently archive the learning path'
);

-- NULL replacement removes a required field; JSON null is tested separately.
create temporary table invalid_snapshots as
select gen_random_uuid() as proposal_id, label, expected_error,
  case when replacement is null then value #- path
    else jsonb_set(value, path, replacement) end as snapshot
from valid_snapshot cross join (values
  ('null identity', '{id}'::text[], 'null'::jsonb, 'BLUEPRINT_ID_MISMATCH'),
  ('foreign identity', '{id}', '"a3000000-0000-4000-8000-000000000999"', 'BLUEPRINT_ID_MISMATCH'),
  ('missing schema version', '{schemaVersion}', null, 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null schema version', '{schemaVersion}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('unsupported schema version', '{schemaVersion}', '3', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('missing snapshot version', '{version}', null, 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null snapshot version', '{version}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('string snapshot version', '{version}', '"1"', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('snapshot version differs from proposal base', '{version}', '2', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null title', '{title}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('numeric title', '{title}', '12', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('blank title', '{title}', '" "', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null goals', '{goals}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('non-array goals', '{goals}', '{}', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('missing nodes', '{goals,0,stages,0,nodes}', null, 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null nodes', '{goals,0,stages,0,nodes}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('missing resources', '{goals,0,stages,0,nodes,0,resources}', null, 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null resources', '{goals,0,stages,0,nodes,0,resources}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('missing dependencies', '{goals,0,stages,0,nodes,0,dependencyIds}', null, 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null dependencies', '{goals,0,stages,0,nodes,0,dependencyIds}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID'),
  ('null stages', '{goals,0,stages}', 'null', 'BLUEPRINT_SNAPSHOT_INVALID')
) as cases(label, path, replacement, expected_error);
insert into public.blueprint_proposals (id, owner_id, blueprint_id, base_version, proposed_snapshot, client_mutation_id)
select invalid.proposal_id, blueprint.owner_id, blueprint.id, 1, invalid.snapshot, gen_random_uuid()
from invalid_snapshots invalid cross join public.blueprints blueprint;
select throws_ok(
  format('select public.apply_blueprint_proposal(%L, 1, %L)', proposal_id, gen_random_uuid()),
  '23514', expected_error, label || ' is rejected through the public RPC'
) from invalid_snapshots order by label;

select throws_ok(
  $$select public.apply_blueprint_proposal(null, 1, 'a3000000-0000-4000-8000-000000000031')$$,
  '22023', 'PROPOSAL_ARGUMENTS_INVALID', 'proposal identity must be supplied'
);
select throws_ok(
  $$select public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000011', 1, null)$$,
  '22023', 'PROPOSAL_ARGUMENTS_INVALID', 'confirmation mutation identity must be supplied'
);
select throws_ok(
  $$select public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000011', -1, 'a3000000-0000-4000-8000-000000000031')$$,
  '22023', 'PROPOSAL_ARGUMENTS_INVALID', 'negative expected versions are invalid arguments'
);
select throws_ok(
  $$select public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000011', 0, 'a3000000-0000-4000-8000-000000000031')$$,
  '40001', 'BLUEPRINT_VERSION_CONFLICT', 'stale confirmation is still rejected before snapshot writes'
);
select results_eq($$select title, version from public.blueprints$$,
  $$values ('Intact path'::text, 1::bigint)$$, 'rejected snapshots preserve the official title and version');
select results_eq(
  $$select (select count(*) from public.goals where archived_at is null),
    (select count(*) from public.stages where archived_at is null),
    (select count(*) from public.path_nodes where archived_at is null),
    (select count(*) from public.resource_bindings where archived_at is null)$$,
  $$values (1::bigint, 1::bigint, 1::bigint, 1::bigint)$$,
  'errors after archival and partial upserts roll back the entire nested path'
);
select results_eq($$select count(*) from public.blueprint_proposals where status = 'pending'$$,
  $$values (22::bigint)$$, 'all invalid proposals remain pending, not falsely confirmed');
select results_eq($$select count(*) from public.blueprint_revisions$$,
  $$values (1::bigint)$$, 'rejected proposals create no revisions');
select results_eq($$select snapshot from public.blueprint_revisions$$,
  $$select value from valid_snapshot$$, 'the stored valid revision retains its complete snapshot');

update public.blueprint_proposals
set proposed_snapshot = (select jsonb_set(value, '{goals}', '[]') from valid_snapshot)
where id = 'a3000000-0000-4000-8000-000000000011';
select is(
  public.apply_blueprint_proposal('a3000000-0000-4000-8000-000000000011', 1, 'a3000000-0000-4000-8000-000000000031'),
  2::bigint, 'an explicit empty goals array remains an intentional valid confirmation'
);

reset role;
select * from finish();
rollback;
