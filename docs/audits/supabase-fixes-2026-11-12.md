# Supabase fixes — 12 November 2026

Later workflow fix: [assignment of ungrouped customers](supabase-assignment-fix-2026-11-12.md), deployed as migration `20261112111311` after the fixes recorded below.

Customer group selection: [administrator group controls](supabase-customer-groups-2026-11-12.md), backed by migration `20261112112432`.

Current assignment rules: [unrestricted administrator assignment and agent signup codes](supabase-agent-codes-2026-11-12.md), backed by migration `20261112132035`. Group changes now preserve an administrator's agent assignment.

Applied migration `20261112105626_fix_chat_access_rpc_permissions_and_realtime` to project `pbfdnjtkeveqeukbrfmk` using the Supabase migrations API. The matching [local migration](../../supabase/migrations/20261112105626_fix_chat_access_rpc_permissions_and_realtime.sql) is the deployment source of truth.

- Chat uploads require the caller's folder and matching owner metadata. Downloads allow owners, administrators, and authorized readers of a linked message. The policy supports single attachment paths and JSON arrays, rejects malformed references safely, and checks the sender's folder before sharing a file. Group administrators and supervisors retain access to linked customer files in their scope.
- Authenticated message updates are limited to `is_read`. Recipients cannot change the sender, recipient, content, or attachment reference to manufacture file access. Service-role update permissions remain available.
- Revoked anonymous and PUBLIC execution on the nine sensitive RPCs identified in the audit. Authenticated and service-role execution remain available. Public promocode validation still works.
- Added `customer_notes`, `case_timeline`, and `password_reset_requests` to `supabase_realtime`, bringing membership to 12 application tables.
- Set the live Auth site URL to `https://www.clientzone.space` and the redirect allowlist to `https://www.clientzone.space/` and `https://www.clientzone.space/auth`. Recorded the same settings in [config.toml](../../supabase/config.toml). Both portal pages returned HTTP 200; the apex domain redirects to `www`. The Auth settings were read back from the Management API and matched the local configuration. Signup remains enabled and email confirmation remains disabled.

Verification: `npm test` passed all 22 tests, including 13 new database behavior tests in [supabase-access.test.mjs](../../tests/supabase-access.test.mjs). These replay the entire migration chain and exercise real PostgreSQL roles and RLS in PGlite. The existing 13 isolated workflow checks also all passed after the fix. Live catalogs match the replayed schema, policies, function permissions, and publication membership; all 69 stored migration SQL entries match local files. Anonymous requests to the two sampled private read RPCs now return HTTP 401; anonymous promocode validation still returns HTTP 200.

Application data was preserved: nine Auth users, nine profiles, one message, 27 cash balance rows, and zero stored objects before and after deployment. No Edge Function source changes or redeployments were required.

All four actionable findings from the original audit have been addressed. Signing-secret and access-token rotation were not performed as part of these changes.

Full verification output: [supabase-fixes-2026-11-12-evidence.json](supabase-fixes-2026-11-12-evidence.json). The [original audit](supabase-2026-11-12.md) and its evidence describe the state before these fixes.
