const $=id=>document.getElementById(id);
let token=localStorage.getItem('abl_identity_token')||'';
let snapshot=null;
let activeRole=localStorage.getItem('abl_active_profile')||'merchant';
const roleInfo={
  merchant:{icon:'🏪',title:'Merchant',desc:'Accounting, inventory, products, orders and storefront.'},
  customer:{icon:'🛍️',title:'Customer',desc:'Marketplace, ordering, payments, pickup and delivery tracking.'},
  supplier:{icon:'🌾',title:'Supplier',desc:'Local producer catalog, incoming purchase orders and production ETA.'},
  courier:{icon:'🛵',title:'Courier',desc:'Delivery availability, assigned jobs, pickup and delivery status.'}
};
async function api(path,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(token)headers.Authorization=`Bearer ${token}`;const r=await fetch(path,{...options,headers});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||'Request failed');return body}
function enabled(role){return Boolean(snapshot?.profiles?.find(p=>p.role===role)?.enabled)}
function logout(){token='';localStorage.removeItem('abl_identity_token');$('app').classList.add('hidden');$('login').classList.remove('hidden')}
async function login(pin){const r=await api('/api/login',{method:'POST',body:JSON.stringify({pin})});token=r.token;localStorage.setItem('abl_identity_token',token);await openApp()}
async function openApp(){try{snapshot=await api('/api/me');$('login').classList.add('hidden');$('app').classList.remove('hidden');render()}catch{logout()}}
function render(){
  const a=snapshot.account;$('displayName').value=a.display_name||'';$('phone').value=a.phone||'';$('email').value=a.email||'';$('address').value=a.address||'';
  if(!enabled(activeRole))activeRole='merchant';localStorage.setItem('abl_active_profile',activeRole);$('activeBadge').textContent=`Active: ${roleInfo[activeRole].title}`;
  $('profiles').replaceChildren(...Object.keys(roleInfo).map(profileCard));
  if(enabled(activeRole))loadContext(activeRole);else $('contextCard').classList.add('hidden');
  const c=snapshot.courier;$('courierCard').classList.toggle('hidden',activeRole!=='courier'||!enabled('courier'));if(c){$('courierName').value=c.display_name||'';$('vehicleType').value=c.vehicle_type||'';$('courierAvailable').checked=Boolean(c.available);$('maxWeight').value=c.max_weight_kg??'';$('maxVolume').value=c.max_volume_l??'';$('serviceRadius').value=c.service_radius_km??''}
}
function profileCard(role){const info=roleInfo[role],on=enabled(role);const d=document.createElement('article');d.className=`profileCard ${activeRole===role?'active':''}`;d.innerHTML=`<div class="profileMeta"><div class="profileIcon">${info.icon}</div><span class="status ${on?'on':''}">${on?'Enabled':'Not enabled'}</span></div><div><h3>${info.title}</h3><p>${info.desc}</p></div><div class="profileActions"></div>`;const actions=d.querySelector('.profileActions');if(on){const sw=document.createElement('button');sw.className='profileAction';sw.textContent=activeRole===role?'Current profile':'Switch here';sw.disabled=activeRole===role;sw.onclick=()=>{activeRole=role;localStorage.setItem('abl_active_profile',role);render()};actions.append(sw)}if(role!=='merchant'){const t=document.createElement('button');t.className='profileAction alt';t.textContent=on?'Disable':'Enable profile';t.onclick=async()=>{snapshot=await api(`/api/profiles/${role}`,{method:'PUT',body:JSON.stringify({enabled:!on})});if(!on)activeRole=role;else if(activeRole===role)activeRole='merchant';localStorage.setItem('abl_active_profile',activeRole);render()};actions.append(t)}return d}
async function loadContext(role){try{const ctx=await api(`/api/context/${role}`);$('contextCard').classList.remove('hidden');$('contextTitle').textContent=`${roleInfo[role].title} workspace`;$('contextText').textContent=roleInfo[role].desc;$('capabilities').replaceChildren(...ctx.capabilities.map(x=>{const s=document.createElement('span');s.className='chip';s.textContent=x;return s}))}catch(e){$('contextCard').classList.add('hidden')}}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{await login($('pin').value)}catch(err){$('loginError').textContent=err.message}});
$('identityForm').addEventListener('submit',async e=>{e.preventDefault();$('saveStatus').textContent='Saving…';try{snapshot=await api('/api/me',{method:'PATCH',body:JSON.stringify({display_name:$('displayName').value,phone:$('phone').value,email:$('email').value,address:$('address').value})});$('saveStatus').textContent='Saved';render()}catch(err){$('saveStatus').textContent=err.message}});
$('courierForm').addEventListener('submit',async e=>{e.preventDefault();$('courierStatus').textContent='Saving…';try{snapshot=await api('/api/courier',{method:'PATCH',body:JSON.stringify({display_name:$('courierName').value,vehicle_type:$('vehicleType').value,available:$('courierAvailable').checked,max_weight_kg:$('maxWeight').value,max_volume_l:$('maxVolume').value,service_radius_km:$('serviceRadius').value})});$('courierStatus').textContent='Courier settings saved.';render()}catch(err){$('courierStatus').textContent=err.message}});
if(token)openApp();
