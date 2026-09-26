import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const accounting=read('public/business-accounting-ui.js');
const production=read('public/v03.js');

test('business workspace selector switches context in-app without hard reload',()=>{
  assert.doesNotMatch(accounting,/location\.reload\(\)/);
  assert.match(accounting,/api\('\/api\/accounting\/active-workspace'/);
  assert.match(accounting,/api\('\/api\/accounting\/workspaces'\)/);
  assert.match(accounting,/accountingState=\{role:state\.role,activeBusinessId:Number\(state\.active_business_id\),businesses:state\.businesses\|\|\[\]\}/);
  assert.match(accounting,/abl:business-workspace-changed/);
});

test('workspace switch refreshes only the visible role surface without rebuilding the app',()=>{
  assert.match(accounting,/mountWorkspaceBar\(\)/);
  assert.match(accounting,/wireSupplierAccountingTile\(\)/);
  assert.match(accounting,/supplierAccountingMode/);
  assert.match(accounting,/mountEconomicSummary\('viewDashboard'\)/);
  assert.match(production,/abl:business-workspace-changed/);
  assert.match(production,/invalidateMerchantToday\(\)/);
  assert.match(production,/loadMerchantToday\(\{force:true\}\)/);
  assert.doesNotMatch(production,/refreshAll\(/);
});

test('accounting workspace requires canonical Profile surface and never refetches identity',()=>{
  assert.match(accounting,/state\?\.surface===['"]profile['"]\?state\.activeRole:null/);
  assert.match(accounting,/\['merchant','supplier'\]\.includes\(role\)/);
  assert.doesNotMatch(accounting,/api\(['"]\/api\/me['"]\)/);
});

test('failed workspace switch restores context and reports non-blocking feedback',()=>{
  assert.match(accounting,/const previous=accountingState\.activeBusinessId/);
  assert.match(accounting,/accountingState\.activeBusinessId=previous/);
  assert.match(accounting,/function showWorkspaceSwitchError/);
  assert.match(accounting,/feedback\.setAttribute\('role','alert'\)/);
  assert.match(accounting,/showWorkspaceSwitchError\(err\?\.message\)/);
  assert.match(accounting,/clearWorkspaceSwitchError\(\);\s*const previous=/);
  assert.doesNotMatch(accounting,/\balert\s*\(/);
});
