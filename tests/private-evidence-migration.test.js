import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {legacyFileName} from '../private-evidence-migration.js';

test('legacy private evidence synthesizes safe extensions only when original extension is missing',()=>{
  const png='data:image/png;base64,iVBORw0KGgo=';
  assert.equal(legacyFileName('',png,'courier-document-7'),'courier-document-7.png');
  assert.equal(legacyFileName('support-note',png,'fallback'),'support-note.png');
  assert.equal(legacyFileName('original.png',png,'fallback'),'original.png');
  assert.equal(legacyFileName('suspicious.exe',png,'fallback'),'suspicious.exe');
});

test('migration source encodes idempotent raw-clear and service-unavailable fail-closed guards',()=>{
  const source=readFileSync(new URL('../private-evidence-migration.js',import.meta.url),'utf8');
  assert.match(source,/private_evidence_object_id IS NULL AND NULLIF\(evidence_data_url,''\) IS NOT NULL/);
  assert.match(source,/private_evidence_object_id IS NULL AND NULLIF\(data_url,''\) IS NOT NULL/);
  assert.match(source,/cv_private_evidence_object_id IS NULL AND NULLIF\(cv_private_data_url,''\) IS NOT NULL/);
  assert.match(source,/if\(Number\(error\?\.status\)===503\)throw error/);
  assert.match(source,/legacy_data_url_cleared_after_object_storage/);
});
