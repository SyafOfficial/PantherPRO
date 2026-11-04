-- Apply only after the reviewed retention function; executed by the database owner.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule(
 'panther-closed-signals-30-days',
 '15 19 * * *', -- Daily 03:15 Asia/Kuala_Lumpur (UTC+8).
 $$select public.cleanup_closed_signals_30_days();$$
);
