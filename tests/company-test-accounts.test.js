import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COMPANY_TEST_ACCOUNTS,
  companyTestAccountForEmail,
  companyTestProfileRole,
  withCompanyTestAccountPolicy
} from '../company-test-accounts.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('only the nine controlled company aliases are classified as test accounts',()=>{
  assert.equal(Object.keys(COMPANY_TEST_ACCOUNTS).length,9);
  assert.equal(companyTestAccountForEmail(' DROPi.Deliveries+TestCustomer@gmail.com ').role,'customer');
  assert.equal(companyTestAccountForEmail('dropi.deliveries+testsuperadmin@gmail.com').role,'super_admin');
  assert.equal(companyTestAccountForEmail('person+testcustomer@gmail.com'),null);
  assert.equal(companyTestAccountForEmail('dropi.deliveries@gmail.com'),null);
});

test('company test accounts expose company contact policy without invented personal data',()=>{
  const previousPhone=process.env.BUSINESS_LIFE_COMPANY_PHONE;
  const previousAddress=process.env.BUSINESS_LIFE_COMPANY_ADDRESS;
  process.env.BUSINESS_LIFE_COMPANY_PHONE='';
  process.env.BUSINESS_LIFE_COMPANY_ADDRESS='';
  try{
    const snapshot=withCompanyTestAccountPolicy({account:{
      account_mode:'company_test',test_role:'customer',email:'dropi.deliveries+testcustomer@gmail.com',
      phone:'invented personal phone',address:'invented personal address'
    }});
    assert.equal(snapshot.account.is_test_account,true);
    assert.equal(snapshot.account.managed_by,'Business & Life');
    assert.equal(snapshot.account.phone,'');
    assert.equal(snapshot.account.address,'');
    assert.equal(snapshot.account.contact_source,'company');
    assert.equal(snapshot.account.contact_requirements.personal_phone_required,false);
    assert.equal(snapshot.account.contact_requirements.personal_address_required,false);
  }finally{
    if(previousPhone===undefined)delete process.env.BUSINESS_LIFE_COMPANY_PHONE;else process.env.BUSINESS_LIFE_COMPANY_PHONE=previousPhone;
    if(previousAddress===undefined)delete process.env.BUSINESS_LIFE_COMPANY_ADDRESS;else process.env.BUSINESS_LIFE_COMPANY_ADDRESS=previousAddress;
  }
});

test('operational test accounts are restricted to their assigned profile role',()=>{
  assert.equal(companyTestProfileRole('customer'),'customer');
  assert.equal(companyTestProfileRole('service_provider'),'service_provider');
  assert.equal(companyTestProfileRole('super_admin'),null);
});

test('registration, activation, governance and Account Settings enforce the test-account policy',()=>{
  const server=read('server-auth.js'),authHardening=read('server-auth-hardening.js'),governance=read('server-profile-governance.js'),schema=read('company-test-accounts.js'),shell=read('public/shell.js'),css=read('public/shell.css');
  assert.match(schema,/account_mode='company_test'/);
  assert.match(schema,/SET phone='', address=''/);
  assert.match(schema,/p\.role<>a\.test_role/);
  assert.match(schema,/personal_phone_required:false/);
  assert.match(schema,/personal_address_required:false/);
  assert.match(server,/const companyTest = companyTestAccountForEmail\(email\)/);
  assert.match(server,/const phone = companyTest \? ''/);
  assert.match(server,/if\(!companyTest&&!clean\(a\.address,300\)\)/);
  assert.match(server,/companyTest\?companyTestContact\(\)\.address:a\.address/);
  assert.match(server,/reserved for \$\{classified\.test_role/);
  assert.match(authHardening,/companyTestAccountForEmail\(email\)/);
  assert.match(authHardening,/companyTest\.role !== 'super_admin'/);
  assert.match(authHardening,/phone=CASE WHEN \$5='company_test' THEN '' ELSE phone END/);
  assert.match(authHardening,/address=CASE WHEN \$5='company_test' THEN '' ELSE address END/);
  assert.match(governance,/requireAssignedTestRole/);
  assert.match(governance,/That company test alias is reserved for/);
  assert.match(shell,/COMPANY TEST ACCOUNT/);
  assert.match(shell,/No personal phone or home address is required/);
  assert.match(shell,/Personal phone<\/span><strong>Not required/);
  assert.match(shell,/accountDetailsReady/);
  assert.match(css,/\.companyTestNotice/);
});
