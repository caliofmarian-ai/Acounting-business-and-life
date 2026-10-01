import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/profile-governance-ui.js',import.meta.url),'utf8');

test('submitted profile applications explain review timing and next steps',()=>{
  assert.match(ui,/pendingReview=\['submitted','under_review'\]\.includes\(a\.status\)/);
  assert.match(ui,/Application submitted/);
  assert.match(ui,/waiting for Admin review/);
  assert.match(ui,/What happens next/);
  assert.match(ui,/Typical review time/);
  assert.match(ui,/1–3 business days/);
  assert.match(ui,/The decision will show the reason/);
  assert.match(ui,/correct the application and submit it again/);
  assert.match(ui,/profile unlocks/);
  assert.match(ui,/Your profile remains locked while the review is pending/);
});

test('approved application state no longer presents pending-review lock copy',()=>{
  assert.match(ui,/a\.status==='approved'\?'Application approved'/);
  assert.match(ui,/profile has been approved/);
  assert.doesNotMatch(ui,/Your operational profile remains locked until the review is completed\./);
});
