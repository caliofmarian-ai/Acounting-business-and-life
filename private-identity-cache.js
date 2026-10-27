// Session/profile identity is volatile private data, never a shared or browser cache entry.
export const PRIVATE_IDENTITY_CACHE_CONTROL='private, no-store, max-age=0';

function setPrivateIdentityHeaders(res){
  res.set('Cache-Control',PRIVATE_IDENTITY_CACHE_CONTROL);
  res.set('Pragma','no-cache');
  res.set('Surrogate-Control','no-store');
  res.vary('Cookie');
  res.vary('Authorization');
  return res;
}

// Set before authentication: denied and error responses must also prevent caching.
export function markPrivateIdentity(_req,res,next){
  setPrivateIdentityHeaders(res);
  next();
}

// Bypass Express automatic ETag/freshness-to-304 on volatile identity snapshots.
export function sendPrivateIdentityJson(res,payload){
  return setPrivateIdentityHeaders(res)
    .status(200)
    .set('Content-Type','application/json; charset=utf-8')
    .end(JSON.stringify(payload));
}

// Internal Fetch identity dispatch has no Express middleware.
export function privateIdentityFetchJson(status,payload){
  return new Response(JSON.stringify(payload),{
    status,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':PRIVATE_IDENTITY_CACHE_CONTROL,
      'Pragma':'no-cache',
      'Surrogate-Control':'no-store',
      'Vary':'Cookie, Authorization'
    }
  });
}
