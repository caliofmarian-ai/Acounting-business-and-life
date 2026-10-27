(() => {
  'use strict';
  const copy = {
    'en-PH': {
      app:'Open app',eyebrow:'ACCOUNT ACCESS',language:'Language',title:'Cannot sign in?',intro:'Ask for help without signing in. This form is only for problems accessing your Business & Life account.',before:'Try recovery first',recovery:'Use Forgot password or the email-verification option on the sign-in screen. Check Spam and Junk folders too.',signin:'Go to sign in',email:'An email address you can currently access',emailHint:'This contact address is unverified. Providing it does not prove account ownership.',name:'Name (optional)',reason:'What is preventing access?',choose:'Choose a reason',sign_in:'Sign-in problem',password_reset:'Password reset did not work',email_verification:'Email verification problem',lost_email:'Cannot access my previous email',other_access:'Another account-access problem',message:'Describe what happened',messageHint:'20–2,000 characters. Include the error message and steps tried, but never passwords, one-time codes, identity documents or payment-card details. No attachments.',privacy:'Your contact details and message are stored privately for authorized support staff. Sending this request does not unlock, approve or recover an account. A response time is not guaranteed.',send:'Send access request',back:'Back to Help Center',staff:'Authorized staff queue',sending:'Saving your request…',saved:'Request saved',success:'Your request has been saved for private review. This does not confirm an account exists or change access. No response time is guaranteed.',unknown:'We could not confirm that your request was saved. Your text is still here. Check your connection and retry with the same details.',invalid:'Check the contact email, reason and message (20–2,000 characters). Do not add attachments or recovery secrets.',limited:'Too many requests. Please wait before trying again.',origin:'Open this form directly on the Business & Life website and try again.',unavailable:'The request could not be completed. Your text is still here. Please try again later.'
    },
    'fil-PH': {
      app:'Buksan ang app',eyebrow:'PAG-ACCESS SA ACCOUNT',language:'Wika',title:'Hindi makapag-sign in?',intro:'Humingi ng tulong kahit hindi naka-sign in. Para lamang ito sa mga problema sa pag-access sa iyong Business & Life account.',before:'Subukan muna ang recovery',recovery:'Gamitin ang Forgot password o email verification sa sign-in screen. Tingnan din ang Spam at Junk folders.',signin:'Pumunta sa sign in',email:'Email address na maaari mong buksan ngayon',emailHint:'Hindi pa beripikado ang email na ito. Hindi nito pinatutunayan na sa iyo ang account.',name:'Pangalan (opsyonal)',reason:'Ano ang problema sa pag-access?',choose:'Pumili ng dahilan',sign_in:'Problema sa pag-sign in',password_reset:'Hindi gumana ang password reset',email_verification:'Problema sa email verification',lost_email:'Hindi ko na mabuksan ang dati kong email',other_access:'Ibang problema sa pag-access sa account',message:'Ilarawan ang nangyari',messageHint:'20–2,000 character. Ilagay ang error message at mga sinubukan mo. Huwag maglagay ng password, one-time code, ID document o detalye ng payment card. Walang attachment.',privacy:'Pribadong itatago ang iyong contact details at mensahe para sa awtorisadong support staff. Hindi nito ia-unlock, aaprubahan o ire-recover ang account. Walang garantisadong oras ng pagtugon.',send:'Ipadala ang kahilingan',back:'Bumalik sa Help Center',staff:'Queue para sa awtorisadong staff',sending:'Sine-save ang kahilingan…',saved:'Na-save ang kahilingan',success:'Na-save ang iyong kahilingan para sa pribadong pagsusuri. Hindi nito kinukumpirma na may account o binabago ang access. Walang garantisadong oras ng pagtugon.',unknown:'Hindi namin makumpirma kung na-save ang kahilingan. Nandito pa ang iyong mensahe. Suriin ang koneksiyon at subukang muli gamit ang parehong detalye.',invalid:'Suriin ang email, dahilan at mensahe (20–2,000 character). Huwag magdagdag ng attachment o recovery secret.',limited:'Masyadong maraming kahilingan. Maghintay bago subukang muli.',origin:'Buksan ang form na ito mismo sa Business & Life website at subukang muli.',unavailable:'Hindi makumpleto ang kahilingan. Nandito pa ang iyong mensahe. Subukang muli mamaya.'
    }
  };
  const form=document.getElementById('access-form'),button=document.getElementById('send'),feedback=document.getElementById('feedback'),language=document.getElementById('language');
  if(!form||!button||!feedback||!language)return;
  let locale=new URLSearchParams(location.search).get('lang')==='fil-PH'?'fil-PH':'en-PH',busy=false,saved=false,feedbackKey='';
  const t=key=>copy[locale][key];
  function render(){
    document.documentElement.lang=locale;
    language.value=locale;
    for(const element of document.querySelectorAll('[data-copy]'))element.textContent=t(element.dataset.copy);
    button.textContent=t(saved?'saved':busy?'sending':'send');
    button.disabled=busy||saved;
    if(feedbackKey)feedback.textContent=t(feedbackKey);
  }
  function report(key,kind){feedbackKey=key;feedback.textContent=t(key);feedback.dataset.kind=kind;feedback.focus();}
  language.addEventListener('change',()=>{locale=language.value==='fil-PH'?'fil-PH':'en-PH';render();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||saved||!form.reportValidity())return;
    const data=Object.fromEntries(new FormData(form));
    if([...String(data.message||'').trim()].length<20){report('invalid','error');return;}
    busy=true;feedbackKey='sending';render();
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/public/account-access',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-Account-Access-Request':'1'},body:JSON.stringify(data),signal:controller.signal});
      const payload=await response.json().catch(()=>null);
      if(response.status===202&&payload?.ok===true){saved=true;form.reset();report('success','success');}
      else if(response.status===429)report('limited','error');
      else if(response.status===403)report('origin','error');
      else if([400,413,415].includes(response.status))report('invalid','error');
      else report(response.status>=500?'unavailable':'unknown','error');
    }catch{report('unknown','error');}
    finally{clearTimeout(timeout);busy=false;render();}
  });
  render();
})();
