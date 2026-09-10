begin;
select plan(17);

select has_table('public', 'blueprints', 'blueprints exists');
select has_table('public', 'path_nodes', 'path nodes exist');
select has_table('public', 'resource_bindings', 'resource bindings exist independently');
select has_table('public', 'blueprint_proposals', 'proposals exist');
select has_table('public', 'blueprint_revisions', 'revisions exist');
select has_table('public', 'learning_sessions', 'learning sessions exist');
select has_function('public', 'apply_blueprint_proposal', array['uuid', 'bigint', 'uuid'], 'proposal apply function exists');
select policies_are('public', 'blueprints', array['blueprints_owner_select'], 'blueprints are directly read-only');
select ok(not has_table_privilege('authenticated', 'public.goals', 'INSERT'), 'formal goals cannot bypass proposals');
select ok(not has_table_privilege('authenticated', 'public.path_nodes', 'UPDATE'), 'formal nodes cannot bypass proposals');
select ok(not has_table_privilege('authenticated', 'public.blueprint_revisions', 'INSERT'), 'revisions are written only by apply RPC');
select ok(not has_table_privilege('authenticated', 'public.learning_sessions', 'UPDATE'), 'M1 learning sessions are append-only for clients');
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.resource_bindings'::regclass
      and conname = 'resource_bindings_url_external_id_match'
      and contype = 'c'
  ),
  'resource URL must match external video ID'
);
select policies_are('public', 'learning_sessions', array['sessions_owner_insert', 'sessions_owner_select'], 'sessions expose only owner select and append policies');
select ok(has_function_privilege('authenticated', 'public.apply_blueprint_proposal(uuid,bigint,uuid)', 'EXECUTE'), 'authenticated Web users may apply proposals');
select ok(not (select prosecdef from pg_proc where oid = 'public.apply_blueprint_proposal(uuid,bigint,uuid)'::regprocedure), 'public proposal apply uses caller privileges');
select ok((select prosecdef from pg_proc where oid = 'private.apply_blueprint_proposal_guard(uuid,bigint,uuid)'::regprocedure), 'private source guard owns the transaction boundary');

select * from finish();
rollback;
