import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const auth=read('server-auth.js');
const payments=read('server-payments.js');
const shell=read('public/shell.js');
const settings=read('public/profile-settings-ui.js');

test('database bootstrap never creates or restores an active Merchant profile',()=>{
  const seed=auth.slice(auth.indexOf("INSERT INTO accounts(id,display_name,active_role)"),auth.indexOf("SELECT setval(pg_get_serial_sequence('accounts'"));
  assert.match(seed,/VALUES\(1,'Business owner',NULL\)/);
  assert.match(seed,/VALUES\(1,'merchant',FALSE,'private','disabled'\)/);
  assert.match(seed,/ON CONFLICT\(account_id,role\) DO NOTHING/);
  assert.doesNotMatch(seed,/DO UPDATE SET enabled=TRUE/);
  assert.match(auth,/ALTER COLUMN enabled SET DEFAULT FALSE/);
  assert.match(auth,/ALTER COLUMN status SET DEFAULT 'not_started'/);
  assert.match(auth,/2026-09-19-remove-forced-owner-merchant/);
  assert.match(auth,/UPDATE profiles SET enabled=FALSE,visibility='private',status='disabled'/);
});

test('stale active role is cleared and cannot open a disabled workspace',()=>{
  assert.match(auth,/profile\.enabled===true&&profile\.status==='active'/);
  assert.match(auth,/UPDATE accounts SET active_role=NULL/);
  assert.match(auth,/enabled=TRUE AND status='active'/);
  assert.match(shell,/profile\?\.enabled&&profile\?\.status==='active'/);
  assert.match(payments,/p\.enabled&&p\.status==='active'/);
});

test('Profile Settings consumes canonical state identity without browser caching',()=>{
  assert.match(payments,/profile_id:p\.profile_id\|\|null/);
  assert.match(payments,/private, no-store, max-age=0/);
  assert.match(settings,/cache:'no-store'/);
  assert.match(settings,/settingsData=await sapi\('\/api\/settings\/finance'\)/);
});
