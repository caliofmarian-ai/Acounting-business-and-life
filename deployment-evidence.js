const clean=(value,max)=>String(value??'').trim().slice(0,max);

export function publicDeploymentEvidence(env=process.env){
  const rawEnvironment=clean(env.APP_ENV||env.RAILWAY_ENVIRONMENT_NAME||env.NODE_ENV,80).toLowerCase();
  const environment=rawEnvironment==='qa'?'qa':rawEnvironment.includes('prod')?'production':rawEnvironment.includes('stag')?'staging':rawEnvironment.includes('review')||rawEnvironment.includes('preview')?'preview':'unknown';
  const revision=clean(env.RAILWAY_GIT_COMMIT_SHA||env.GIT_COMMIT_SHA,64);
  return{
    environment,
    revision:revision&&/^[a-f0-9]{7,64}$/i.test(revision)?revision.slice(0,12):null
  };
}
