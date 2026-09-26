const clean=(value,max=200)=>String(value??'').trim().slice(0,max);

export function databaseNameFromUrl(value=''){
  try{return decodeURIComponent(new URL(value).pathname.replace(/^\//,'').split('/')[0]||'')}
  catch{return''}
}

export function validateRuntimeSafety(env={}){
  const service=clean(env.RAILWAY_SERVICE_NAME,120);
  const appEnvironment=clean(env.APP_ENV,40).toLowerCase();
  const databaseName=databaseNameFromUrl(env.DATABASE_URL).toLowerCase();
  const previewService=service==='accounting-preview';
  const productionService=service==='accounting-business-life';
  const qaDatabase=/(?:^|_)(?:qa|test)$/.test(databaseName);
  const previewLink=clean(env.AUTH_PREVIEW_SHOW_LINK,10).toLowerCase()==='true';
  const paymentMode=clean(env.PAYMONGO_MODE,20).toLowerCase();
  const livePayments=['1','true','yes','on'].includes(clean(env.PAYMONGO_LIVE_ENABLED,10).toLowerCase());
  const ownerMigrationEnabled=clean(env.OWNER_MIGRATION_ENABLED,10).toLowerCase()==='true';
  const qaPhTestContext=['1','true','yes','on'].includes(clean(env.QA_PH_TEST_CONTEXT,10).toLowerCase());

  if(previewService){
    if(appEnvironment!=='qa')throw new Error('accounting-preview requires APP_ENV=qa');
    if(!qaDatabase)throw new Error('accounting-preview requires an isolated *_qa or *_test database');
    if(paymentMode&&paymentMode!=='test')throw new Error('accounting-preview permits PayMongo test mode only');
    if(livePayments)throw new Error('accounting-preview must keep live payments disabled');
  }

  if(productionService){
    if(appEnvironment==='qa'||qaDatabase)throw new Error('production cannot use the QA environment or database');
    if(previewLink)throw new Error('production cannot expose preview verification links');
    if(qaPhTestContext)throw new Error('production cannot enable QA Philippines test context');
  }

  if(ownerMigrationEnabled){
    if(!previewService||appEnvironment!=='qa'||!qaDatabase)throw new Error('owner migration may run only in the isolated QA service');
    if(!clean(env.APP_PIN,500))throw new Error('owner migration requires a temporary QA bootstrap credential');
  }

  return{service,appEnvironment,databaseName,previewService,productionService,ownerMigrationEnabled,qaPhTestContext};
}

export function enforceRuntimeSafety(env=process.env){return validateRuntimeSafety(env)}
