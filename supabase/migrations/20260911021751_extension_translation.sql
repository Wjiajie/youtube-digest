CREATE OR REPLACE FUNCTION private.translation_actor()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  raise exception 'TRANSLATION_FORBIDDEN' using errcode='42501';
 end if;
 if auth.jwt() ? 'client_id' then
  -- The existing exact-config helper treats null as Web. Reject malformed
  -- present claims before consulting it; never normalize client identity.
  if jsonb_typeof(auth.jwt()->'client_id') is distinct from 'string'
    or btrim(auth.jwt()->>'client_id')=''
    or not private.can_access_progress_evidence() then
   raise exception 'TRANSLATION_FORBIDDEN' using errcode='42501';
  end if;
 end if;
 return auth.uid();
end $function$
;
