import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSessionBootstrap} from '../session-bootstrap-core.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('bootstrap always starts an authenticated person on Account Home',()=>{
  const result=buildSessionBootstrap({account:{id:7,active_role:'merchant'},profiles:[{role:'merchant',profile_id:'BL-ME-7',enabled:true,status:'active'}]},{is_admin:false,assignments:[],permissions:[]});
  assert.equal(result.initial_surface,'account');
  assert.equal(result.selected_profile_id,null);
  assert.equal(result.navigation.account,true);
  assert.deepEqual(result.navigation.profiles,[{role:'merchant',profile_id:'BL-ME-7',status:'active'}]);
  assert.equal(result.navigation.admin,false);
});

test('Admin navigation exists only for a current server assignment',()=>{
  const profile={account:{id:9},profiles:[]};
  const falseClaim=buildSessionBootstrap(profile,{is_admin:true,assignments:[],permissions:['admin.console']});
  assert.equal(falseClaim.navigation.admin,false);
  assert.deepEqual(falseClaim.admin,{is_admin:false,assignments:[],permissions:[]});
  const delegated=buildSessionBootstrap(profile,{is_admin:true,assignments:[{id:12,admin_role:'specialist'}],permissions:['support.manage']});
  assert.equal(delegated.navigation.admin,true);
  assert.equal(delegated.admin.assignments[0].id,12);
});

test('client state separates visible surface from stored legacy role',()=>{
  const shell=read('public/shell.js'),loader=read('public/mobile-feature-loader.js'),server=read('server-admin-operations.js');
  assert.match(server,/api\/session\/bootstrap/);
  assert.match(shell,/let activeSurface = 'account'/);
  assert.match(shell,/surface:activeSurface/);
  assert.match(shell,/activeRole:activeSurface==='profile'\?activeRole:null/);
  assert.match(loader,/surface!==['"]profile['"]/);
  assert.doesNotMatch(loader,/localStorage\.getItem\(['"]abl_active_role['"]\)/);
});
