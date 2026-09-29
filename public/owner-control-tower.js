const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const stateLabel=state=>({
  healthy:'Healthy',attention:'Attention',critical:'Critical',unknown:'Unknown',
  supply_constrained:'Supply constrained',support_constrained:'Support constrained',
  payments_blocked:'Payments blocked',compliance_blocked:'Readiness blocked',paused:'Paused'
})[state]||String(state||'Unknown').replaceAll('_',' ');

function money(value,currency='PHP'){
  if(value===null||value===undefined||!Number.isFinite(Number(value)))return'—';
  return new Intl.NumberFormat('en-PH',{style:'currency',currency,maximumFractionDigits:2}).format(Number(value));
}

function healthCard(label,item,value){
  const state=item?.state||'unknown';
  return `<article class="ownerHealthCard ownerState-${esc(state)}">
    <div class="ownerCardHead"><span>${esc(label)}</span><b>${esc(stateLabel(state))}</b></div>
    <strong>${esc(value||item?.reason||'Evidence unavailable')}</strong>
    <small>${esc(item?.reason||'Evidence unavailable')}</small>
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
      <small>BUSINESS &amp; LIFE · OWNER</small>
      <h2>Owner Control Tower</h2>
    </header>
    <section class="ownerTowerHero ownerHero-${esc(h.state)}">
      <small>PLATFORM HEALTH</small>
      <h1>${esc(h.title)}</h1>
      <p>${esc(h.detail)}</p>
    </section>

    <h3 class="ownerSectionTitle">Platform health</h3>
    <div class="ownerHealthGrid">
      ${healthCard('Production',production,productionValue)}
      ${healthCard('Money',moneyHealth,moneyValue)}
      ${healthCard('Support',support,supportValue)}
      ${healthCard('Trust & Safety',safety,safetyValue)}
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

    <h3 class="ownerSectionTitle">Product quality</h3>
    <article class="ownerQualityCard">
      <strong>P0 ${quality.open_p0??'—'} · P1 ${quality.open_p1??'—'} · parity ${quality.parity_issues??'—'}</strong>
      <p>Only actionable exceptions belong here. Engineering detail stays in the canonical issue/release evidence.</p>
    </article>
  </section>`;
}

export function mountOwnerControlTower(root,model,headline){
  if(!root)throw new Error('Owner Control Tower root is required');
  root.innerHTML=renderOwnerControlTower(model,headline);
  return root.querySelector('[data-owner-control-tower]');
}

if(typeof window!=='undefined')window.BusinessLifeOwnerControlTower={renderOwnerControlTower,mountOwnerControlTower};
