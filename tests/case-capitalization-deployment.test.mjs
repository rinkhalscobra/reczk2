import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabaseTestDatabase } from './helpers/supabaseTestDatabase.mjs';

test('old backend uppercases Case@552; deployment preserves new cases and allows the existing record to be corrected', async () => {
  const existingId = '33000000-0000-4000-8000-000000000001';
  const newId = '33000000-0000-4000-8000-000000000002';
  const db = await createSupabaseTestDatabase({
    beforeMigration: async (database, name) => {
      if (name !== '20261123150000_preserve_case_number_capitalization.sql') return;
      await database.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)', [
        existingId, 'before-deployment@example.test', { case_number: 'Case@552' },
      ]);
      assert.equal((await database.query('SELECT case_number FROM profiles WHERE id=$1', [existingId])).rows[0].case_number, 'CASE@552');
    },
  });
  try {
    const authBefore = (await db.query('SELECT * FROM auth.users WHERE id=$1', [existingId])).rows[0];
    assert.equal((await db.query('SELECT case_number FROM profiles WHERE id=$1', [existingId])).rows[0].case_number, 'CASE@552');
    await db.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ($1,$2,$3)', [
      newId, 'after-deployment@example.test', { case_number: 'Case@552' },
    ]);
    assert.equal((await db.query('SELECT case_number FROM profiles WHERE id=$1', [newId])).rows[0].case_number, 'Case@552');
    await db.query('UPDATE profiles SET case_number=$1 WHERE id=$2', ['Case@552', existingId]);
    assert.equal((await db.query('SELECT case_number FROM profiles WHERE id=$1', [existingId])).rows[0].case_number, 'Case@552');
    assert.deepEqual((await db.query('SELECT * FROM auth.users WHERE id=$1', [existingId])).rows[0], authBefore);
  } finally { await db.close(); }
});
