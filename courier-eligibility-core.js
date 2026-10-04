import {canonicalDeliveryVehicleClass} from './delivery-pricing-v2-core.js';

export const COURIER_ELIGIBILITY_POLICY_VERSION='ph-courier-eligibility-v2';
export const COURIER_ELIGIBILITY_STATUSES=Object.freeze([
  'not_requested','pending','approved','suspended','revoked','expired'
]);

export const COURIER_ELIGIBILITY_REQUIREMENTS=Object.freeze({
  APPROVED_VEHICLE:'Choose one supported vehicle class for the approval.',
  VEHICLE_CAPACITY:'Record a positive maximum weight and volume for the approved vehicle.',
  OPERATING_AREA:'Choose an official operating barangay and confirm its area name.',
  SERVICE_RADIUS:'Record a service radius greater than zero.',
  ELIGIBILITY_EXPIRY:'Set a future eligibility expiry date.',
  REVIEW_ATTESTATION:'A named Admin must attest the review under the current policy.',
  REVIEW_NOTE:'Record what evidence was reviewed and why the decision is appropriate.',
  VERIFIED_VEHICLE_EVIDENCE:'Verify at least one unexpired private document for the approved vehicle.'
});

const clean=(value,max=600)=>String(value??'').trim().slice(0,max);
const positive=value=>Number.isFinite(Number(value))&&Number(value)>0;
const positiveInteger=value=>Number.isInteger(Number(value))&&Number(value)>0;

function instant(value,{dateOnlyEnd=false}={}){
  if(value instanceof Date){
    const milliseconds=value.getTime();
    if(!Number.isFinite(milliseconds))return NaN;
    const startsAtLocalMidnight=value.getHours()===0&&value.getMinutes()===0&&
      value.getSeconds()===0&&value.getMilliseconds()===0;
    return dateOnlyEnd&&startsAtLocalMidnight?milliseconds+86_399_999:milliseconds;
  }
  const raw=clean(value,80);
  if(!raw)return NaN;
  const normalized=dateOnlyEnd&&/^\d{4}-\d{2}-\d{2}$/.test(raw)
    ?raw+'T23:59:59.999Z':raw;
  return new Date(normalized).getTime();
}

function canonicalVehicle(value){
  try{return canonicalDeliveryVehicleClass(value)}catch{return''}
}

function vehicleEvidenceDocumentType(value){
  const normalized=clean(value,80).toLowerCase().replace(/[^a-z0-9]+/g,'_');
  return ['vehicle','registration','insurance','permit','licence','license']
    .some(token=>normalized.includes(token));
}

function requirement(code,met,detail=''){
  return Object.freeze({
    code,
    met:Boolean(met),
    label:COURIER_ELIGIBILITY_REQUIREMENTS[code],
    detail:clean(detail,240)
  });
}

export function courierEligibilityAssessment(profile={},documents=[],{nowMs=Date.now()}={}){
  const status=clean(profile.eligibility_status||'not_requested',30);
  const approvedVehicle=canonicalVehicle(profile.approved_vehicle_class);
  const eligibilityExpiry=instant(profile.eligibility_expires_at,{dateOnlyEnd:true});
  const reviewTime=instant(profile.eligibility_reviewed_at);
  const policyVersion=clean(profile.eligibility_policy_version,80);
  const operatingCode=clean(profile.operating_psgc_code,20);
  const operatingName=clean(profile.operating_area_name,160);
  const operatingSource=clean(profile.operating_area_source_version,120);
  const note=clean(profile.approval_note,600);
  const nonCommercial=profile.non_commercial_test_only===true||
    clean(profile.account_mode,40)==='company_test';
  const source=Array.isArray(documents)?documents:[];

  const matchingDocuments=source.filter(document=>{
    if(clean(document.verification_status,30)!=='verified')return false;
    if(!vehicleEvidenceDocumentType(document.document_type))return false;
    if(!positiveInteger(document.private_evidence_object_id))return false;
    const verifiedAt=instant(document.verified_at);
    if(!positiveInteger(document.verified_by_account_id)||!Number.isFinite(verifiedAt)||verifiedAt>Number(nowMs))return false;
    const issue=instant(document.issue_date);
    const expiry=instant(document.expiry_date,{dateOnlyEnd:true});
    if(!Number.isFinite(issue)||issue>Number(nowMs)||!Number.isFinite(expiry)||
      expiry<=Number(nowMs)||expiry<=issue)return false;
    return Boolean(approvedVehicle)&&canonicalVehicle(document.vehicle_class)===approvedVehicle;
  });
  const latestMatchingVerification=matchingDocuments.reduce((latest,document)=>
    Math.max(latest,instant(document.verified_at)),0);

  const requirements=Object.freeze([
    requirement('APPROVED_VEHICLE',Boolean(approvedVehicle),approvedVehicle||'No supported approved vehicle selected.'),
    requirement(
      'VEHICLE_CAPACITY',
      positive(profile.max_weight_kg)&&positive(profile.max_volume_l),
      positive(profile.max_weight_kg)&&positive(profile.max_volume_l)
        ?`${Number(profile.max_weight_kg)} kg · ${Number(profile.max_volume_l)} L`
        :'Both maximum weight and maximum volume must be greater than zero.'
    ),
    requirement(
      'OPERATING_AREA',
      /^\d{10}$/.test(operatingCode)&&Boolean(operatingName)&&Boolean(operatingSource),
      operatingName&&operatingCode&&operatingSource
        ?`${operatingName} · ${operatingCode}`:'Official operating barangay is missing or cannot be verified.'
    ),
    requirement(
      'SERVICE_RADIUS',
      positive(profile.service_radius_km),
      positive(profile.service_radius_km)?`${Number(profile.service_radius_km)} km`:'Service radius must be greater than zero.'
    ),
    requirement(
      'ELIGIBILITY_EXPIRY',
      Number.isFinite(eligibilityExpiry)&&eligibilityExpiry>Number(nowMs),
      Number.isFinite(eligibilityExpiry)&&eligibilityExpiry>Number(nowMs)
        ?new Date(eligibilityExpiry).toISOString()
        :'Eligibility expiry is missing or has passed.'
    ),
    requirement(
      'REVIEW_ATTESTATION',
      positiveInteger(profile.eligibility_reviewed_by_account_id)&&
        Number.isFinite(reviewTime)&&reviewTime<=Number(nowMs)&&
        (latestMatchingVerification===0||reviewTime>=latestMatchingVerification)&&
        policyVersion===COURIER_ELIGIBILITY_POLICY_VERSION,
      policyVersion===COURIER_ELIGIBILITY_POLICY_VERSION
        ?'Reviewer identity and a review time after the current evidence verification are required.'
        :`Current policy ${COURIER_ELIGIBILITY_POLICY_VERSION} has not been attested.`
    ),
    requirement(
      'REVIEW_NOTE',
      note.length>=8,
      note.length>=8?'Review reason recorded.':'Record a clear review reason of at least 8 characters.'
    ),
    requirement(
      'VERIFIED_VEHICLE_EVIDENCE',
      matchingDocuments.length>0,
      matchingDocuments.length
        ?`${matchingDocuments.length} matching verified document${matchingDocuments.length===1?'':'s'}.`
        :'No unexpired verified private evidence matches the approved vehicle.'
    )
  ]);
  const missing=requirements.filter(item=>!item.met);
  const prerequisitesMet=missing.length===0;
  const eligible=status==='approved'&&prerequisitesMet;
  const profileExpiryExpired=Number.isFinite(eligibilityExpiry)&&eligibilityExpiry<=Number(nowMs);
  const documentExpiryOnly=matchingDocuments.length===0&&source.some(document=>
    Boolean(approvedVehicle)&&canonicalVehicle(document.vehicle_class)===approvedVehicle&&
    vehicleEvidenceDocumentType(document.document_type)&&
    (
      clean(document.verification_status,30)==='expired'||
      (
        clean(document.verification_status,30)==='verified'&&
        Number.isFinite(instant(document.expiry_date,{dateOnlyEnd:true}))&&
        instant(document.expiry_date,{dateOnlyEnd:true})<=Number(nowMs)
      )
    )
  );
  const effectiveStatus=status==='approved'&&!prerequisitesMet
    ?(profileExpiryExpired||documentExpiryOnly?'expired':'pending')
    :(COURIER_ELIGIBILITY_STATUSES.includes(status)?status:'not_requested');

  return Object.freeze({
    policy_version:COURIER_ELIGIBILITY_POLICY_VERSION,
    stored_status:status,
    effective_status:effectiveStatus,
    prerequisites_met:prerequisitesMet,
    can_approve:prerequisitesMet,
    eligible,
    available:eligible&&profile.available===true,
    non_commercial:nonCommercial,
    commercial_use_allowed:!nonCommercial,
    approved_vehicle_class:approvedVehicle,
    verified_matching_document_count:matchingDocuments.length,
    requirements,
    missing_requirements:Object.freeze(missing.map(item=>item.code)),
    missing_labels:Object.freeze(missing.map(item=>item.label))
  });
}

export function courierEligibilityProfileView(profile={},documents=[],options={}){
  const eligibility=courierEligibilityAssessment(profile,documents,options);
  return Object.freeze({
    ...profile,
    eligibility_status:eligibility.effective_status,
    approved_vehicle_class:eligibility.approved_vehicle_class||clean(profile.approved_vehicle_class,40),
    available:eligibility.available,
    eligibility
  });
}

export function courierEligibilityError(assessment){
  const missing=Array.isArray(assessment?.missing_labels)?assessment.missing_labels:[];
  const error=new Error(missing.length
    ?`Courier approval is incomplete: ${missing.join(' ')}`
    :'Courier approval prerequisites are incomplete.');
  error.status=409;
  error.code='COURIER_ELIGIBILITY_INCOMPLETE';
  error.missing_requirements=Array.isArray(assessment?.missing_requirements)
    ?assessment.missing_requirements:[];
  error.eligibility=assessment||null;
  return error;
}

export async function readCourierEligibility(db,accountId,{lock=false,nowMs=Date.now()}={}){
  const id=Number(accountId);
  if(!Number.isInteger(id)||id<=0)return null;
  const profile=await db.query(
    `SELECT c.*,a.account_mode,a.test_role
       FROM courier_profiles c JOIN accounts a ON a.id=c.account_id
      WHERE c.account_id=$1${lock?' FOR UPDATE OF c':''}`,
    [id]
  );
  if(!profile.rowCount)return null;
  const documents=await db.query(
    `SELECT id,account_id,document_type,vehicle_class,reference_number,issue_date,expiry_date,
            private_evidence_object_id,verification_status,verified_by_account_id,verified_at,
            rejection_reason,created_at,updated_at
       FROM courier_documents WHERE account_id=$1 ORDER BY created_at DESC,id DESC${lock?' FOR UPDATE':''}`,
    [id]
  );
  const assessment=courierEligibilityAssessment(profile.rows[0],documents.rows,{nowMs});
  return{profile:profile.rows[0],documents:documents.rows,assessment};
}

export async function reconcileCourierEligibility(db,accountId,{lock=false,withdrawOffers=false,nowMs=Date.now()}={}){
  const record=await readCourierEligibility(db,accountId,{lock,nowMs});
  if(!record)return null;
  const currentStatus=clean(record.profile.eligibility_status,30);
  const targetStatus=currentStatus==='approved'&&!record.assessment.eligible
    ?record.assessment.effective_status:currentStatus;
  const targetAvailable=record.assessment.eligible&&record.profile.available===true;
  if(targetStatus!==currentStatus||targetAvailable!==record.profile.available){
    const updated=await db.query(
      `UPDATE courier_profiles SET eligibility_status=$1,available=$2,updated_at=NOW()
        WHERE account_id=$3 RETURNING *`,
      [targetStatus,targetAvailable,Number(accountId)]
    );
    record.profile={...record.profile,...updated.rows[0]};
    record.assessment=courierEligibilityAssessment(record.profile,record.documents,{nowMs});
  }
  if(withdrawOffers&&!targetAvailable){
    await db.query(
      `UPDATE delivery_offers SET status='withdrawn',responded_at=COALESCE(responded_at,NOW()),updated_at=NOW()
        WHERE courier_account_id=$1 AND status='pending'`,
      [Number(accountId)]
    );
  }
  return record;
}
