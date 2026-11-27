-- Keep the schema-only target free of legacy environment-specific allowlist rows.
DELETE FROM public.ip_whitelist;
