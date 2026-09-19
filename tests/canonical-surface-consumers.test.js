import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const roleModules=[
  'public/delivery-ui.js','public/orders-ui.js','public/marketplace-ui.js',
  'public/services-ui.js','public/suppliers-ui.js','public/profile-money-ui.js',
  'public/financial-documents-ui.js','public/business-accounting-ui.js'
];

test('authentication stores only the session token and never a navigation role',()=>{
  for(const path of ['public/auth-ui.js','public/auth-hardening-ui.js']){
    const source=read(path);
    assert.doesNotMatch(source,/setItem\(['"]abl_active_role['"]/,path);
  }
});

test('profile modules require the canonical Profile surface before consuming activeRole',()=>{
  for(const path of roleModules){
    const source=read(path);
    assert.match(source,/surface\s*===?\s*['"]profile['"]/,path);
    assert.doesNotMatch(source,/activeRole\s*\|\|\s*(?:state\.)?snapshot\?\.account\?\.active_role/,path);
    assert.doesNotMatch(source,/(?:delMe|orderMe|marketMe|svcMe|supMe)\?\.account\?\.active_role/,path);
  }
});

test('feature modules no longer maintain private identity fetch fallbacks',()=>{
  for(const path of roleModules.slice(0,5)){
    const source=read(path);
    assert.doesNotMatch(source,/await\s+[a-z]?api\(['"]\/api\/me['"]\)/,path);
  }
});

test('Account Home cannot be replaced by the non-owner Merchant migration notice',()=>{
  const auth=read('public/auth-ui.js');
  assert.match(auth,/state\.surface!==['"]profile['"]/);
  assert.match(auth,/state\.activeRole!==['"]merchant['"]/);
});
