import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAppBackController} from '../public/app-back-navigation.js';

function harness(){
  let states=[{prior:'browser-origin'}],at=0;
  const listeners=[],restored=[],exitCalls=[];
  const context={authenticated:true,accountId:10,activeRole:'merchant'};
  const history={
    get state(){return states[at]},
    replaceState(state){states[at]=structuredClone(state)},
    pushState(state){states=states.slice(0,at+1);states.push(structuredClone(state));at++},
    back(){if(at===0)return;at--;for(const fn of listeners)fn({state:structuredClone(states[at])})}
  };
  const nav=createAppBackController({
    history,subscribePop:fn=>listeners.push(fn),getContext:()=>context,
    restore:async route=>{restored.push(route);return true},
    onExit:actions=>exitCalls.push(actions)
  });
  return {nav,context,history,restored,exitCalls,position:()=>at,length:()=>states.length};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('Android Back visits the previous in-app screen before attempting to leave',async()=>{
  const h=harness();
  h.nav.begin({kind:'account-home'});
  h.nav.record({kind:'profile-home',role:'merchant'});
  h.nav.record({kind:'feature-workspace',role:'merchant',workspaceId:'ordersWorkspace'});
  h.history.back();await tick();
  assert.deepEqual(h.restored.at(-1),{kind:'profile-home',role:'merchant'});
  h.history.back();await tick();
  assert.deepEqual(h.restored.at(-1),{kind:'account-home'});
  assert.equal(h.exitCalls.length,0);
  h.history.back();
  assert.equal(h.exitCalls.length,1,'only at true root do we offer Leave or Stay');
  assert.equal(h.nav.getState().exitPending,true);
  assert.equal(h.exitCalls[0].stay(),true);
  assert.equal(h.nav.getState().exitPending,false);
});
test('repeated equivalent screen render does not bloat the browser stack',()=>{
  const h=harness();h.nav.begin({kind:'account-home'});
  const length=h.length();
  assert.equal(h.nav.record({kind:'account-home'}),false);
  assert.equal(h.nav.record({kind:'account-home'}),false);
  assert.equal(h.length(),length);
});
test('profile switch never restores an older protected role via browser Back',async()=>{
  const h=harness();h.nav.begin({kind:'account-home'});
  h.nav.record({kind:'profile-home',role:'merchant'});
  h.context.activeRole='supplier';
  h.nav.syncContext();
  h.nav.record({kind:'feature-workspace',role:'supplier',workspaceId:'supWorkspace'});
  h.history.back();await tick();
  assert.deepEqual(h.restored.at(-1),{kind:'account-home'});
  h.history.back();await tick();
  assert.deepEqual(h.restored.at(-1),{kind:'account-home'});
});
test('business context invalidation refuses to reopen the previous feature',async()=>{
  const h=harness();h.nav.begin({kind:'account-home'});
  h.nav.record({kind:'feature-workspace',role:'merchant',workspaceId:'ordersWorkspace'});
  h.nav.invalidate();
  h.nav.record({kind:'feature-workspace',role:'merchant',workspaceId:'marketWorkspace'});
  h.history.back();await tick();
  assert.deepEqual(h.restored.at(-1),{kind:'account-home'});
});
test('sign-out disables application route restoration',async()=>{
  const h=harness();h.nav.begin({kind:'account-home'});
  h.nav.record({kind:'profile-home',role:'merchant'});
  h.context.authenticated=false;h.nav.syncContext();
  h.history.back();await tick();
  assert.equal(h.restored.length,0);
});
test('source hooks are explicit, with no global link-click hijack or location reload',()=>{
  const shell=readFileSync(new URL('../public/shell.js',import.meta.url),'utf8');
  assert.match(shell,/createAppBackController/);
  assert.match(shell,/appBackController\.record\(\{kind:'account-home'\}\)/);
  assert.match(shell,/appBackController\.record\(\{kind:'feature-workspace',workspaceId,role:activeRole\}\)/);
  assert.match(shell,/appBackController\.record\(\{kind:'profile-home',role:activeRole\}\)/);
  assert.match(shell,/appBackController\.record\(\{kind:'account-settings',view\}\)/);
  assert.match(shell,/appNavigationBack/);
  assert.doesNotMatch(shell,/document\.addEventListener\('click',[^\n]+history\.pushState/);
});
