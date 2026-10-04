-- Additive FPSO batch: preserve existing cards, accounts and scoring data.
alter table public.events add column card_published boolean not null default false;
update public.events set card_published=true;
alter table public.participants add column payment_method text not null default 'Cash' check (payment_method in ('Cash','Bank Transfer'));
alter table public.participants add column paid boolean not null default false;
alter table public.participants add column paid_at timestamptz;
alter table public.races add column result_state text not null default 'upcoming' check (result_state in ('upcoming','running','awaiting_final','protest','final'));
alter table public.races add column settlement_reason text;
alter table public.races add column provider_checked_at timestamptz;
alter table public.races add column next_provider_check timestamptz;
alter table public.races add column settlement_source text;
alter table public.races add column settled_at timestamptz;
update public.races set result_state='final' where status='settled';

create or replace function fpso_private.entries_open(e_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.events e where e.id=e_id and e.status='open' and e.card_published
 and (e.lockout_override='open' or (e.lockout_override is null and e.lockout_time>now())))
$$;

grant update(payment_method,paid) on public.participants to authenticated;
create policy fpso_payment_self on public.participants for update to authenticated
 using (account_id=(select auth.uid())) with check (account_id=(select auth.uid()));
create function fpso_private.guard_payment() returns trigger language plpgsql set search_path='' as $$
begin
 if (select auth.uid()) is not null and
  (to_jsonb(new)-array['payment_method','paid','paid_at']) is distinct from (to_jsonb(old)-array['payment_method','paid','paid_at']) then
  raise exception 'Players may update only payment method and Paid';
 end if;
 if new.payment_method is distinct from old.payment_method and not fpso_private.entries_open(old.event_id) then
  raise exception 'Payment method is locked';
 end if;
 if new.paid is distinct from old.paid then new.paid_at=case when new.paid then now() else null end;
 else new.paid_at=old.paid_at; end if;
 return new;
end $$;
create trigger fpso_payment_guard before update on public.participants for each row execute function fpso_private.guard_payment();
grant usage on schema fpso_private to authenticated;
revoke all on function fpso_private.guard_payment() from public,anon,authenticated;

create function public.fpso_publish_card(p_event_id uuid) returns void language plpgsql set search_path='' as $$
begin
 if not fpso_private.is_admin() then raise exception 'Admin required'; end if;
 perform 1 from public.events where id=p_event_id and status='open' for update;
 if not found then raise exception 'Active event required'; end if;
 if (select count(*) from public.races where event_id=p_event_id)<>10 then raise exception 'Exactly 10 races required'; end if;
 if exists(select 1 from public.races r where r.event_id=p_event_id and
   (r.race_time is null or r.track='' or r.race_number<=0 or
    (select count(*) from public.runners n where n.race_id=r.id and not n.scratched)<2 or
    exists(select 1 from public.runners n where n.race_id=r.id and (trim(n.name)='' or n.number<=0)))) then
  raise exception 'Each race requires a valid time and runners'; end if;
 if exists(select 1 from public.races where event_id=p_event_id group by lower(regexp_replace(track,'[^a-zA-Z0-9]','','g')),race_number having count(*)>1)
 or exists(select 1 from public.races where event_id=p_event_id and api_id is not null group by api_id having count(*)>1) then
  raise exception 'Duplicate races'; end if;
 update public.events set card_published=true where id=p_event_id;
end $$;
revoke all on function public.fpso_publish_card(uuid) from public;
grant execute on function public.fpso_publish_card(uuid) to anon;

create function fpso_private.guard_settlement() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='settled' then
  if new is not distinct from old then return old; end if;
  if current_setting('fpso.admin_correction',true) is distinct from 'yes' or not fpso_private.is_admin() then
   raise exception 'Final settled race is protected; use deliberate admin correction';
  end if;
 end if;
 if new.status='settled' then
  if new.result_state<>'final' then raise exception 'FINAL result required; protest/interim cannot settle'; end if;
  if new.result_1st is null or new.result_2nd is null or new.win_div is null or new.place_div is null or new.place_div_2nd is null
   or (new.result_3rd is not null and new.place_div_3rd is null) then raise exception 'Complete Sportsbet dividends and placings required'; end if;
  if new.result_1st=new.result_2nd or new.result_1st=new.result_3rd or new.result_2nd=new.result_3rd then raise exception 'Duplicate placings'; end if;
  if exists(select 1 from unnest(array[new.result_1st,new.result_2nd,new.result_3rd]) n where n is not null and
   not exists(select 1 from public.runners r where r.race_id=new.id and r.number=n and not r.scratched)) then raise exception 'Placing must be an active runner'; end if;
  if exists(select 1 from public.runners r join public.selections s on s.race_id=r.race_id and s.runner_number=r.number where r.race_id=new.id and r.scratched)
   and new.favourite_number is null then raise exception 'Captured favourite required for scratched selections'; end if;
  if new.favourite_number is not null and not exists(select 1 from public.runners r where r.race_id=new.id and r.number=new.favourite_number) then raise exception 'Invalid favourite'; end if;
  new.settled_at=now(); new.next_provider_check=null; new.settlement_reason=null;
 end if;
 return new;
end $$;
create trigger fpso_final_guard before update on public.races for each row execute function fpso_private.guard_settlement();
revoke all on function fpso_private.guard_settlement() from public,anon,authenticated;

create function public.fpso_admin_settle(p_race_id uuid,p_values jsonb,p_confirm_final boolean,p_correction boolean default false)
 returns public.races language plpgsql set search_path='' as $$
declare v public.races;
begin
 if not fpso_private.is_admin() then raise exception 'Admin required'; end if;
 if not p_confirm_final then raise exception 'Verify official FINAL result first'; end if;
 select * into v from public.races where id=p_race_id for update;
 if not found then raise exception 'Race not found'; end if;
 if v.status='settled' and not p_correction then raise exception 'Deliberate correction required'; end if;
 perform set_config('fpso.admin_correction',case when p_correction then 'yes' else 'no' end,true);
 update public.races set result_state='final',status='settled',
 result_1st=(p_values->>'result_1st')::integer,result_2nd=(p_values->>'result_2nd')::integer,result_3rd=(p_values->>'result_3rd')::integer,
 win_div=(p_values->>'win_div')::numeric,place_div=(p_values->>'place_div')::numeric,
 place_div_2nd=(p_values->>'place_div_2nd')::numeric,place_div_3rd=(p_values->>'place_div_3rd')::numeric,
 favourite_number=(p_values->>'favourite_number')::integer,
 settlement_source=case when p_correction then 'admin_correction' else 'admin_manual_sportsbet' end
 where id=p_race_id returning * into v;
 return v;
end $$;
revoke all on function public.fpso_admin_settle(uuid,jsonb,boolean,boolean) from public;
grant execute on function public.fpso_admin_settle(uuid,jsonb,boolean,boolean) to anon;

-- Worker authentication and lease are private. No provider or service key is added to the client.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'fpso_settlement_worker');
create table fpso_private.worker_lease(id boolean primary key default true check(id),next_run timestamptz not null default '-infinity');
insert into fpso_private.worker_lease(id) values(true);
create function public.fpso_worker_claim(p_token text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_token is null or p_token<>(select decrypted_secret from vault.decrypted_secrets where name='fpso_settlement_worker') then return false; end if;
 update fpso_private.worker_lease set next_run=now()+interval '150 seconds' where id and next_run<=now();
 return found;
end $$;
revoke all on function public.fpso_worker_claim(text) from public,anon,authenticated;
grant execute on function public.fpso_worker_claim(text) to service_role;

alter publication supabase_realtime add table public.participants,public.races,public.runners,public.events;
-- Start only after the new worker is deployed. Cron checks DB eligibility before invoking it.
create function fpso_private.tick_settlement() returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.races r join public.events e on e.id=r.event_id
 where e.status='open' and e.card_published and r.status<>'settled'
 and r.race_time<=now()+interval '6 minutes' and r.race_time>now()-interval '24 hours'
 and (r.next_provider_check is null or r.next_provider_check<=now())) then
  perform net.http_post(url:='https://utvkvajxiybyeysdhalb.supabase.co/functions/v1/fpso-race-automation',
   headers:=jsonb_build_object('Content-Type','application/json','x-fpso-worker',(select decrypted_secret from vault.decrypted_secrets where name='fpso_settlement_worker')),
   body:='{}'::jsonb,timeout_milliseconds:=60000);
 end if;
end $$;
revoke all on function fpso_private.tick_settlement() from public,anon,authenticated;

create function public.fpso_worker_apply(p_race_id uuid,p_patch jsonb,p_scratches integer[]) returns boolean
 language plpgsql set search_path='' as $$
declare v public.races;
begin
 select * into v from public.races where id=p_race_id for update;
 if not found or v.status='settled' then return false; end if;
 update public.runners set scratched=true where race_id=p_race_id and number=any(p_scratches);
 update public.races set result_state=p_patch->>'result_state',provider_checked_at=(p_patch->>'provider_checked_at')::timestamptz,
 next_provider_check=(p_patch->>'next_provider_check')::timestamptz,settlement_reason=p_patch->>'settlement_reason',
 result_1st=case when p_patch ? 'result_1st' then (p_patch->>'result_1st')::integer else result_1st end,
 result_2nd=case when p_patch ? 'result_2nd' then (p_patch->>'result_2nd')::integer else result_2nd end,
 result_3rd=case when p_patch ? 'result_3rd' then (p_patch->>'result_3rd')::integer else result_3rd end where id=p_race_id;
 return true;
end $$;
revoke all on function public.fpso_worker_apply(uuid,jsonb,integer[]) from public,anon,authenticated;
grant execute on function public.fpso_worker_apply(uuid,jsonb,integer[]) to service_role;
grant update(scratched) on public.runners to service_role;

create function fpso_private.stamp_initial_paid() returns trigger language plpgsql set search_path='' as $$
begin new.paid_at=case when new.paid then now() else null end; return new; end $$;
revoke all on function fpso_private.stamp_initial_paid() from public,anon,authenticated;
create trigger fpso_initial_paid before insert on public.participants for each row execute function fpso_private.stamp_initial_paid();

-- An in-flight odds response must not alter scratching-based scoring after FINAL.
create function fpso_private.guard_final_runner() returns trigger language plpgsql security definer set search_path='' as $$
declare r_id uuid;
begin
 r_id=case when TG_OP='DELETE' then old.race_id else new.race_id end;
 if exists(select 1 from public.races where id=r_id and status='settled') then
  raise exception 'Runner data for a settled FINAL race is protected';
 end if;
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
revoke all on function fpso_private.guard_final_runner() from public,anon,authenticated;
create trigger fpso_final_runner_guard before insert or update or delete on public.runners for each row execute function fpso_private.guard_final_runner();
