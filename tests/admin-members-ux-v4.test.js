import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ui=read('public/admin-console.js');
const css=read('public/admin-console.css');

test('Members UX V4 uses progressive detail disclosure instead of a flat wall of sections',()=>{
  assert.match(ui,/function memberDisclosure/);
  assert.match(ui,/class="memberDisclosure/);
  assert.match(ui,/id:'memberOverviewSection'/);
  assert.match(ui,/id:'memberProfilesSection'/);
  assert.match(ui,/id:'memberContextSection'/);
  assert.match(ui,/id:'memberNotesSection'/);
  assert.match(ui,/id:'memberActivitySection'/);
  assert.match(ui,/open:true/);
  assert.match(ui,/memberDetailWorkspace/);
  assert.match(ui,/memberDetailRail/);
});

test('Members UX V4 provides compact section navigation and opens a target disclosure',()=>{
  assert.match(ui,/class="memberDetailNav"/);
  assert.match(ui,/data-member-jump="memberOverviewSection"/);
  assert.match(ui,/data-member-jump="memberProfilesSection"/);
  assert.match(ui,/data-member-jump="memberActivitySection"/);
  assert.match(ui,/target\.tagName==='DETAILS'/);
  assert.match(ui,/target\.open=true/);
  assert.match(ui,/scrollIntoView\(\{behavior:'smooth',block:'start'\}\)/);
});

test('Members directory V4 keeps search filters paging and clear member hierarchy',()=>{
  assert.match(ui,/memberDirectoryHeader/);
  assert.match(ui,/memberScopePill/);
  assert.match(ui,/memberInsightsV6/);
  assert.match(ui,/memberSearchPrimary/);
  assert.match(ui,/memberFilterGridV4/);
  assert.match(ui,/Name, email, Account ID or Personal ID/);
  assert.match(ui,/data-member-page="prev"/);
  assert.match(ui,/data-member-page="next"/);
  assert.match(ui,/memberAvatarSmall/);
  assert.match(ui,/Open member/);
  assert.match(ui,/Private addresses, passwords, sessions, IP data and uploaded evidence are not exposed here/);
});

test('Members UX V4 preserves V1-V3 sensitive action and permission-gated UI hooks',()=>{
  assert.match(ui,/id="memberStatusForm"/);
  assert.match(ui,/id="memberSessionsForm"/);
  assert.match(ui,/id="memberNoteForm"/);
  assert.match(ui,/id="memberTagForm"/);
  assert.match(ui,/data-member-remove-tag/);
  assert.match(ui,/data-member-support-ticket/);
  assert.match(ui,/data-member-trust-case/);
  assert.match(ui,/if\(!context\?\.available\)return''/);
  assert.match(ui,/memberControlDisclosure/);
  assert.match(ui,/Reason \+ confirmation \+ audit are required/);
});

test('Members UX V4 responsive CSS follows Figma hierarchy and mobile-first safety',()=>{
  assert.match(css,/ADMIN MEMBERS UX V4/);
  assert.match(css,/\.memberRowV4\{display:grid/);
  assert.match(css,/\.memberDetailWorkspace\{display:grid;grid-template-columns:minmax\(0,1fr\) 310px/);
  assert.match(css,/\.memberDisclosure>summary/);
  assert.match(css,/\.memberSecurityCard/);
  assert.match(css,/@media\(max-width:980px\)/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/\.memberRowV4\{grid-template-columns:42px minmax\(0,1fr\)\}/);
  assert.match(css,/\.memberRowEnd button\{width:100%\}/);
  assert.match(css,/\.memberDetailNav\{display:flex;gap:6px;overflow-x:auto/);
});

test('Members UX V4 keeps high-impact controls visually separate from ordinary data',()=>{
  assert.match(ui,/HIGH-IMPACT ACTIONS/);
  assert.match(ui,/Account controls/);
  assert.match(css,/\.memberControlDisclosure/);
  assert.match(css,/\.memberDangerZone\.memberControlDisclosure/);
});
