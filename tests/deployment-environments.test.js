import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicDeploymentEvidence} from '../deployment-evidence.js';

const server=readFileSync(new URL('../server-paymongo.js',import.meta.url),'utf8');
const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');

test('public deployment evidence identifies environment and revision without exposing arbitrary values',()=>{
  assert.deepEqual(publicDeploymentEvidence({RAILWAY_ENVIRONMENT_NAME:'production',RAILWAY_GIT_COMMIT_SHA:'6f0f1541ace82c8852d09a75f4f897a59d549c7e'}),{environment:'production',revision:'6f0f1541ace8'});
  assert.deepEqual(publicDeploymentEvidence({RAILWAY_ENVIRONMENT_NAME:'PR Review',RAILWAY_GIT_COMMIT_SHA:'not-a-sha'}),{environment:'preview',revision:null});
  assert.deepEqual(publicDeploymentEvidence({}),{environment:'unknown',revision:null});
});

test('public health reports deployment evidence on success and failure',()=>{
  assert.match(server,/deployment:publicDeploymentEvidence\(\)/);
  assert.match(server,/import \{ publicDeploymentEvidence \} from '.\/deployment-evidence\.js'/);
});

test('repository declares one application and unambiguous public versus review domains',()=>{
  assert.match(readme,/One application, two deployment environments/);
  assert.match(readme,/https:\/\/caliof\.com/);
  assert.match(readme,/https:\/\/review\.caliof\.com/);
  assert.match(readme,/must not be used for Owner acceptance while its health check is failing/);
});
