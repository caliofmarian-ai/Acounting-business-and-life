import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ui=readFileSync(new URL('../public/profile-governance-ui.js',import.meta.url),'utf8');

test('submitted profile applications explain review timing next steps and evidence options',()=>{
  assert.match(ui,/pendingReview=\['submitted','under_review'\]\.includes\(a\.status\)/);
  assert.match(ui,/Application received/);
  assert.match(ui,/Application under review/);
  assert.match(ui,/Review in progress/);
  assert.match(ui,/Typical review time/);
  assert.match(ui,/1–3 business days/);
  assert.match(ui,/You can still add evidence/);
  assert.match(ui,/If Admin needs a correction/);
  assert.match(ui,/application will reopen for editing and resubmission/);
  assert.match(ui,/Your profile remains locked until a decision is made/);
});

test('approved application state no longer presents pending-review lock copy',()=>{
  assert.match(ui,/approved:\{title:'Application approved'/);
  assert.match(ui,/profile has been approved and can now be used/);
  assert.doesNotMatch(ui,/Your operational profile remains locked until the review is completed\./);
});
