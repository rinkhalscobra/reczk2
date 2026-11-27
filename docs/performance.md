# Login and dashboard performance

The login page now loads dashboard code on demand. The initial production JavaScript entry decreased from 1,309.06 kB (371.78 kB gzip) to approximately 804 kB (250 kB gzip). These are build measurements, not measurements of live Supabase response times.

Role checks share a query keyed by account ID. Login, route guards, navigation, and staff dashboards reuse that result. Customers without a staff-role row are handled normally. Failed role checks show a retry screen rather than redirecting repeatedly. Private query results are discarded on logout or account changes.

Agent profile and customer queries run together, and the customer list requests only the fields it displays. Agent status edits update the local query result after the server confirms the write. Group administrators and supervisors also start independent queries together; staff session history no longer delays the group administrator's main dashboard.

Customer pages share their account data across dashboard navigation. One live channel covers the six customer tables. Token refreshes do not reload dashboard data or recreate those subscriptions. Missing profiles and failed route downloads have visible recovery screens.

Automatic token refresh remains enabled. Password authentication, MFA, IP validation, and role restrictions remain in the login flow. Navigation waits for IP validation to succeed. An unavailable MFA service stops the login attempt so verification cannot be bypassed.

## Verification

Configure the existing `.env` values as described in the project README, then run:

```sh
npm test
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx playwright install chromium
npm run test:browser
```

Browser tests build the production app into the ignored `.test-build/` directory and use port 4175. They intercept Supabase HTTP and WebSocket traffic; no production accounts or data are changed. Coverage includes all five account types, fresh agent login, MFA, denied IPs, logout, failed role requests, missing profiles, a rate-limited expired session, failed dashboard downloads, customer navigation, and live profile updates.

After deployment, validate a real agent login against the live Supabase project. Missing database records, RLS configuration, and the cause of any ongoing auth rate limits require live backend evidence; these frontend changes do not modify those records or settings.
