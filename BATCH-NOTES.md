# FPSO Saturday Races batch

Provider capability checked on 2026-10-04 using the existing production diagnostics and PuntersEdge results documentation. Final payloads contain placings and fixed-price dividends, but no verified Sportsbet dividend provenance. `market_state_source` describes market-state collection, not dividend provenance. Odds API's historical race diagnostic returned no events. The worker therefore captures FINAL placings and scratchings but never substitutes these prices or starting prices for official Sportsbet dividends. Admin must enter official Sportsbet dividends and verify FINAL before settlement. This is the requested manual fallback.

The existing `fpso-race-automation` Supabase function is updated, not duplicated. Its existing cron job now runs a database eligibility check every three minutes. It invokes the worker only for published, unsettled races within the relevant window. Result requests are batched by AET date, back off to 15 minutes after an hour, stop after 24 hours, and stop immediately after confirmed FINAL placings awaiting manual dividends. Settled races are never polled. Pre-race Sportsbet favourites are captured in the final six minutes, only before the jump. No new Netlify environment variables or hosting accounts are required.

The worker uses a generated secret stored in Supabase Vault, verified through a service-only RPC, with an atomic lease. Its public endpoint does not trust browser-provided results or credentials. Database row locks and a trigger protect already-settled results; only the explicit admin correction RPC may change them.

Payment method and Paid are stored on each entrant. Existing browser-local payment checkmarks cannot be recovered centrally and are not treated as evidence of payment. Everyone may read the list; authenticated players may update only their own payment fields. Payment method follows event lock; Paid remains editable after lock. Server timestamps are set on payment changes. Realtime is enabled on entrants, races, runners and events.

New events begin with an unpublished draft card. Publication validates exactly 10 distinct races, times and runners. Manual editing has no meeting-count limit; Auto Generate retains its existing two-per-meeting limit. Published cards and saved selections are protected from replacement in the app. Existing cards are retained as published for compatibility.

The existing champion banner activates only when all 10 races are settled. No automatic archive or finalisation is added. Original selections remain recorded; scratching substitutions affect scoring and display only.

Validation: Node syntax and settlement/scoring/card tests; mobile browser tests for payments, lock behavior, admin-only warning and champion banner; database tests under authenticated, anon and service roles, rolled back after assertions. Existing accounts, archived event, ten settled races and twenty selections are retained.

Applied database migration history: `20261004120948_fpso_final_lifecycle_and_shared_payments`, `20261004121130_fpso_payment_trigger_permissions`, and the later initial-paid-timestamp migration. `supabase/batch.sql` is the consolidated reference; do not reapply it to the existing project. Cron configuration is updated after deploying the worker using `cron.alter_job`.

Run source tests with `node tests/batch.test.mjs` from the repository root.
