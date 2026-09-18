import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('production entry point is the provider-neutral Payment Core over Legal & Consent', () => {
  assert.equal(pkg.version, '0.13.0');
  assert.match(pkg.scripts.start, /--import \.\/bootstrap-env\.js/);
  assert.match(pkg.scripts.start, /server-legal\.js/);
});

test('all executable domain gateways required by the current platform exist', () => {
  const required = [
    'server-v03.js',
    'server-auth.js',
    'server-orders.js',
    'server-marketplace.js',
    'server-services.js',
    'server-suppliers.js',
    'server-delivery.js',
    'server-delivery-finance.js',
    'server-incidents.js',
    'server-auth-hardening.js',
    'server-profile-governance.js',
    'server-business-accounting.js',
    'server-admin-operations.js',
    'server-notifications.js',
    'server-legal.js',
    'server-payments.js'
  ];
  for (const file of required) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `${file} must exist`);
});

test('syntax check covers the public production gateway chain', () => {
  for (const file of ['server-payments.js','server-legal.js','server-notifications.js','server-admin-operations.js','server-business-accounting.js','server-profile-governance.js','server-auth-hardening.js','server-incidents.js','server-delivery-finance.js','server-delivery.js','server-suppliers.js','server-services.js','server-marketplace.js','server-orders.js','server-auth.js','server-v03.js']) {
    assert.ok(pkg.scripts.check.includes(file), `${file} is missing from npm run check`);
  }
});

test('database bootstrap upgrades legacy ambiguous SSL modes to verify-full', () => {
  const probe = spawnSync(process.execPath, ['--import', './bootstrap-env.js', '-e', 'process.stdout.write(process.env.DATABASE_URL || "")'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgres://user:pass@example.com/db?sslmode=require' }
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.match(probe.stdout, /sslmode=verify-full/);
});

test('current-state document identifies the pilot roadmap and payment-core sequence', () => {
  const state = read('docs/CURRENT_STATE.md');
  assert.match(state, /Issue #37/);
  assert.match(state, /multi-business/i);
  assert.match(state, /Admin RBAC|scoped Admin/i);
  assert.match(state, /notification/i);
  assert.match(state, /legal|consent/i);
  assert.match(state, /payment|reconciliation|settlement/i);
});
