import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const server=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('Inventory has explicit operational stock types',()=>{
  assert.match(server,/inventory_type TEXT NOT NULL DEFAULT 'ingredient'/);
  assert.match(server,/packaging/);
  assert.match(server,/kitchen_consumable/);
  assert.match(server,/cleaning_sanitation/);
  assert.match(server,/hygiene/);
  assert.match(server,/operational_supply/);
  assert.match(html,/id="stockInventoryType"/);
});

test('Categorized picker assigns inventory type and sends it with purchase',()=>{
  assert.match(ui,/type:'packaging'/);
  assert.match(ui,/type:'cleaning_sanitation'/);
  assert.match(ui,/type:'hygiene'/);
  assert.match(ui,/inventory_type:\$\('stockInventoryType'\)\.value/);
});

test('Recipe picker and server accept ingredients only',()=>{
  assert.match(ui,/inventory\.filter\(i=>\(i\.inventory_type\|\|'ingredient'\)==='ingredient'\)/);
  assert.match(server,/Only Inventory items classified as Ingredient can be used in recipes/);
});
