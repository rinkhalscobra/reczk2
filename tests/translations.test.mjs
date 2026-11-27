import assert from 'node:assert/strict';
import test from 'node:test';
import { auditTranslations, flattenTranslations, loadTranslationModule } from '../scripts/lib/translationAudit.mjs';

const audit = await auditTranslations();

test('every used translation key, including configured and dynamic labels, exists in all four languages', () => {
  assert.deepEqual(audit.missing, []);
  assert.deepEqual(audit.unresolvedPrefixes, []);
});

test('all languages have the same nonempty messages and interpolation placeholders', () => {
  assert.deepEqual(audit.parity, []);
  assert.deepEqual(audit.placeholderIssues, []);
});

test('translation fallback uses English and readable labels instead of exposing internal keys', async () => {
  const { translate } = await loadTranslationModule('src/i18n/translate.ts');
  const catalog = { en: { auth: { login: 'Sign in', blank: '' } }, fr: { auth: { login: 'Connexion' } } };
  assert.equal(translate(catalog, 'fr', 'auth.login'), 'Connexion');
  assert.equal(translate(catalog, 'de', 'auth.login'), 'Sign in');
  assert.equal(translate(catalog, 'fr', 'auth.passwordResetApproved'), 'Password Reset Approved');
  assert.equal(translate(catalog, 'fr', 'auth.blank'), 'Blank');
  assert.equal(translate(catalog, 'fr', ''), 'Text unavailable');
  assert.equal(translate(catalog, 'fr', 'constructor.name'), 'Name');
});

test('supplemental client and CRM language dictionaries are complete', async () => {
  for (const [file, name] of [
    ['clientExperience.ts', 'copy'], ['transactionAnalysis.ts', 'copy'], ['clientCaseNumber.ts', 'content'],
    ['groupDetails.ts', 'content'], ['permissions.ts', 'copy'],
    ['staffCredentials.ts', 'content'], ['company.ts', 'companyCopy'],
  ]) {
    const { messagesForAudit: copy } = await loadTranslationModule('src/i18n/' + file, name);
    const keys = Object.keys(flattenTranslations(copy.en)).sort();
    for (const language of ['en', 'fr', 'de', 'it']) {
      const values = flattenTranslations(copy[language]);
      assert.deepEqual(Object.keys(values).sort(), keys, `${file}: ${language}`);
      assert.ok(Object.values(values).every(value => value.trim()), `${file}: ${language} has an empty message`);
    }
  }
});

test('public copy has a nonempty entry for each supported language', async () => {
  const { messagesForAudit: messages } = await loadTranslationModule('src/i18n/publicSite.ts', 'messages');
  for (const [key, values] of Object.entries(messages)) {
    assert.equal(values.length, 4, key);
    assert.ok(values.every(value => typeof value === 'string' && value.trim()), key);
  }
});
