import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('public/admin-console.js');
const notifications=read('public/notifications-ui.js');
const core=read('notification-core.js');
const gateway=read('server-notifications.js');
const governance=read('server-profile-governance.js');

test('pending profile applications become the default Members destination when review work exists',()=>{
  assert.match(admin,/pending=m\.id==='members'\?Number\(state\.overview\?\.summary\?\.pending_applications\|\|0\):0/);
  assert.match(admin,/approval'\+\(pending===1\?'':'s'\)/);
  assert.match(admin,/state\.memberHubTab=pending>0&&tabs\.some\(x=>x\.id==='requests'\)\?'requests':tabs\[0\]\.id/);
  assert.match(admin,/Awaiting review/);
  assert.match(admin,/rows\(pending,profileApplicationRow\)/);
  assert.match(admin,/Previous applications/);
});

test('Merchant business name is prominent in the profile approval queue',()=>{
  assert.match(admin,/business=String\(x\.proposed_business_name\|\|''\)\.trim\(\)/);
  assert.match(admin,/esc\(business\|\|applicant\)/);
});

test('Admin application evidence shows safe file metadata before opening the private file',()=>{
  for(const marker of ['original_file_name','detected_mime','byte_size','scan_status'])assert.match(governance,new RegExp(marker));
  assert.match(admin,/applicationEvidenceType/);
  assert.match(admin,/applicationEvidenceFileSize/);
  assert.match(admin,/scan /);
  assert.match(admin,/Open document/);
  assert.match(admin,/data-application-document/);
});

test('in-app profile application notification opens the exact Admin review',()=>{
  assert.match(notifications,/entity_type==='profile_application'/);
  assert.match(notifications,/BusinessLifeAdminConsole\?\.openProfileApplication/);
  assert.match(notifications,/\/admin\?application=/);
  assert.match(admin,/openProfileApplication:openProfileApplicationFromContext/);
  assert.match(admin,/new URLSearchParams\(location\.search\)\.get\('application'\)/);
});

test('Web Push and Admin application notification metadata point to the exact review context',()=>{
  assert.match(core,/entity_type==='profile_application'/);
  assert.match(core,/\/admin\?application=\$\{encodeURIComponent\(row\.entity_id\)\}/);
  assert.match(gateway,/priority:'high'/);
  assert.match(gateway,/application_id:a\.id/);
  assert.match(gateway,/applicant_name:a\.applicant_name/);
  assert.match(gateway,/territory_name:a\.territory_name/);
  assert.match(gateway,/business_context:businessName/);
});
