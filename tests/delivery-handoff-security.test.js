import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HANDOFF_MAX_FAILED_ATTEMPTS,
  HANDOFF_LOCK_MS,
  handoffLockActive,
  nextHandoffFailureState
} from '../delivery-handoff-security.js';

test('handoff allows four failed attempts before lock',()=>{
  const now=Date.parse('2026-09-26T05:00:00.000Z');
  let state={failedAttempts:0,lockedUntil:null};
  for(let i=1;i<HANDOFF_MAX_FAILED_ATTEMPTS;i++){
    state=nextHandoffFailureState({...state,now});
    assert.equal(state.failedAttempts,i);
    assert.equal(state.locked,false);
    assert.equal(state.attemptsRemaining,HANDOFF_MAX_FAILED_ATTEMPTS-i);
  }
});

test('fifth failed handoff attempt starts the 15 minute lock',()=>{
  const now=Date.parse('2026-09-26T05:00:00.000Z');
  const state=nextHandoffFailureState({
    failedAttempts:HANDOFF_MAX_FAILED_ATTEMPTS-1,
    now
  });
  assert.equal(state.failedAttempts,HANDOFF_MAX_FAILED_ATTEMPTS);
  assert.equal(state.locked,true);
  assert.equal(state.attemptsRemaining,0);
  assert.equal(Date.parse(state.lockedUntil),now+HANDOFF_LOCK_MS);
  assert.equal(handoffLockActive(state.lockedUntil,now+1),true);
});

test('active handoff lock remains locked without adding attempts',()=>{
  const now=Date.parse('2026-09-26T05:00:00.000Z');
  const lockedUntil=new Date(now+HANDOFF_LOCK_MS).toISOString();
  const state=nextHandoffFailureState({
    failedAttempts:HANDOFF_MAX_FAILED_ATTEMPTS,
    lockedUntil,
    now:now+1000
  });
  assert.equal(state.failedAttempts,HANDOFF_MAX_FAILED_ATTEMPTS);
  assert.equal(state.locked,true);
  assert.equal(state.lockedUntil,lockedUntil);
});

test('expired handoff lock starts a fresh attempt window',()=>{
  const now=Date.parse('2026-09-26T05:20:00.000Z');
  const state=nextHandoffFailureState({
    failedAttempts:HANDOFF_MAX_FAILED_ATTEMPTS,
    lockedUntil:'2026-09-26T05:15:00.000Z',
    now
  });
  assert.equal(state.failedAttempts,1);
  assert.equal(state.locked,false);
  assert.equal(state.lockedUntil,null);
  assert.equal(state.attemptsRemaining,HANDOFF_MAX_FAILED_ATTEMPTS-1);
});
