begin;
select no_plan();
insert into auth.users(id,email) values
 ('d9000000-0000-4000-8000-000000000001','node-planning-owner@example.test'),
 ('d9000000-0000-4000-8000-000000000002','node-planning-other@example.test');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000001"}',true);
create temporary table planning_snapshot as
select jsonb_build_object('schemaVersion',2,'id',id,'version',0,'title','Formal path',
 'goals','[{"id":"d9000000-0000-4000-8000-000000000010","title":"Practice speaking","position":0,"stages":[{"id":"d9000000-0000-4000-8000-000000000020","title":"First steps","position":0,"nodes":[{"id":"d9000000-0000-4000-8000-000000000030","type":"practice","title":"Record a talk","position":0,"description":"Keep my description","estimatedMinutes":45,"completionCriteria":"Record three minutes and review the result","dependencyIds":[],"resources":[]}]}]}]'::jsonb) value
from public.blueprints;
update planning_snapshot set value = jsonb_set(value,'{goals,0,stages,0,nodes}',value#>'{goals,0,stages,0,nodes}' ||
 '[{"id":"d9000000-0000-4000-8000-000000000031","type":"learn","title":"Understand structure","position":1,"estimatedMinutes":null,"completionCriteria":"","dependencyIds":[],"resources":[]},{"id":"d9000000-0000-4000-8000-000000000032","type":"checkpoint","title":"Review the recording","position":2,"estimatedMinutes":2147483647,"completionCriteria":"Explain one improvement","dependencyIds":[],"resources":[]},{"id":"d9000000-0000-4000-8000-000000000033","type":"reflection","title":"Reflect","position":3,"estimatedMinutes":1,"completionCriteria":"Write one lesson","dependencyIds":[],"resources":[]}]'::jsonb);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
select 'd9000000-0000-4000-8000-000000000040',owner_id,id,0,(select value from planning_snapshot),'d9000000-0000-4000-8000-000000000050' from public.blueprints;
select lives_ok($$select public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000040',0,'d9000000-0000-4000-8000-000000000060')$$,
 'a confirmed v2 proposal persists node effort and completion criteria');
select lives_ok($$select public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001')$$,
 'the v2 read interface exposes a coherent current snapshot');
update planning_snapshot set value=jsonb_set(value,'{version}','1');
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),
 'all four node types round-trip metadata, explicit unknown values and optional descriptions without video');
select is((select snapshot from public.blueprint_revisions),(select value from planning_snapshot),'the immutable revision includes the complete v2 content');
select is(public.read_blueprint_snapshot('d9000000-0000-4000-8000-000000000001')->'schemaVersion','1'::jsonb,'the legacy read interface remains v1 during deployment');
select ok(not ((public.read_blueprint_snapshot('d9000000-0000-4000-8000-000000000001')#>'{goals,0,stages,0,nodes,0}') ? 'estimatedMinutes'),
 'legacy readers receive their original readonly projection');

update planning_snapshot set value=jsonb_set(jsonb_set(value,'{goals,0,stages,0,nodes,0,estimatedMinutes}','60'),'{goals,0,stages,0,nodes,0,completionCriteria}','"Review a five minute recording"');
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
select 'd9000000-0000-4000-8000-000000000041',owner_id,id,1,(select value from planning_snapshot),gen_random_uuid() from public.blueprints;
select is(public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000041',1,'d9000000-0000-4000-8000-000000000061'),2::bigint,'changing only planning metadata creates one formal revision');
select is(public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000041',1,'d9000000-0000-4000-8000-000000000061'),2::bigint,'exact confirmation retry does not apply metadata twice');
update planning_snapshot set value=jsonb_set(value,'{version}','2');
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),'the metadata-only revision reads back completely');

create temporary table invalid_planning as
select gen_random_uuid() proposal_id,label,
 case when replacement is null then value #- array['goals','0','stages','0','nodes','0',key]
 else jsonb_set(value,array['goals','0','stages','0','nodes','0',key],replacement) end value
from planning_snapshot cross join (values
 ('missing effort','estimatedMinutes',null::jsonb),('zero effort','estimatedMinutes','0'),
 ('negative effort','estimatedMinutes','-1'),('fractional effort','estimatedMinutes','1.5'),
 ('oversized effort','estimatedMinutes','2147483648'),('string effort','estimatedMinutes','"45"'),
 ('boolean effort','estimatedMinutes','true'),('missing criteria','completionCriteria',null),
 ('null criteria','completionCriteria','null'),('numeric criteria','completionCriteria','1'),
 ('oversized criteria','completionCriteria',to_jsonb(repeat('x',4001))),
 ('UTF16 oversized criteria','completionCriteria',to_jsonb(repeat('😀',2001)))
) invalid(label,key,replacement);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
select invalid.proposal_id,b.owner_id,b.id,2,invalid.value,gen_random_uuid() from invalid_planning invalid cross join public.blueprints b;
select throws_ok(format('select public.apply_blueprint_proposal(%L,2,%L)',proposal_id,gen_random_uuid()),'23514','NODE_PLANNING_INVALID',label || ' is rejected atomically') from invalid_planning;
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),'invalid planning leaves root, metadata and hierarchy intact');
select is((select count(*) from public.blueprint_revisions),2::bigint,'invalid metadata creates no revisions');
create temporary table unknown_shapes as
select gen_random_uuid() proposal_id,label,jsonb_set(value,path,'"future content"') value
from planning_snapshot cross join (values
 ('node unknown key',array['goals','0','stages','0','nodes','0','futureField']),
 ('snapshot unknown key',array['futureField']),
 ('goal unknown key',array['goals','0','futureField']),
 ('stage unknown key',array['goals','0','stages','0','futureField'])
) cases(label,path);
insert into unknown_shapes
select gen_random_uuid(),label,jsonb_set(value,'{goals,0,stages,0,nodes,0,resources}',jsonb_build_array(
 '{"id":"d9000000-0000-4000-8000-000000000070","kind":"youtube_video","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","externalId":"dQw4w9WgXcQ"}'::jsonb || extra))
from planning_snapshot cross join (values
 ('resource unknown key','{"futureField":"private annotation"}'::jsonb),
 ('unpublished resource position','{"position":1}'::jsonb)
) cases(label,extra);
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
select invalid.proposal_id,b.owner_id,b.id,2,invalid.value,gen_random_uuid() from unknown_shapes invalid cross join public.blueprints b;
select throws_ok(format('select public.apply_blueprint_proposal(%L,2,%L)',proposal_id,gen_random_uuid()),'23514','BLUEPRINT_SNAPSHOT_INVALID',label || ' cannot disappear from formal read') from unknown_shapes;
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),'unknown-field rejection preserves the complete current snapshot');
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
select 'd9000000-0000-4000-8000-000000000042',owner_id,id,2,jsonb_set((select value from planning_snapshot),'{schemaVersion}','1'),gen_random_uuid() from public.blueprints;
select throws_ok($$select public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000042',2,gen_random_uuid())$$,'23514','BLUEPRINT_SNAPSHOT_INVALID','legacy pending writes fail closed instead of dropping planning metadata');
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),'legacy rejection preserves current content');

update planning_snapshot set value=jsonb_set(jsonb_set(value,'{goals,0,stages,0,nodes,0,estimatedMinutes}','null'),'{goals,0,stages,0,nodes,0,completionCriteria}','""');
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
select 'd9000000-0000-4000-8000-000000000043',owner_id,id,2,(select value from planning_snapshot),gen_random_uuid() from public.blueprints;
select is(public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000043',2,'d9000000-0000-4000-8000-000000000063'),3::bigint,'explicit null and empty criteria intentionally clear metadata');
update planning_snapshot set value=jsonb_set(value,'{version}','3');
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),'unknown effort stays an explicit null after clearing');
insert into public.blueprint_proposals(id,owner_id,blueprint_id,base_version,proposed_snapshot,client_mutation_id)
select 'd9000000-0000-4000-8000-000000000044',owner_id,id,3,
 jsonb_set(jsonb_set((select value from planning_snapshot),'{goals,0,stages,0,nodes,0,estimatedMinutes}','1.0'),'{goals,0,stages,0,nodes,0,completionCriteria}',to_jsonb(repeat('😀',2000))),gen_random_uuid() from public.blueprints;
select lives_ok($$select public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000044',3,gen_random_uuid())$$,'integral JSON numbers and exactly 4000 UTF16 units are accepted');
update planning_snapshot set value=jsonb_set(jsonb_set(jsonb_set(value,'{version}','4'),'{goals,0,stages,0,nodes,0,estimatedMinutes}','1'),'{goals,0,stages,0,nodes,0,completionCriteria}',to_jsonb(repeat('😀',2000)));
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),'boundary values remain complete on read');
select throws_ok($$update public.path_nodes set estimated_minutes=5$$,'42501','permission denied for table path_nodes','planning metadata cannot bypass proposal confirmation');
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000002"}',true);
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),null::jsonb,'another owner cannot read metadata');
select throws_ok($$select public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000042',2,gen_random_uuid())$$,'P0002','PROPOSAL_NOT_FOUND','another owner cannot apply planning metadata');
reset role;
insert into private.app_config(key,value) values('extension_oauth_client_id','node-planning-extension') on conflict(key) do update set value=excluded.value;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000001","client_id":"node-planning-extension"}',true);
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),(select value from planning_snapshot),'configured extension reads the same metadata');
select throws_ok($$select public.apply_blueprint_proposal('d9000000-0000-4000-8000-000000000042',2,gen_random_uuid())$$,'42501','BLUEPRINT_FORBIDDEN','extension remains unable to change formal metadata');
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000001","client_id":"unknown"}',true);
select is(public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001'),null::jsonb,'unknown OAuth cannot read v2');
set local role anon;
select throws_ok($$select public.read_blueprint_snapshot_v2('d9000000-0000-4000-8000-000000000001')$$,'42501','permission denied for function read_blueprint_snapshot_v2','anonymous v2 execution is denied');
reset role;
select * from finish();
rollback;
