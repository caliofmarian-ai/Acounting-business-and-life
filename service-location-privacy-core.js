const ACTIVE_EXACT_LOCATION_STATUSES=Object.freeze(['accepted','scheduled','in_progress']);

const clean=(value,max=500)=>String(value??'').trim().slice(0,max);

function accessError(message,status,code){
  return Object.assign(new Error(message),{status,code});
}

export function providerExactLocationAvailable(job){
  return Boolean(
    job
    && ACTIVE_EXACT_LOCATION_STATUSES.includes(clean(job.status,40))
    && clean(job.service_location,400)
  );
}

export function redactProviderServiceJob(job={}){
  const exactLocationAvailable=providerExactLocationAvailable(job);
  const {service_location:_exactLocation,...safe}=job;
  return{
    ...safe,
    service_location:null,
    exact_location_available:exactLocationAvailable
  };
}

export function requireProviderExactLocation(job,actorAccountId){
  const actorId=Number(actorAccountId);
  if(!job||!Number.isInteger(actorId)||actorId<1||Number(job.provider_account_id)!==actorId){
    throw accessError('Service job not found',404,'SERVICE_JOB_NOT_FOUND');
  }
  if(!ACTIVE_EXACT_LOCATION_STATUSES.includes(clean(job.status,40))){
    throw accessError(
      'Exact service location is available only for an accepted active job.',
      409,
      'SERVICE_LOCATION_PURPOSE_EXPIRED'
    );
  }
  const exactLocation=clean(job.service_location,400);
  if(!exactLocation){
    throw accessError('Exact service location is not available for this job.',409,'SERVICE_LOCATION_UNAVAILABLE');
  }
  return exactLocation;
}

export function coarseServiceAreaFromGeography(geography,{companyTest=false}={}){
  if(geography?.assigned){
    const officialArea=clean(geography.path_text||geography.name,300);
    if(officialArea)return officialArea;
  }
  if(companyTest)return'Controlled test area';
  throw accessError(
    'Complete your official barangay before requesting an in-person service.',
    409,
    'SERVICE_COARSE_LOCATION_REQUIRED'
  );
}

export async function ensureServiceLocationPrivacySchema(pool){
  await pool.query(`
    ALTER TABLE service_jobs
      ADD COLUMN IF NOT EXISTS coarse_location TEXT NOT NULL DEFAULT '';

    UPDATE service_jobs
       SET coarse_location='Area not recorded for this historical request'
     WHERE BTRIM(coarse_location)='';

    CREATE TABLE IF NOT EXISTS service_job_sensitive_access_events (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL REFERENCES service_jobs(id),
      actor_account_id BIGINT NOT NULL REFERENCES accounts(id),
      subject_account_id BIGINT NOT NULL REFERENCES accounts(id),
      actor_context TEXT NOT NULL,
      event_code TEXT NOT NULL,
      job_status TEXT NOT NULL,
      purpose_code TEXT NOT NULL,
      request_correlation_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT service_job_sensitive_access_actor_check
        CHECK(actor_context='service_provider'),
      CONSTRAINT service_job_sensitive_access_event_check
        CHECK(event_code='exact_service_location_viewed'),
      CONSTRAINT service_job_sensitive_access_status_check
        CHECK(job_status IN ('accepted','scheduled','in_progress')),
      CONSTRAINT service_job_sensitive_access_purpose_check
        CHECK(purpose_code='active_job_fulfilment')
    );
    CREATE INDEX IF NOT EXISTS service_job_sensitive_access_job_idx
      ON service_job_sensitive_access_events(job_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS service_job_sensitive_access_actor_idx
      ON service_job_sensitive_access_events(actor_account_id,created_at DESC);
  `);
}

export const SERVICE_LOCATION_ACTIVE_STATUSES=ACTIVE_EXACT_LOCATION_STATUSES;
