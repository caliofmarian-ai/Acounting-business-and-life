import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const agents=read('AGENTS.md');
const lifecycle=read('docs/operations/ISSUE_LIFECYCLE.md');
const workflow=read('.github/workflows/preview-production-parity.yml');

test('agent contract makes Preview temporary and requires production evidence',()=>{
  assert.match(agents,/Preview is a temporary validation surface, not a second release branch/);
  assert.match(agents,/Never claim Preview success as production success/);
  assert.match(agents,/reconcile the shared Preview pointer back to current `main`/);
  assert.match(agents,/intentional QA-only differences/);
});

test('lifecycle documents the exact Preview to production promotion invariant',()=>{
  assert.match(lifecycle,/exact PR head on Preview → acceptance PASS → merge reviewed head → exact main deployment on production → production smoke PASS → Preview pointer reconciled/);
  assert.match(lifecycle,/A Preview pass is evidence for the tested PR head only/);
  assert.match(lifecycle,/Intentional environment differences are not parity bugs/);
});

test('parity guard preserves active PR preview and repairs stale drift',()=>{
  assert.match(workflow,/previewBranch = 'delivery-routing-v2c'/);
  assert.match(workflow,/activePreviewPr = openPulls\.find\(\(pr\) => pr\.head\?\.sha === previewSha\)/);
  assert.match(workflow,/Intentional Preview divergence preserved for open PR/);
  assert.match(workflow,/github\.rest\.git\.updateRef/);
  assert.match(workflow,/sha: mainSha/);
  assert.match(workflow,/force: true/);
  assert.match(workflow,/context\.payload\.pull_request\?\.head\?\.sha !== previewSha/);
});
