-- Run after deploying the existing fpso-race-automation function.
select cron.alter_job(job_id:=jobid,schedule:='*/3 * * * *',
 command:='select fpso_private.tick_settlement();',active:=true)
from cron.job where jobname='fpso-race-automation-every-minute';
