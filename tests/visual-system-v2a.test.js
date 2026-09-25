import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../public/shell.css',import.meta.url),'utf8');

test('Visual System V2A gives shared profile homes a coherent premium surface language',()=>{
  assert.match(css,/Visual System V2A — shared profile home polish/);
  for(const root of ['customerHomePanel','courierHomePanel','serviceProviderPanel']){
    assert.match(css,new RegExp('\\.'+root+'\\{[^}]*--profile-ui-accent'));
  }
  for(const section of ['customerHomeSection','courierHomeSection','serviceProviderHomeSection']){
    assert.match(css,new RegExp('\\.'+section));
  }
  assert.match(css,/\.customerActionCard,\s*\.customerShopCard,\s*\.serviceProviderActionCard\{/);
  assert.match(css,/\.customerMoneySnapshot>div,\s*\.courierMoneySnapshot>div,\s*\.serviceProviderMoneySnapshot>div\{/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('Visual System V2A preserves narrow Android layouts and explicit keyboard focus',()=>{
  assert.match(css,/@media\(max-width:420px\)/);
  assert.match(css,/\.customerActionCard:focus-visible/);
  assert.match(css,/\.serviceProviderHomeWorkRow:focus-visible/);
  assert.match(css,/outline:3px solid var\(--profile-ui-accent\)/);
});
