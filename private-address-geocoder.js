const clean=(value,max=400)=>String(value??'').trim().slice(0,max);
const finite=value=>Number.isFinite(Number(value));
const DEFAULT_BASE='https://nominatim.openstreetmap.org';
const ADDRESS_PART_KEYS=Object.freeze([
  'house_number','road','pedestrian','residential','neighbourhood','suburb','quarter',
  'village','hamlet','barangay','city_district','city','town','municipality','county',
  'state','region','postcode','country','country_code'
]);
function sanitizeAddressParts(value){
  const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{},out={};
  for(const key of ADDRESS_PART_KEYS){
    const item=clean(input[key],180);
    if(item)out[key]=item;
  }
  return out;
}

export function createPrivateAddressGeocoder({
  fetchImpl=globalThis.fetch,
  baseUrl=process.env.PRIVATE_ADDRESS_GEOCODER_URL||process.env.MARKETPLACE_GEOCODER_URL||DEFAULT_BASE,
  userAgent=process.env.PRIVATE_ADDRESS_GEOCODER_USER_AGENT||process.env.MARKETPLACE_GEOCODER_USER_AGENT||'BusinessLife/1.0 (+https://caliof.com)',
  minimumGapMs=1100,
  now=()=>Date.now(),
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
}={}){
  const base=clean(baseUrl,500).replace(/\/$/,'');
  const agent=clean(userAgent,240);
  let queue=Promise.resolve(),lastRequestAt=0;

  const scheduled=task=>{
    const run=async()=>{
      const pause=Math.max(0,Number(minimumGapMs||0)-(now()-lastRequestAt));
      if(pause)await sleep(pause);
      lastRequestAt=now();
      return task();
    };
    const next=queue.then(run,run);
    queue=next.catch(()=>{});
    return next;
  };

  async function request(url){
    if(typeof fetchImpl!=='function')throw Object.assign(new Error('Address search is unavailable.'),{status:503});
    const response=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':agent}});
    if(!response.ok)throw Object.assign(new Error('Address search is temporarily unavailable.'),{status:503});
    return response.json();
  }

  async function search(query,countryCode=''){
    const q=clean(query,180),country=clean(countryCode,2).toLowerCase();
    if(q.length<3)throw Object.assign(new Error('Enter at least 3 characters to search for an address.'),{status:400});
    return scheduled(async()=>{
      const url=new URL(base+'/search');
      url.searchParams.set('format','jsonv2');
      url.searchParams.set('limit','5');
      url.searchParams.set('addressdetails','1');
      url.searchParams.set('q',q);
      if(country)url.searchParams.set('countrycodes',country);
      const rows=await request(url);
      return (Array.isArray(rows)?rows:[])
        .map(row=>({
          label:clean(row?.display_name,400),
          parts:sanitizeAddressParts(row?.address)
        }))
        .filter(row=>row.label);
    });
  }

  async function reverse(latitude,longitude){
    const lat=Number(latitude),lng=Number(longitude);
    if(!finite(lat)||lat<-90||lat>90||!finite(lng)||lng<-180||lng>180){
      throw Object.assign(new Error('Valid GPS coordinates are required.'),{status:400});
    }
    return scheduled(async()=>{
      const url=new URL(base+'/reverse');
      url.searchParams.set('format','jsonv2');
      url.searchParams.set('lat',String(lat));
      url.searchParams.set('lon',String(lng));
      url.searchParams.set('zoom','18');
      url.searchParams.set('addressdetails','1');
      const row=await request(url);
      const label=clean(row?.display_name,400);
      if(!label)throw Object.assign(new Error('No street address could be found for this location.'),{status:404});
      return{label,parts:sanitizeAddressParts(row?.address)};
    });
  }

  return Object.freeze({search,reverse});
}
