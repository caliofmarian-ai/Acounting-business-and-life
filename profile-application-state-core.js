export const PROFILE_APPLICATION_STATES=Object.freeze([
  'application_started','requirements_pending','submitted','under_review',
  'approved','rejected','suspended','revoked'
]);

export const PROFILE_APPLICATION_EDITABLE_STATES=Object.freeze([
  'application_started','requirements_pending','rejected'
]);

export const PROFILE_APPLICATION_REVIEWABLE_STATES=Object.freeze([
  'submitted','under_review'
]);

const REVIEW_STATUS_BY_DECISION=Object.freeze({
  approve:'approved',
  reject:'rejected',
  under_review:'under_review',
  requirements_pending:'requirements_pending'
});

function transitionError(message,code){
  return Object.assign(new Error(message),{status:409,code});
}

export function applicationStatusAfterSave(currentStatus){
  const status=String(currentStatus||'');
  if(!PROFILE_APPLICATION_EDITABLE_STATES.includes(status)){
    throw transitionError('Application can no longer be edited in its current state','APPLICATION_NOT_EDITABLE');
  }
  // Saving a draft never invents an Admin decision. In particular, a new draft
  // must not become requirements_pending until an Admin explicitly requests it.
  return status;
}

export function applicationStatusAfterSubmit(currentStatus){
  const status=String(currentStatus||'');
  if(!PROFILE_APPLICATION_EDITABLE_STATES.includes(status)){
    throw transitionError('Application cannot be submitted from its current state','APPLICATION_NOT_SUBMITTABLE');
  }
  return'submitted';
}

export function applicationStatusAfterReview(currentStatus,decision){
  const status=String(currentStatus||''),normalized=String(decision||'');
  if(!PROFILE_APPLICATION_REVIEWABLE_STATES.includes(status)){
    throw transitionError('Application is not awaiting review','APPLICATION_NOT_REVIEWABLE');
  }
  const next=REVIEW_STATUS_BY_DECISION[normalized];
  if(!next)throw Object.assign(new Error('Choose approve, reject, under_review or requirements_pending'),{status:400,code:'INVALID_REVIEW_DECISION'});
  return next;
}

export function profileProjectionForApplication(applicationStatus){
  const status=String(applicationStatus||'');
  if(!PROFILE_APPLICATION_STATES.includes(status)){
    throw Object.assign(new Error('Unknown profile application state'),{status:500,code:'UNKNOWN_APPLICATION_STATE'});
  }
  if(status==='approved')return{enabled:true,status:'active',visibility:'private'};
  return{enabled:false,status,visibility:'private'};
}

export function expectedReviewStatus(decision){
  return REVIEW_STATUS_BY_DECISION[String(decision||'')]||'';
}
