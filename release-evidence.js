const clone=value=>JSON.parse(JSON.stringify(value));

export const CURRENT_RELEASE_EVIDENCE=Object.freeze({
  version:'production-e2e-audit-2026-10-04-v3',
  source_issue:758,
  source_title:'PRODUCTION E2E AUDIT 2026-10-04 — launch holds and cross-role defects',
  country_code:'PH',
  observed_at:'2026-10-04T21:48:48.374Z',
  status:'hold',
  summary:'Public V1 launch remains on hold only for the external legal evidence gate and physical Android Super Admin MFA acceptance. The controlled non-settling Production lifecycle is accepted.',
  product_quality:Object.freeze({
    open_p0:2,
    open_p1:0,
    production_regressions:0,
    parity_issues:null,
    parity_policy:'production_only',
    failed_acceptance_waves:0,
    last_functional_qa_at:'2026-10-04T21:37:40.445Z'
  }),
  unavailable_reasons:Object.freeze({
    parity_issues:'Preview parity is not used for Owner acceptance. Production-only verification is canonical.'
  }),
  owner_decisions:Object.freeze([
    Object.freeze({
      decision_code:'LEGAL-001',
      source_domain:'release_evidence',
      source_type:'github_issue',
      source_id:'759',
      required_authority:'project_owner',
      severity:'critical',
      state:'open',
      reason_code:'external_legal_evidence_missing',
      title:'Legal launch gate still requires external evidence',
      summary:'The platform remains fail-closed because the reviewed Philippines legal set and real operator/PIC evidence are not yet confirmed.',
      impact:'Public launch cannot be accepted until the legal evidence is real and auditable.',
      country_code:'PH',
      created_at:'2026-10-04T10:12:24.000Z'
    }),
    Object.freeze({
      decision_code:'SEC-001',
      source_domain:'release_evidence',
      source_type:'github_issue',
      source_id:'760',
      required_authority:'project_owner',
      severity:'high',
      state:'open',
      reason_code:'physical_android_acceptance_pending',
      title:'Complete physical Android MFA acceptance',
      summary:'Super Admin MFA code and automated Production acceptance passed. The Owner still needs to enroll, challenge, use recovery and reset on a physical Android device.',
      impact:'Do not clear the Super Admin launch hold until the physical-device acceptance is recorded.',
      country_code:'PH',
      created_at:'2026-10-04T10:12:25.000Z'
    }),
  ])
});

export function currentReleaseEvidence(){
  return clone(CURRENT_RELEASE_EVIDENCE);
}
