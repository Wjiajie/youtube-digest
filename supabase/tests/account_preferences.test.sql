begin;
select plan(16);

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'preferences-owner@example.test'),
  ('a1000000-0000-4000-8000-000000000002', 'preferences-outsider@example.test');
insert into private.app_config (key, value)
values ('extension_oauth_client_id', 'preferences-test-extension')
on conflict (key) do update set value = excluded.value;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001"}', true);

select results_eq(
  $$select theme_id, theme_version, preferences_revision from public.profiles$$,
  $$values ('cyberpunk'::text, 1, 0::bigint)$$,
  'a new account receives a versioned default theme outside the Blueprint'
);

select results_eq(
  $$update public.profiles set theme_id = 'eastern'
    where preferences_revision = 0 returning theme_id, preferences_revision$$,
  $$values ('eastern'::text, 1::bigint)$$,
  'saving a theme advances only its independent preference revision'
);
select is_empty(
  $$update public.profiles set theme_id = 'cyberpunk'
    where preferences_revision = 0 returning id$$,
  'a stale tab cannot overwrite the newer theme'
);
select results_eq(
  $$update public.profiles set theme_id = 'eastern'
    where preferences_revision = 1 returning preferences_revision$$,
  $$values (1::bigint)$$,
  'saving the same theme leaves its revision unchanged'
);
select results_eq(
  $$select version from public.blueprints$$,
  $$values (0::bigint)$$,
  'theme saves never revise the official Blueprint'
);
select throws_ok(
  $$update public.profiles set preferences_revision = 99$$,
  '42501', 'permission denied for table profiles',
  'the client cannot forge the server-owned preference revision'
);
select throws_ok(
  $$update public.profiles set theme_id = 'https://external.example.com/theme'$$,
  '23514', null, 'stored theme IDs cannot be arbitrary resource URLs'
);
select throws_ok(
  $$update public.profiles set theme_version = 0$$,
  '23514', null, 'stored theme versions must be positive'
);
select results_eq(
  $$update public.profiles set display_name = '行旅者' returning preferences_revision$$,
  $$values (1::bigint)$$,
  'editing the display name remains allowed without changing the theme revision'
);
select throws_ok(
  $$update public.profiles set id = 'a1000000-0000-4000-8000-000000000003'$$,
  '42501', 'permission denied for table profiles', 'profile ownership cannot be reassigned'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","client_id":"preferences-test-extension"}', true);
select results_eq(
  $$select theme_id, preferences_revision from public.profiles$$,
  $$values ('eastern'::text, 1::bigint)$$,
  'the authorized extension reads the same account preference'
);
select is_empty(
  $$update public.profiles set theme_id = 'cyberpunk' returning id$$,
  'the extension cannot change a preference even through the Data API'
);

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002"}', true);
select is_empty(
  $$select theme_id from public.profiles where id = 'a1000000-0000-4000-8000-000000000001'$$,
  'a second account cannot read the owner preference'
);
select is_empty(
  $$update public.profiles set theme_id = 'cyberpunk'
    where id = 'a1000000-0000-4000-8000-000000000001' returning id$$,
  'a second account cannot overwrite the owner preference'
);
select results_eq(
  $$select theme_id, preferences_revision from public.profiles$$,
  $$values ('cyberpunk'::text, 0::bigint)$$,
  'the second account retains its own independent default'
);

reset role;
set local role anon;
select throws_ok(
  $$select theme_id from public.profiles$$,
  '42501', 'permission denied for table profiles', 'anonymous callers cannot read preferences'
);
reset role;

select * from finish();
rollback;
