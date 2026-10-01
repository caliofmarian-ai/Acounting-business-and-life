import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');

test('Inventory purchase form has category and item pickers',()=>{
  assert.match(html,/id="stockCategoryPicker"/);
  assert.match(html,/id="stockItemPicker"/);
  assert.match(html,/Choose an item from the lists/);
});

test('Stock picker includes Filipino restaurant ingredient categories',()=>{
  for(const category of [
    'Meat & poultry','Fish & seafood','Vegetables & herbs','Fruit & citrus',
    'Rice, noodles & dry goods','Sauces, condiments & seasonings',
    'Eggs, dairy & canned milk','Cooking oils & fats',
    'Wrappers, canned & packaged ingredients','Takeout & delivery packaging','Disposable service items','Kitchen prep consumables','Cleaning & sanitation','Food handling & hygiene','Storage & organization supplies','Front counter & operations'
  ]) assert.match(ui,new RegExp(category.replace(/[&]/g,'\\&')));
});

test('Choosing a stock item prefills name and units but keeps custom entry available',()=>{
  assert.match(ui,/\$\('stockItem'\)\.value=option\.value/);
  assert.match(ui,/syncUnitSelect\('stockPurchaseUnit',unit\)/);
  assert.match(ui,/syncUnitSelect\('stockReorderUnit',unit\)/);
  assert.match(html,/type your own item below/);
});
