import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildOwnerControlTowerRuntime} from '../owner-control-tower-runtime.js';

test('Owner runtime composes canonical evidence without inventing a decision queue',async()=>{
  const result=await buildOwnerControlTowerRuntime({},{
    homeSummary:{support:{open:2,urgent:0,oldest_urgent_at:null}},
    runtimeHealthy:true,
    env:{APP_ENV:'production',RAILWAY_GIT_COMMIT_SHA:'abcdef1234567890'},
    dependencies:{
      publicDeploymentEvidence:()=>({environment:'production',revision:'abcdef123456'}),
      paymentExceptionSummary:async()=>({
        reconciliation_exceptions:0,failed_settlements:0,refund_exceptions:0,
        mismatch_amount:0,provider_state:'active',observed_at:'2026-09-29T22:00:00Z'
      }),
      financeKpiOverview:async()=>({
        platform_revenue:120,variable_costs:20,allocated_fixed_cost:40,contribution:100,operating_profit:60,
        promotion_economics:{direct_cost:{promotional:{total_direct_cost:5}}}
      }),
      severeSafetySummary:async()=>({severe:0,privacy_security:null,source:'trust_safety'}),
      territoryCapacitySummary:async()=>[{
        territory_id:6,name:'Queens Row West',status:'onboarding',psgc_code:'0402103028',
        active_merchants:2,eligible_couriers:0,active_local_services:1
      }],
      territoryDemandOverview:async()=>({items:[{psgc_code:'0402103028',profile_interest_accounts:4}]})
    }
  });
  assert.equal(result.model.health.production.state,'healthy');
  assert.equal(result.model.health.money.state,'healthy');
  assert.equal(result.model.health.support.state,'healthy');
  assert.equal(result.model.health.safety.state,'healthy');
  assert.equal(result.model.decision_status.state,'unknown');
  assert.equal(result.model.territories[0].health,'supply_constrained');
  assert.equal(result.model.finance.operating_result,60);
  assert.equal(result.evidence_status.owner_decisions,'unavailable');
});

test('Owner runtime keeps unavailable domains unknown instead of zero',async()=>{
  const unavailable=async()=>{throw new Error('unavailable')};
  const result=await buildOwnerControlTowerRuntime({},{
    homeSummary:{},
    runtimeHealthy:true,
    env:{APP_ENV:'production',RAILWAY_GIT_COMMIT_SHA:'abcdef1234567890'},
    dependencies:{
      publicDeploymentEvidence:()=>({environment:'production',revision:'abcdef123456'}),
      paymentExceptionSummary:unavailable,
      financeKpiOverview:unavailable,
      severeSafetySummary:unavailable,
      territoryCapacitySummary:unavailable,
      territoryDemandOverview:unavailable
    }
  });
  assert.equal(result.model.health.money.state,'unknown');
  assert.equal(result.model.health.support.state,'unknown');
  assert.equal(result.model.health.safety.state,'unknown');
  assert.equal(result.model.finance.platform_revenue,null);
});

test('Admin integration keeps Control Tower Owner-only and uses one bounded endpoint',()=>{
  const server=readFileSync(new URL('../server-admin-operations.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../public/admin-console.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../public/admin-console.html',import.meta.url),'utf8');
  assert.match(server,/\/api\/admin\/owner-control-tower/);
  assert.match(server,/ctx\.superAdmin/);
  assert.match(server,/Owner Control Tower requires Super Admin authority/);
  assert.match(server,/owner-control-tower\.js/);
  assert.match(server,/owner-control-tower\.css/);
  assert.match(ui,/\/api\/admin\/owner-control-tower/);
  assert.match(ui,/import\('\/owner-control-tower\.js'\)/);
  assert.match(ui,/isSuperAdmin/);
  assert.match(html,/owner-control-tower\.css/);
});
