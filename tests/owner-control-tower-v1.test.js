import test from'node:test';
import assert from'node:assert/strict';
import {readFileSync} from'node:fs';
import {buildOwnerControlTower,ownerControlTowerHeadline,ownerDecisionQueue} from'../owner-control-tower-core.js';
import {renderOwnerControlTower} from'../public/owner-control-tower.js';

test('Production parity is healthy only with explicit matching healthy evidence',()=>{
  const healthy=buildOwnerControlTower({
    production:{intended_revision:'abcdef1234567890',production_revision:'abcdef1234567890',healthy:true},
    money:{reconciliation_exceptions:0,failed_settlements:0,refund_exceptions:0,mismatch_amount:0},
    support:{open:0,urgent:0},
    safety:{severe:0,privacy_security:0},
    owner_decisions:[]
  });
  assert.equal(healthy.health.production.state,'healthy');
  assert.equal(healthy.health.money.state,'healthy');
  assert.equal(ownerControlTowerHeadline(healthy).state,'healthy');

  const behind=buildOwnerControlTower({
    production:{intended_revision:'aaaaaaaaaaaa1111',production_revision:'bbbbbbbbbbbb2222',healthy:true},
    owner_decisions:[]
  });
  assert.equal(behind.health.production.state,'attention');
  assert.match(behind.health.production.reason,/does not match/i);
});

test('Unknown evidence never becomes a fake healthy zero',()=>{
  const model=buildOwnerControlTower({owner_decisions:[]});
  assert.equal(model.health.production.state,'unknown');
  assert.equal(model.health.money.state,'unknown');
  assert.equal(model.health.support.urgent,null);
  assert.equal(model.health.safety.severe,null);
  assert.equal(model.finance.platform_revenue,null);
  const html=renderOwnerControlTower(model,ownerControlTowerHeadline(model));
  assert.match(html,/Platform health is partially unavailable|Business & Life needs review/);
  assert.match(html,/Platform revenue[\s\S]*—/);
});

test('Decision status is unknown when the canonical decision source was not supplied',()=>{
  const model=buildOwnerControlTower({});
  assert.equal(model.decision_status.state,'unknown');
  assert.equal(model.decision_status.open_count,null);
  assert.equal(ownerControlTowerHeadline(model).title,'Owner decision status unavailable');
  assert.match(renderOwnerControlTower(model,ownerControlTowerHeadline(model)),/Decision status unavailable/);
});

test('Owner queue includes only unresolved protected authority and deduplicates source facts',()=>{
  const rows=[
    {decision_code:'RELEASE_PARITY_DECISION',source_domain:'release',source_type:'deployment',source_id:'prod',required_authority:'project_owner',severity:'high',state:'open',title:'Production behind main',created_at:'2026-09-29T10:00:00Z'},
    {decision_code:'RELEASE_PARITY_DECISION',source_domain:'release',source_type:'deployment',source_id:'prod',required_authority:'project_owner',severity:'high',state:'open',title:'Production still behind',created_at:'2026-09-29T11:00:00Z'},
    {decision_code:'ROUTINE_SUPPORT',source_domain:'support',source_type:'ticket',source_id:'12',required_authority:'territory_admin',severity:'normal',state:'open'},
    {decision_code:'OLD_DECISION',source_domain:'finance',source_type:'payment',source_id:'7',required_authority:'project_owner',severity:'critical',state:'resolved'}
  ];
  const queue=ownerDecisionQueue(rows);
  assert.equal(queue.length,1);
  assert.equal(queue[0].title,'Production still behind');
  assert.equal(queue[0].required_authority,'project_owner');
});

test('Owner headline prioritizes protected decisions over general health',()=>{
  const model=buildOwnerControlTower({
    production:{healthy:true,intended_revision:'abc',production_revision:'abc'},
    support:{open:0,urgent:0},
    safety:{severe:0,privacy_security:0},
    money:{reconciliation_exceptions:0,failed_settlements:0,refund_exceptions:0,mismatch_amount:0},
    owner_decisions:[{
      decision_code:'PAYMENT_PROVIDER_LIVE_DECISION',source_domain:'payments',source_type:'provider_gate',source_id:'paymongo',
      required_authority:'project_owner',severity:'attention',state:'open',title:'Provider activation'
    }]
  });
  assert.equal(ownerControlTowerHeadline(model).state,'attention');
  assert.match(ownerControlTowerHeadline(model).title,/1 item needs Owner attention/);
});

test('Territory summary is whitelisted and cannot leak address or live coordinates',()=>{
  const model=buildOwnerControlTower({
    owner_decisions:[],
    territories:[{
      territory_id:6,name:'Queens Row West',status:'onboarding',health:'healthy',
      active_merchants:2,eligible_couriers:1,active_local_services:3,demand_accounts:8,
      email:'private@example.com',address:'Private Street',last_lat:14.1,last_lng:120.9
    }]
  });
  const territory=model.territories[0];
  assert.equal(territory.name,'Queens Row West');
  assert.equal('email' in territory,false);
  assert.equal('address' in territory,false);
  assert.equal('last_lat' in territory,false);
  assert.equal('last_lng' in territory,false);
});

test('Renderer exposes evidence deep links without embedding sensitive source data',()=>{
  const model=buildOwnerControlTower({
    owner_decisions:[{
      decision_code:'MATERIAL_PAYMENT_RECONCILIATION_DECISION',source_domain:'payments',source_type:'reconciliation',source_id:'run-7',
      required_authority:'super_admin',severity:'critical',state:'open',title:'Payment evidence does not reconcile',
      summary:'Open provider and internal evidence.'
    }]
  });
  const html=renderOwnerControlTower(model,ownerControlTowerHeadline(model));
  assert.match(html,/data-owner-decision-source="payments"/);
  assert.match(html,/data-owner-decision-id="run-7"/);
  assert.doesNotMatch(html,/password|secret_key|last_lat|last_lng/i);
});

test('Mobile CSS keeps bounded grids and no forced horizontal layout',()=>{
  const css=readFileSync(new URL('../public/owner-control-tower.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:430px\)/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:340px\).*grid-template-columns:1fr/s);
  assert.doesNotMatch(css,/min-width:\s*(?:4\d\d|[5-9]\d\d)px/);
});
