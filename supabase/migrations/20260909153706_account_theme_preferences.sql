-- Account presentation preferences are independent of Blueprint revisions.
-- Preserve the existing owner-only SELECT / Web-only UPDATE RLS policies.
revoke update on table "public"."profiles" from "authenticated";

alter table "public"."profiles" add column "preferences_revision" bigint not null default 0;

alter table "public"."profiles" add column "theme_id" text not null default 'cyberpunk'::text;

alter table "public"."profiles" add column "theme_version" integer not null default 1;

alter table "public"."profiles" add constraint "profiles_preferences_revision_check" CHECK ((preferences_revision >= 0)) not valid;

alter table "public"."profiles" validate constraint "profiles_preferences_revision_check";

alter table "public"."profiles" add constraint "profiles_theme_id_check" CHECK ((theme_id ~ '^[a-z][a-z0-9_-]{0,63}$'::text)) not valid;

alter table "public"."profiles" validate constraint "profiles_theme_id_check";

alter table "public"."profiles" add constraint "profiles_theme_version_check" CHECK ((theme_version > 0)) not valid;

alter table "public"."profiles" validate constraint "profiles_theme_version_check";

-- Table UPDATE would override these column grants. The revision, ownership and
-- timestamps are server-owned; display_name remains editable as before.
grant update (display_name, theme_id, theme_version) on public.profiles to authenticated;

CREATE OR REPLACE FUNCTION private.track_profile_preferences()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
begin
  new.preferences_revision := old.preferences_revision;
  if (new.theme_id, new.theme_version) is distinct from (old.theme_id, old.theme_version) then
    new.preferences_revision := old.preferences_revision + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$function$
;

revoke all on function private.track_profile_preferences() from public, anon, authenticated;

CREATE TRIGGER track_profile_preferences BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.track_profile_preferences();

