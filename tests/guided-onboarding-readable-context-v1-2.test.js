import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const guide=read('public/guided-onboarding.js');
const css=read('public/guided-onboarding.css');

test('interactive form guidance reserves reading room and prefers the coach after the field',()=>{
  assert.match(guide,/function targetNeedsReadingRoom\(target\)/);
  assert.match(guide,/function guidanceContextTarget\(target\)/);
  assert.match(guide,/target\.closest\?\.\('label'\)/);
  assert.match(guide,/positionGuidance\(guidanceContextTarget\(target\)/);
  assert.match(guide,/input,textarea,select,\[contenteditable="true"\]/);
  assert.match(guide,/readingRoom\?['"]bottom['"]/);
  assert.match(guide,/scroll&&\(readingRoom\|\|!targetSufficientlyVisible/);
  assert.match(guide,/scrollIntoView\(\{block:'center'/);
});

test('guided spotlight keeps surrounding page legible while preserving focus and interaction',()=>{
  assert.match(css,/rgba\(8,19,33,\.24\)/);
  assert.doesNotMatch(css,/rgba\(8,19,33,\.62\)/);
  assert.match(css,/\.guidedSpotlight[^}]*pointer-events:none/);
  assert.match(css,/\.guidedCoach[^}]*pointer-events:auto/);
  assert.match(guide,/coach\.dataset\.noOverlap/);
});
