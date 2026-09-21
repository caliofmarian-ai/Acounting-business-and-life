import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const services=readFileSync(new URL('../server-services.js',import.meta.url),'utf8');

function credentialRoute(){
  const start=services.indexOf("app.patch('/api/admin/service-credentials/:id'");
  const end=services.indexOf('\n\nfunction proxy',start);
  assert.ok(start>=0&&end>start,'credential review route must exist');
  return services.slice(start,end);
}

test('Local Services credential review uses delegated Admin permission instead of bootstrap account id',()=>{
  const block=credentialRoute();
  assert.match(services,/import \{ requireAdminPermission,appendAdminAudit \} from '\.\/admin-authorization\.js'/);
  assert.match(block,/requireAdminPermission\(pool,me\.account\.id,'credential\.verify',territoryId\)/);
  assert.doesNotMatch(block,/account\.id\)!==1/);
  assert.doesNotMatch(block,/bootstrap platform owner/i);
});

test('credential review derives Service Provider territory from canonical governance evidence',()=>{
  assert.match(services,/function credentialReviewTarget\(id\)/);
  assert.match(services,/FROM profile_authorizations pa/);
  assert.match(services,/pa\.role='service_provider'/);
  assert.match(services,/pa\.status='active'/);
  assert.match(services,/FROM profile_applications app/);
  assert.match(services,/app\.role='service_provider'/);
  assert.match(services,/app\.status NOT IN \('rejected','revoked'\)/);
});

test('credential review fails closed when Service Provider territory is not established',()=>{
  const block=credentialRoute();
  assert.match(block,/if\(!territoryId\)return res\.status\(409\)/);
  assert.match(block,/Service Provider territory must be established before credential review/);
});

test('credential review preserves verifier evidence and only accepts bounded review states',()=>{
  const block=credentialRoute();
  assert.match(block,/\['verified','rejected','expired'\]\.includes\(status\)/);
  assert.match(block,/verified_by_account_id=\$2/);
  assert.match(block,/verified_at=CASE WHEN \$1='verified' THEN NOW\(\) ELSE verified_at END/);
  assert.match(block,/rejection_reason=\$3/);
});

test('credential review writes an auditable Admin event with the same permission and territory',()=>{
  const block=credentialRoute();
  assert.match(block,/appendAdminAudit\(pool,/);
  assert.match(block,/permission:'credential\.verify'/);
  assert.match(block,/territoryId,/);
  assert.match(block,/targetType:'profile_credential'/);
  assert.match(block,/eventCode:'service_credential\.reviewed'/);
  assert.match(block,/assignmentId:assignment\?\.id\|\|null/);
  assert.match(block,/before:\{/);
  assert.match(block,/after,/);
});

test('ordinary identity alone never authorizes credential review',()=>{
  const block=credentialRoute();
  const permissionCheck=block.indexOf("requireAdminPermission(pool,me.account.id,'credential.verify',territoryId)");
  const update=block.indexOf('UPDATE profile_credentials');
  assert.ok(permissionCheck>=0&&update>permissionCheck,'permission gate must run before credential mutation');
});
