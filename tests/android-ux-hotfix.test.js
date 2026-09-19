import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fdUi=read('public/financial-documents-ui.js');
const authUi=read('public/auth-hardening-ui.js');
const authServer=read('server-auth-hardening.js');
const supportUi=read('public/admin-operations-ui.js');
const supportServer=read('server-admin-operations.js');
const supportCss=read('public/admin-operations.css');
const pkg=read('package.json');

test('Statements & Documents closes Avatar overlay before opening the workspace',()=>{
  assert.match(fdUi,/profileDrawerBackdrop/);
  assert.match(fdUi,/classList\.add\('hidden'\)/);
  assert.match(fdUi,/document\.body\.style\.overflow=''/);
  const openIndex=fdUi.indexOf("document.getElementById('profileDrawerBackdrop')");
  const showIndex=fdUi.indexOf("fdWorkspace.classList.remove('hidden')");
  assert.ok(openIndex>=0&&showIndex>openIndex);
});

test('Account protection rendering is race-safe and cannot append duplicate cards',()=>{
  assert.match(authUi,/authSecurityDecorating/);
  assert.match(authUi,/panel\.querySelectorAll\('\.authUpgradeCard'\)/);
  assert.match(authUi,/raced\.length/);
  assert.match(authUi,/raced\.slice\(1\)\.forEach\(x=>x\.remove\(\)\)/);
});

test('email verification reports real external delivery state',()=>{
  assert.match(authServer,/delivery_status/);
  assert.match(authServer,/not_configured/);
  assert.match(authServer,/The verification request was not emailed/);
  assert.match(authUi,/Verification email sent\. Check your inbox and spam folder/);
  assert.match(authUi,/Email delivery is not configured yet/);
  assert.match(authUi,/preview_verify_url/);
});

test('Support message composer contains voice and translation controls in one writing surface',()=>{
  assert.match(supportUi,/supportComposer/);
  assert.match(supportUi,/supportDescription/);
  assert.match(supportUi,/voiceStart/);
  assert.match(supportUi,/translateEnglish/);
  assert.match(supportUi,/Your message/);
  assert.match(supportUi,/English for Support\/Admin/);
  assert.match(supportCss,/\.supportComposer/);
  assert.match(supportCss,/\.supportComposerTools/);
});

test('Support voice uses browser acceleration plus server transcription fallback',()=>{
  assert.match(supportUi,/SpeechRecognition/);
  assert.match(supportUi,/MediaRecorder/);
  assert.match(supportUi,/\/api\/support\/assist\/transcribe/);
  assert.match(supportUi,/finalizeVoiceRecording/);
  assert.match(supportUi,/Server transcription is unavailable/);
  assert.match(supportServer,/\/api\/support\/assist\/status/);
  assert.match(supportServer,/\/api\/support\/assist\/transcribe/);
  assert.match(supportServer,/SUPPORT_AI_NOT_CONFIGURED/);
});

test('Support English translation is server-capable and retains browser fallback',()=>{
  assert.match(supportUi,/\/api\/support\/assist\/translate/);
  assert.match(supportUi,/Translator/);
  assert.match(supportUi,/LanguageDetector/);
  assert.match(supportServer,/translateSupportText/);
  assert.match(supportServer,/store:false/);
  assert.match(supportServer,/Preserve names, numbers, order IDs, URLs, amounts and technical terms/);
});

test('Support AI credentials are environment-only and never hardcoded',()=>{
  assert.match(supportServer,/process\.env\.OPENAI_API_KEY/);
  assert.match(supportServer,/process\.env\.SUPPORT_AI_PROVIDER/);
  assert.doesNotMatch(supportServer,/sk-[A-Za-z0-9_-]{12,}/);
});

test('package syntax contract covers Android hotfix regression checks',()=>{
  assert.match(pkg,/node --check tests\/android-ux-hotfix\.test\.js/);
});
