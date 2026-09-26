import {validateRuntimeSafety} from './runtime-safety.js';

const cleanEmail=value=>String(value||'').trim().toLowerCase();

export function qaRemoteTestAccountConfig(env=process.env){
  const runtime=validateRuntimeSafety(env);
  const email=cleanEmail(env.QA_REMOTE_TEST_EMAIL);
  if(!email)return{enabled:false,email:'',runtime};
  if(!runtime.previewService||runtime.appEnvironment!=='qa'||!/(?:^|_)(?:qa|test)$/.test(runtime.databaseName)){
    throw new Error('QA remote test account may exist only on isolated accounting-preview QA data');
  }
  if(!runtime.qaPhTestContext)throw new Error('QA remote test account requires QA_PH_TEST_CONTEXT');
  return{enabled:true,email,runtime};
}

export function isQaRemoteTestEmail(email,env=process.env){
  const config=qaRemoteTestAccountConfig(env);
  return Boolean(config.enabled&&cleanEmail(email)===config.email);
}

export function qaRemoteTestAccountState(account,env=process.env){
  const email=cleanEmail(account?.email);
  const enabled=isQaRemoteTestEmail(email,env);
  return{
    enabled,
    mode:enabled?'designated_remote_ph_test':'normal_location_rules',
    country_code:enabled?'PH':null
  };
}
