const token=function(){return localStorage.getItem("abl_token")||"";};
const rawFetch=window.fetch.bind(window);
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
async function api(path,options){
  options=options||{};
  var headers=Object.assign({"Content-Type":"application/json"},options.headers||{});
  if(token())headers.Authorization="Bearer "+token();
  var r=await rawFetch(path,Object.assign({},options,{headers:headers}));
  var data={};try{data=await r.json();}catch(_e){}
  if(!r.ok){var err=new Error(data.error||("Request failed ("+r.status+")"));err.status=r.status;err.data=data;throw err;}
  return data;
}
var ctx={me:null,admin:null,gates:[]};
window.fetch=async function(){
  var args=Array.prototype.slice.call(arguments);
  var r=await rawFetch.apply(window,args);
  try{
    var url=typeof args[0]==="string"?args[0]:(args[0]&&args[0].url)||"";
    if(r.status===428&&url.indexOf("/api/legal/")<0){
      var data=await r.clone().json();
      if(data&&data.code==="LEGAL_ACCEPTANCE_REQUIRED"&&data.legal_gate)setTimeout(function(){openGate(data.legal_gate);},0);
    }
  }catch(_e){}
  return r;
};
function toast(msg){
  var n=document.getElementById("legalToast");
  if(!n){n=document.createElement("div");n.id="legalToast";n.className="legalToast";document.body.appendChild(n);}
  n.textContent=msg;n.classList.add("show");setTimeout(function(){n.classList.remove("show");},2800);
}
function ensureUi(){
  if(!document.getElementById("legalBackdrop")){
    var w=document.createElement("div");w.id="legalBackdrop";w.className="legalBackdrop hidden";
    w.innerHTML='<section class="legalSheet" role="dialog" aria-modal="true"><header><div><small>Business &amp; Life • Philippines</small><h2 id="legalTitle">Legal &amp; Privacy</h2></div><button class="legalClose" type="button">×</button></header><div id="legalBody"></div></section>';
    document.body.appendChild(w);
    w.querySelector(".legalClose").onclick=closeLegal;
    w.addEventListener("click",function(e){if(e.target===w)closeLegal();});
  }
  addButton();
}
function addButton(){
  var top=document.querySelector(".topActions");
  if(!top||!token())return;
  if(document.getElementById("legalCenterBtn"))return;
  var b=document.createElement("button");b.id="legalCenterBtn";b.className="legalCenterBtn";b.type="button";b.textContent="Legal";b.onclick=openCenter;top.prepend(b);
}
function openSheet(title){ensureUi();document.getElementById("legalTitle").textContent=title;document.getElementById("legalBackdrop").classList.remove("hidden");document.body.style.overflow="hidden";}
function closeLegal(){var x=document.getElementById("legalBackdrop");if(x)x.classList.add("hidden");document.body.style.overflow="";}
function md(v){
  return String(v||"").split("\n").map(function(line){
    if(/^###\s+/.test(line))return "<h4>"+esc(line.replace(/^###\s+/,""))+"</h4>";
    if(/^##\s+/.test(line))return "<h3>"+esc(line.replace(/^##\s+/,""))+"</h3>";
    if(/^#\s+/.test(line))return "<h2>"+esc(line.replace(/^#\s+/,""))+"</h2>";
    if(/^>\s?/.test(line))return "<blockquote>"+esc(line.replace(/^>\s?/,""))+"</blockquote>";
    if(/^[-*]\s+/.test(line))return '<div class="legalBullet">• '+esc(line.replace(/^[-*]\s+/,""))+"</div>";
    if(!line.trim())return "<br>";
    return "<p>"+esc(line)+"</p>";
  }).join("");
}
async function loadCtx(){
  if(!ctx.me)ctx.me=await api("/api/me");
  if(!ctx.admin){try{ctx.admin=await api("/api/admin/me");}catch(_e){ctx.admin={is_admin:false,permissions:[],assignments:[]};}}
}
function actions(role,isAdmin){
  var a=[];
  if(role==="customer")a.push(["order.create","customer","Orders & Marketplace"],["location.share","customer","Delivery location"]);
  if(role==="merchant")a.push(["profile.submit","merchant","Merchant agreement"],["platform_fee.accept","merchant","Commercial / fee terms"]);
  if(role==="supplier")a.push(["profile.submit","supplier","Supplier agreement"],["platform_fee.accept","supplier","Commercial / fee terms"]);
  if(role==="courier")a.push(["profile.submit","courier","Courier agreement"],["location.share","courier","Courier live location"]);
  if(role==="service_provider")a.push(["profile.submit","service_provider","Service Provider agreement"]);
  a.push(["marketing.opt_in",role||"*","Marketing consent"]);
  if(isAdmin)a.push(["admin.access","admin","Admin confidentiality"]);
  return a;
}
async function openCenter(){
  openSheet("Legal & Privacy Center");
  var body=document.getElementById("legalBody");body.innerHTML='<div class="legalLoading">Loading…</div>';
  try{
    await loadCtx();
    var navigation=window.BusinessLifeProfileState||{};
    var role=navigation.surface==="profile"?(navigation.activeRole||""):"";
    var list=actions(role,!!ctx.admin.is_admin);ctx.gates=[];
    for(var i=0;i<list.length;i++){
      try{
        var g=await api("/api/legal/status?action="+encodeURIComponent(list[i][0])+"&role="+encodeURIComponent(list[i][1]));
        g.label=list[i][2];ctx.gates.push(g);
      }catch(_e){}
    }
    var history=await api("/api/legal/history");
    var adminAllowed=(ctx.admin.permissions||[]).indexOf("legal.view")>=0||(ctx.admin.assignments||[]).some(function(x){return x.admin_role==="super_admin";});
    body.innerHTML='<div class="legalTabs"><button class="active" data-ltab="required">My documents</button><button data-ltab="history">History</button>'+(adminAllowed?'<button data-ltab="admin">Legal Admin</button>':'')+'</div><section id="legalRequired"></section><section id="legalHistory" class="hidden"></section><section id="legalAdmin" class="hidden"></section>';
    Array.prototype.forEach.call(document.querySelectorAll("[data-ltab]"),function(b){b.onclick=function(){switchTab(b.dataset.ltab,b);};});
    renderRequired();renderHistory(history);if(adminAllowed)await renderAdmin();
  }catch(e){body.innerHTML='<div class="legalEmpty">'+esc(e.message)+"</div>";}
}
function switchTab(tab,btn){
  Array.prototype.forEach.call(document.querySelectorAll("[data-ltab]"),function(x){x.classList.toggle("active",x===btn);});
  ["required","history","admin"].forEach(function(name){var el=document.getElementById("legal"+name.charAt(0).toUpperCase()+name.slice(1));if(el)el.classList.toggle("hidden",tab!==name);});
}
function renderRequired(){
  var box=document.getElementById("legalRequired"),active=[],pending=[];
  ctx.gates.forEach(function(g){
    (g.requirements||[]).forEach(function(x){active.push(Object.assign({},x,{gate:g,label:g.label}));});
    (g.review_pending||[]).forEach(function(x){pending.push(Object.assign({},x,{label:g.label}));});
  });
  var map=new Map();active.forEach(function(x){map.set(x.version_id+":"+x.gate.action_code+":"+x.gate.role,x);});active=Array.from(map.values());
  var pm=new Map();pending.forEach(function(x){pm.set(x.document_code,x);});pending=Array.from(pm.values());
  var html='<div class="legalNotice"><strong>Exact-version acceptance</strong><span>The app records the version and SHA-256 hash you accepted. Drafts awaiting legal review do not count as acceptance.</span></div>';
  if(!active.length)html+='<div class="legalEmpty">No legally reviewed document currently requires your acceptance.</div>';
  active.forEach(function(x){
    html+='<article class="legalCard '+(x.accepted?"accepted":"required")+'"><div><small>'+esc(x.label)+" • "+esc(x.locale)+'</small><h3>'+esc(x.title)+'</h3><p>Version '+esc(x.version_label)+" • <code>"+esc(String(x.content_sha256||"").slice(0,12))+'…</code></p></div><span class="legalState">'+(x.accepted?"Accepted":"Required")+'</span><button data-version="'+x.version_id+'" data-action="'+esc(x.gate.action_code)+'" data-role="'+esc(x.gate.role)+'" type="button">'+(x.accepted?"View":"Read & accept")+"</button></article>";
  });
  if(pending.length){
    html+='<div class="legalReviewPending"><strong>Documents under legal review</strong><p>These controlled drafts exist but are not active legal terms and do not block you.</p>';
    pending.forEach(function(x){html+="<span>"+esc(x.title)+" • review pending</span>";});html+="</div>";
  }
  box.innerHTML=html;
  Array.prototype.forEach.call(box.querySelectorAll("[data-version]"),function(b){b.onclick=function(){viewDoc(Number(b.dataset.version),b.dataset.action,b.dataset.role);};});
}
async function viewDoc(versionId,action,role){
  var gate=ctx.gates.find(function(g){return g.action_code===action&&g.role===role;});
  var req=gate&&(gate.requirements||[]).find(function(x){return Number(x.version_id)===versionId;});if(!req)return;
  var doc=await api("/api/legal/documents/"+encodeURIComponent(req.document_code)+"/current");
  openSheet(req.title);
  var body=document.getElementById("legalBody");
  body.innerHTML='<div class="legalDocumentMeta"><span>Version '+esc(doc.version_label)+'</span><span>'+esc(doc.locale)+'</span><span>SHA-256 '+esc(doc.content_sha256)+'</span>'+(doc.fallback_locale?'<strong>Authoritative fallback language</strong>':'')+'</div><div class="legalDocumentText">'+md(doc.content_markdown)+"</div>"+(req.accepted?'<div class="legalAcceptedBanner">Already accepted for this action.</div>':'<label class="legalConfirm"><input id="legalConfirmBox" type="checkbox"> I have read this exact version and accept it for <strong>'+esc(gate.label)+'</strong>.</label><button id="legalAcceptBtn" class="legalPrimary" type="button">Accept this version</button>')+'<button id="legalBackBtn" class="legalSecondary" type="button">Back to Legal Center</button>';
  var accept=document.getElementById("legalAcceptBtn");
  if(accept)accept.onclick=async function(){
    if(!document.getElementById("legalConfirmBox").checked)return toast("Confirm that you read this version.");
    try{
      await api("/api/legal/accept",{method:"POST",body:JSON.stringify({version_id:req.version_id,content_sha256:req.content_sha256,action_code:gate.action_code,role_context:gate.role,territory_id:gate.territory_id||null,business_id:gate.business_id||null,admin_assignment_id:gate.admin_assignment_id||null,purpose:gate.label})});
      toast("Acceptance recorded with version and hash.");await openCenter();
    }catch(e){toast(e.message);}
  };
  document.getElementById("legalBackBtn").onclick=openCenter;
}
function renderHistory(rows){
  var box=document.getElementById("legalHistory");
  if(!rows.length){box.innerHTML='<div class="legalEmpty">No legal acceptance history yet.</div>';return;}
  box.innerHTML=rows.map(function(x){return '<article class="legalHistoryRow"><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.version_label)+" • "+esc(x.locale)+" • "+esc(x.action_code||"general")+'</small></div><span>'+esc(x.state)+'</span><time>'+new Date(x.created_at).toLocaleString()+"</time></article>";}).join("");
}
async function renderAdmin(){
  var box=document.getElementById("legalAdmin");if(!box)return;box.innerHTML='<div class="legalLoading">Loading controlled documents…</div>';
  try{
    var data=await api("/api/legal/admin/overview");
    var canManage=(ctx.admin.permissions||[]).indexOf("legal.manage")>=0||(ctx.admin.assignments||[]).some(function(x){return x.admin_role==="super_admin";});
    var html='<div class="legalAdminWarning"><strong>Controlled legal-document governance</strong><p>Repository agreements are imported as drafts. Do not record “legally reviewed” unless a real legal review occurred and you have a review reference.</p></div><div class="legalAdminList">';
    data.documents.forEach(function(d){
      html+='<article class="legalAdminDoc"><header><div><small>'+esc(d.document_class)+'</small><h3>'+esc(d.title)+'</h3><code>'+esc(d.code)+'</code></div><span>'+((d.versions||[]).length)+' versions</span></header>';
      (d.versions||[]).forEach(function(v){html+='<button data-admin-version="'+v.id+'" type="button"><span><strong>'+esc(v.version_label)+'</strong><small>'+esc(v.locale)+" • "+esc(v.status)+" • legal: "+esc(v.legal_review_status)+'</small></span><b>'+(v.status==="active"?"ACTIVE":String(v.status||"").toUpperCase())+"</b></button>";});
      if(!(d.versions||[]).length)html+="<p>No content version yet.</p>";html+="</article>";
    });html+="</div>";box.innerHTML=html;
    Array.prototype.forEach.call(box.querySelectorAll("[data-admin-version]"),function(b){b.onclick=function(){openAdminVersion(Number(b.dataset.adminVersion),canManage);};});
  }catch(e){box.innerHTML='<div class="legalEmpty">'+esc(e.message)+"</div>";}
}
async function openAdminVersion(id,canManage){
  var v=await api("/api/legal/admin/versions/"+id+"/content");openSheet("Controlled legal version");
  var canReview=canManage&&v.legal_review_status!=="reviewed";
  var canActivate=canManage&&v.legal_review_status==="reviewed"&&(v.authoritative||v.translation_review_status==="reviewed")&&v.status!=="active";
  var html='<div class="legalDocumentMeta"><span>'+esc(v.code)+'</span><span>'+esc(v.version_label)+'</span><span>'+esc(v.status)+'</span><span>Legal review: '+esc(v.legal_review_status)+'</span><span>SHA-256 '+esc(v.content_sha256)+'</span></div><div class="legalDocumentText">'+md(v.content_markdown)+"</div>";
  if(canReview)html+='<div class="legalReviewForm"><label>Completed legal review reference<input id="legalReviewReference" placeholder="External counsel / review memo / reference"></label><label>Reason / note<input id="legalReviewReason" placeholder="What was reviewed"></label><button id="recordLegalReview" class="legalPrimary" type="button">Record completed legal review</button></div>';
  if(canActivate)html+='<div class="legalActivationWarning"><strong>Activation creates an enforceable app gate.</strong><p>Activate only after jurisdictional review is complete.</p><button id="activateLegalVersion" class="legalDanger" type="button">Activate reviewed version</button></div>';
  html+='<button id="legalAdminBack" class="legalSecondary" type="button">Back to Legal Admin</button>';document.getElementById("legalBody").innerHTML=html;
  var review=document.getElementById("recordLegalReview");if(review)review.onclick=async function(){var ref=document.getElementById("legalReviewReference").value.trim();if(!ref)return toast("A real legal review reference is required.");try{await api("/api/legal/admin/versions/"+id+"/review",{method:"POST",body:JSON.stringify({review_type:"legal",approved:true,legal_review_reference:ref,reason:document.getElementById("legalReviewReason").value})});toast("Legal review metadata recorded.");await openAdminVersion(id,canManage);}catch(e){toast(e.message);}};
  var activate=document.getElementById("activateLegalVersion");if(activate)activate.onclick=async function(){if(!confirm("Activate this legally reviewed version? Affected users may be required to re-consent."))return;try{await api("/api/legal/admin/versions/"+id+"/activate",{method:"POST",body:JSON.stringify({reason:"Activated after recorded legal review"})});toast("Legal version activated.");await openCenter();}catch(e){toast(e.message);}};
  document.getElementById("legalAdminBack").onclick=openCenter;
}
function openGate(gate){
  openSheet("Action requires legal acceptance");
  var body=document.getElementById("legalBody"),html='<div class="legalGateHero"><strong>Current documents require acceptance.</strong><p>Your original action was not completed. Accept the exact active version, then try again.</p></div>';
  (gate.missing||[]).forEach(function(x){html+='<article class="legalCard required"><div><h3>'+esc(x.title)+'</h3><p>'+esc(x.version_label)+" • "+esc(x.locale)+'</p></div><button data-gate-version="'+x.version_id+'" type="button">Read & accept</button></article>';});
  html+='<button id="gateCenter" class="legalSecondary" type="button">Open Legal Center</button>';body.innerHTML=html;
  ctx.gates=[Object.assign({label:gate.action_code},gate)];
  Array.prototype.forEach.call(body.querySelectorAll("[data-gate-version]"),function(b){b.onclick=function(){viewDoc(Number(b.dataset.gateVersion),gate.action_code,gate.role);};});
  document.getElementById("gateCenter").onclick=openCenter;
}
function boot(){ensureUi();addButton();document.addEventListener("abl:profile-state",addButton);}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
