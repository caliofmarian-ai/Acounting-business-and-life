const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const sourceLabel=source=>({
  deployment_evidence:'Deployment evidence',payment_core:'Payment Core',support:'Support',
  trust_safety:'Trust & Safety',territory_governance:'Territory governance',
  finance_kpi:'Finance KPI',quality_evidence:'Quality evidence',
  repository_release_evidence:'Production release evidence'
})[String(source||'')]||String(source||'Evidence');
const observedLabel=value=>{
  const d=value?new Date(value):null;
  return d&&!Number.isNaN(d.getTime())?d.toLocaleString('en-IE',{dateStyle:'short',timeStyle:'short'}):'time unavailable';
};
const stateLabel=state=>({
  healthy:'Healthy',attention:'Attention',critical:'Critical',unknown:'Unknown',
  supply_constrained:'Supply constrained',support_constrained:'Support constrained',
  payments_blocked:'Payments blocked',compliance_blocked:'Readiness blocked',paused:'Paused'
})[state]||String(state||'Unknown').replaceAll('_',' ');

function money(value,currency='PHP'){
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return'—';
  return new Intl.NumberFormat('en-PH',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value));
}

function healthCard(label,item,value,observedAt){
  const state=item?.state||'unknown';
  return `<article class="ownerHealthCard ownerState-${esc(state)}">
    <div class="ownerCardHead"><span>${esc(label)}</span><b>${esc(stateLabel(state))}</b></div>
    <strong>${esc(value||item?.reason||'Evidence unavailable')}</strong>
    <small>${esc(item?.reason||'Evidence unavailable')}</small>
    <small class="ownerEvidenceMeta">${esc(sourceLabel(item?.source))} · ${esc(observedLabel(item?.updated_at||observedAt))}</small>
  </article>`;
}

function decisionCard(item){
  return `<article class="ownerDecisionCard ownerDecision-${esc(item.severity||'normal')}">
    <span class="ownerDecisionEyebrow">${esc(String(item.severity||'normal').toUpperCase())} · ${esc(item.decision_code)}</span>
    <h3>${esc(item.title)}</h3>
    <p>${esc(item.summary)}</p>
    ${item.impact?`<small>Impact: ${esc(item.impact)}</small>`:''}
    <button type="button" data-owner-decision-source="${esc(item.source_domain)}" data-owner-decision-id="${esc(item.source_id)}">Open evidence</button>
  </article>`;
}

function territoryCard(t){
  return `<article class="ownerTerritoryCard">
    <div class="ownerCardHead"><strong>${esc(t.name)}</strong><b>${esc(String(t.status||'unknown').toUpperCase())}</b></div>
    <p>${esc(stateLabel(t.health))}</p>
    <div class="ownerTerritoryFacts">
      <span><b>${t.active_merchants??'—'}</b>Merchants</span>
      <span><b>${t.eligible_couriers??'—'}</b>Couriers</span>
      <span><b>${t.active_local_services??'—'}</b>Services</span>
      <span><b>${t.demand_accounts??'—'}</b>Demand</span>
    </div>
  </article>`;
}

function metric(label,value,detail){
  return `<article class="ownerMetricCard"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`;
}

export function renderOwnerControlTower(model,headline){
  const h=headline||{state:'unknown',title:'Platform health unavailable',detail:'Evidence could not be confirmed.'};
  const production=model?.health?.production||{};
  const moneyHealth=model?.health?.money||{};
  const support=model?.health?.support||{};
  const safety=model?.health?.safety||{};
  const decisions=Array.isArray(model?.owner_decisions)?model.owner_decisions:[];
  const territories=Array.isArray(model?.territories)?model.territories:[];
  const finance=model?.finance||{};
  const quality=model?.product_quality||{};
  const release=model?.release_evidence||{};
  const productionValue=production.production_revision
    ?(production.state==='attention'&&production.intended_revision&&production.production_revision!==production.intended_revision?'Behind intended release':'Revision '+production.production_revision)
    :null;
  const moneyValue=moneyHealth.state==='healthy'?'Reconciled':moneyHealth.state==='attention'?'Needs review':null;
  const supportValue=support.urgent===0?'No urgent tickets':support.urgent==null?null:`${support.urgent} urgent`;
  const safetyValue=safety.severe===0&&safety.privacy_security===0?'No severe incidents':null;
  const decisionBody=model?.decision_status?.state==='unknown'
    ?'<div class="ownerUnknown">Decision status unavailable. Do not assume a healthy state.</div>'
    :decisions.length
      ?decisions.map(decisionCard).join('')
      :'<div class="ownerHealthyEmpty"><strong>No Owner decisions waiting</strong><span>Routine Admin work stays delegated.</span></div>';

  return `<section class="ownerControlTower" data-owner-control-tower data-state="${esc(h.state)}">
    <header class="ownerTowerHeader">
      <div><small>BUSINESS &amp; LIFE · OWNER</small><h2>Owner Control Tower</h2></div>
      <button type="button" class="ownerRefreshButton" data-owner-control-refresh>Refresh</button>
    </header>
    <section class="ownerTowerHero ownerHero-${esc(h.state)}">
      <small>PLATFORM HEALTH</small>
      <h1>${esc(h.title)}</h1>
      <p>${esc(h.detail)}</p>
    </section>

    <h3 class="ownerSectionTitle">Platform health</h3>
    <div class="ownerHealthGrid">
      ${healthCard('Production',production,productionValue,model?.generated_at)}
      ${healthCard('Money',moneyHealth,moneyValue,model?.generated_at)}
      ${healthCard('Support',support,supportValue,model?.generated_at)}
      ${healthCard('Trust & Safety',safety,safetyValue,model?.generated_at)}
    </div>

    <h3 class="ownerSectionTitle">Needs your decision</h3>
    <div class="ownerDecisionList">${decisionBody}</div>

    <h3 class="ownerSectionTitle">Territories</h3>
    <div class="ownerTerritoryList">${territories.length?territories.map(territoryCard).join(''):'<div class="ownerUnknown">No territory evidence available.</div>'}</div>

    <h3 class="ownerSectionTitle">This month</h3>
    <div class="ownerMetricGrid">
      ${metric('Platform revenue',money(finance.platform_revenue,finance.currency),'Evidence-based platform revenue')}
      ${metric('Direct cost',money(finance.variable_cost,finance.currency),'Actual / accrued evidence where available')}
      ${metric('Promo subsidy',money(finance.promo_subsidy,finance.currency),'Cost during promotional periods')}
      ${metric('Operating result',money(finance.operating_result,finance.currency),'Revenue minus verified costs')}
    </div>

    <h3 class="ownerSectionTitle">Release evidence</h3>
    <article class="ownerQualityCard" id="ownerReleaseEvidence">
      <div class="ownerCardHead"><strong>${esc(release.status==='hold'?'Launch hold':release.status==='ready'?'Release ready':'Release review')}</strong><b>${esc(release.runtime_revision?'Revision '+release.runtime_revision:'Revision unavailable')}</b></div>
      <p>${esc(release.summary||'Release evidence summary unavailable.')}</p>
      <small>${release.source_issue?'Source issue #'+esc(release.source_issue):'Source issue unavailable'} · ${esc(observedLabel(release.observed_at))}</small>
    </article>

    <h3 class="ownerSectionTitle">Product quality</h3>
    <article class="ownerQualityCard">
      <strong>P0 ${quality.open_p0??'—'} · P1 ${quality.open_p1??'—'} · Production regressions ${quality.production_regressions??'—'}</strong>
      <p>${quality.parity_issues==null?esc(release.unavailable_reasons?.parity_issues||'Parity evidence unavailable.'):('Parity issues '+esc(quality.parity_issues))}</p>
      <small>Failed acceptance waves ${quality.failed_acceptance_waves??'—'}${quality.last_functional_qa_at?' · QA '+esc(observedLabel(quality.last_functional_qa_at)):''}</small>
    </article>
  </section>`;
}

export function mountOwnerControlTower(root,model,headline){
  if(!root)throw new Error('Owner Control Tower root is required');
  root.innerHTML=renderOwnerControlTower(model,headline);
  return root.querySelector('[data-owner-control-tower]');
}

if(typeof window!=='undefined')window.BusinessLifeOwnerControlTower={renderOwnerControlTower,mountOwnerControlTower};
