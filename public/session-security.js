(function installBusinessLifeSessionSecurity(){
  const SESSION_COOKIE='__Host-abl_session';
  const CSRF_COOKIE='__Host-abl_csrf';
  const LEGACY_STORAGE_KEY='abl_token';
  const originalFetch=window.fetch.bind(window);
  let migrationPending=false;

  function cookie(name){
    const prefix=name+'=';
    for(const part of String(document.cookie||'').split(';')){
      const value=part.trim();
      if(value.startsWith(prefix)){
        try{return decodeURIComponent(value.slice(prefix.length))}catch{return''}
      }
    }
    return'';
  }
  function clearReadableSession(){
    document.cookie=CSRF_COOKIE+'=; Path=/; Secure; SameSite=Lax; Max-Age=0';
  }
  function authenticated(){return Boolean(cookie(CSRF_COOKIE))||migrationPending}

  let legacyToken='';
  try{
    legacyToken=String(localStorage.getItem(LEGACY_STORAGE_KEY)||'');
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }catch{}

  migrationPending=!cookie(CSRF_COOKIE)&&/^v2\./.test(legacyToken);
  const migrate=migrationPending
    ?originalFetch('/api/auth/session/migrate',{
        method:'POST',
        credentials:'same-origin',
        headers:{Accept:'application/json',Authorization:'Bearer '+legacyToken,'Content-Type':'application/json'},
        body:'{}'
      }).then(async response=>{
        if(!response.ok){clearReadableSession();throw new Error('Stored session migration failed')}
        return true;
      }).catch(()=>false).finally(()=>{migrationPending=false})
    :Promise.resolve(authenticated());

  async function securedFetch(input,init={}){
    const raw=typeof input==='string'||input instanceof URL?String(input):input?.url;
    const url=new URL(raw||location.href,location.href);
    if(url.origin!==location.origin)return originalFetch(input,init);
    if(url.pathname!=='/api/auth/session/migrate')await migrate;
    const method=String(init.method||(input instanceof Request?input.method:'GET')||'GET').toUpperCase();
    const headers=new Headers(input instanceof Request?input.headers:undefined);
    new Headers(init.headers||{}).forEach((value,name)=>headers.set(name,value));
    headers.delete('Authorization');
    const csrf=cookie(CSRF_COOKIE);
    if(csrf&&!['GET','HEAD','OPTIONS'].includes(method))headers.set('X-CSRF-Token',csrf);
    const response=await originalFetch(input,{...init,headers,credentials:init.credentials||'same-origin'});
    if(response.status===401){
      await originalFetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
      clearReadableSession();
      document.dispatchEvent(new CustomEvent('abl:auth-expired'));
    }
    return response;
  }

  window.fetch=securedFetch;
  window.ABLSession=Object.freeze({
    ready:migrate,
    authenticated,
    csrfToken:()=>cookie(CSRF_COOKIE),
    clearReadableSession,
    sessionCookieName:SESSION_COOKIE
  });
})();
