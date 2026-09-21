import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-paymongo.js',import.meta.url),'utf8');

test('public gateway emits non-breaking baseline security headers',()=>{
  assert.match(server,/X-Content-Type-Options','nosniff'/);
  assert.match(server,/Referrer-Policy','strict-origin-when-cross-origin'/);
});

test('CSP starts in report-only mode so current inline UI cannot be broken',()=>{
  assert.match(server,/Content-Security-Policy-Report-Only/);
  assert.doesNotMatch(server,/setHeader\('Content-Security-Policy',/);
  assert.match(server,/default-src 'self'/);
  assert.match(server,/frame-ancestors 'none'/);
  assert.match(server,/object-src 'none'/);
});
