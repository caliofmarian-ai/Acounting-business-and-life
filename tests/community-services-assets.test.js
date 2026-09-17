import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const m=JSON.parse(readFileSync(new URL('../marketing-kit/community-services-manifest.json',import.meta.url),'utf8'));

test('community Local Services visual kit has product reference and three editable marketing masters',()=>{
  assert.match(m.figma.productReference.nodeId,/^\d+:\d+$/);
  assert.equal(m.assets.length,3);
  for(const asset of m.assets){
    assert.match(asset.figmaNodeId,/^\d+:\d+$/);
    assert.equal(asset.canvaStatus,'editable_master_ready');
    assert.ok(asset.canvaTitle.startsWith('Business & Life — Local Services'));
  }
});

test('community visual claims do not guarantee work or income',()=>{
  assert.equal(m.claims.guaranteedJobs,false);
  assert.equal(m.claims.guaranteedIncome,false);
  assert.equal(m.claims.credentialGatesRemainAuthoritative,true);
  assert.equal(m.privacy.publicRepoStoresPrivateCanvaEditUrls,false);
});
