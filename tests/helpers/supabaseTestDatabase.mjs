import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';

// Minimal platform schemas for executing application migrations and RLS as the
// real database roles. The production defaults are important for ACL tests.
export async function createSupabaseTestDatabase({ beforeMigration } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
      CREATE SCHEMA auth;
      CREATE SCHEMA storage;
      CREATE SCHEMA extensions;
      CREATE TABLE auth.users (
        id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb,
        raw_app_meta_data jsonb, created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE auth.identities (id uuid PRIMARY KEY, user_id uuid);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.role', true), '')
      $$;
      CREATE TABLE storage.buckets (
        id text PRIMARY KEY, name text, public boolean DEFAULT false,
        file_size_limit bigint, allowed_mime_types text[]
      );
      CREATE TABLE storage.objects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text,
        name text, owner uuid, owner_id text, metadata jsonb
      );
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql AS $$
        SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1)-1]
      $$;
      CREATE PUBLICATION supabase_realtime;
    `);

    const directory = new URL('../../supabase/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
      if (beforeMigration) await beforeMigration(db, name);
      await db.exec((await readFile(new URL(name, directory), 'utf8')).replace(/^\uFEFF/, ''));
    }
    await db.exec(`
      GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      SELECT set_config('request.jwt.claim.role', 'service_role', false);
    `);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
