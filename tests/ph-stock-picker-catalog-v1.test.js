import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PH_STOCK_PICKER_ADDITIONS,PH_STOCK_PICKER_EXTRA_GROUPS,PH_STOCK_PICKER_ALIASES,
  extendPhilippineStockPickerCatalog,searchPhilippineStockPicker,
  philippineStockPickerSafetyNote
} from '../public/ph-stock-picker-catalog.js';

const stockUi=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const markup=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const baseSource=stockUi.slice(
  stockUi.indexOf('const STOCK_PICKER_CATALOG=extendPhilippineStockPickerCatalog(')+
  'const STOCK_PICKER_CATALOG=extendPhilippineStockPickerCatalog('.length,
  stockUi.indexOf('\n]);\n\nconst STORAGE_CONDITION_LABELS')+2
);
// The extracted source is a repository-owned static array literal, not user CSV input.
const baseCatalog=Function('"use strict";return ('+baseSource+')')();
const norm=text=>String(text||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const expanded=extendPhilippineStockPickerCatalog(baseCatalog);
const all=expanded.flatMap(group=>group.items.map(([name,unit])=>({name,unit,category:group.category})));
const search=(q)=>searchPhilippineStockPicker(expanded,q,{limit:100});

test('base stock picker is preserved and receives 219 additive PH options',()=>{
  const before=JSON.stringify(baseCatalog);
  const second=extendPhilippineStockPickerCatalog(baseCatalog);
  assert.equal(JSON.stringify(baseCatalog),before,'base catalog must be immutable under extension');
  assert.equal(baseCatalog.length,17);
  assert.equal(all.length,377);
  assert.equal(expanded.length,21);
  assert.deepEqual(second,expanded);
  for(const base of baseCatalog){
    const result=expanded.find(x=>x.category===base.category);
    assert.ok(result,'missing existing category: '+base.category);
    assert.deepEqual(result.items.slice(0,base.items.length),base.items,
      'existing labels/units/order must remain unchanged');
  }
  assert.equal(Object.keys(PH_STOCK_PICKER_ADDITIONS).length,11);
  assert.equal(PH_STOCK_PICKER_EXTRA_GROUPS.length,4);
});

test('all visible products are unique and use canonical supported Inventory units',()=>{
  const names=all.map(x=>norm(x.name));
  assert.equal(new Set(names).size,names.length,'a duplicate suggestion could create a second stock entry');
  assert.ok(all.every(x=>x.name.length>1&&x.name.length<=100));
  for(const item of all){
    assert.ok(['kg','g','L','ml','unit'].includes(item.unit),'Invalid unit for '+item.name);
  }
});

test('Cavite and PH street-food basics missing from baseline are present',()=>{
  for(const item of [
    'Fish balls','Squid balls','Chicken balls','Kikiam','French fries',
    'Quail eggs','Cheese powder','Hot sauce','Small fish','Puso ng saging (banana blossom)',
    'Togue (mung bean sprouts)','Siling labuyo (bird\'s eye chili)',
    'Bihon (rice vermicelli)','Pork chicharon (crispy pork skin)','Cooked sago pearls',
    'Gulaman powder (agar)','Spiced vinegar (sukang sawsawan)','Cucumber (pipino)',
    'Sapsap (ponyfish)','Chicharon (pork cracklings)'
  ]){
    if(item==='Chicharon (pork cracklings)')continue; // standardized canonical option is pork chicharon
    assert.ok(all.some(x=>x.name===item),'Missing Filipino essential: '+item);
  }
});

test('Filipino/English aliases resolve to canonical options, never invent a new stock item',()=>{
  assert.equal(search('fishball')[0]?.name,'Fish balls');
  assert.equal(search('itlog pugo')[0]?.name,'Quail eggs');
  assert.ok(search('kwek kwek').some(x=>x.name==='Quail eggs'));
  assert.equal(search('sitaw')[0]?.name,'String beans');
  assert.equal(search('patis')[0]?.name,'Fish sauce');
  assert.ok(search('suka').some(x=>x.name==='Cane vinegar'));
  assert.ok(search('pancit puso').some(x=>x.name==='Puso ng saging (banana blossom)'));
  assert.ok(search('tahong').some(x=>x.name==='Mussels'));
  assert.ok(search('sago').some(x=>x.name==='Sago pearls (dry)'));
  assert.ok(search('gulaman').some(x=>x.name==='Gulaman powder (agar)'));
  assert.ok(Object.keys(PH_STOCK_PICKER_ALIASES).length>=35);
  assert.deepEqual(search('this-item-does-not-exist'),[]);
  assert.deepEqual(search(''),[]);
});

test('specialty groups have sensible handling suggestions without overriding human checks',()=>{
  const byName=Object.fromEntries(expanded.map(g=>[g.category,g]));
  assert.deepEqual(
    {condition:byName['Street-food frozen & ready-to-fry'].storage.condition,
     area:byName['Street-food frozen & ready-to-fry'].storage.area},
    {condition:'frozen',area:'freezer'}
  );
  assert.equal(byName['Palamig & merienda toppings'].storage.condition,'chilled');
  assert.equal(byName['Dried fish & crispy toppings'].storage.condition,'dry');
  assert.equal(byName['Cavite shellfish (check advisories)'].storage.condition,'chilled');
});

test('shellfish safety notice does not claim any particular 2026 ban is currently active',()=>{
  assert.match(philippineStockPickerSafetyNote('Mussels'),/BFAR/);
  assert.match(philippineStockPickerSafetyNote('Oysters (talaba)'),/Cavite/);
  assert.match(philippineStockPickerSafetyNote('Clams (halaan)'),/check current/);
  assert.equal(philippineStockPickerSafetyNote('Shrimp'),'');
  assert.equal(philippineStockPickerSafetyNote('Fish balls'),'');
});

test('new picker UI only fills existing purchase form; it never creates products or expenses on selection',()=>{
  assert.match(stockUi,/extendPhilippineStockPickerCatalog\(\[/);
  assert.match(stockUi,/searchPhilippineStockPicker\(STOCK_PICKER_CATALOG,query/);
  assert.match(stockUi,/option\.dataset\.unit=match\.unit/);
  assert.match(stockUi,/option\.dataset\.category=match\.category/);
  assert.match(stockUi,/syncUnitSelect\('stockPurchaseUnit',unit\)/);
  assert.match(stockUi,/philippineStockPickerSafetyNote\(name\)/);
  const start=stockUi.indexOf('function initStockPicker(){');
  const end=stockUi.indexOf('function unitMeta(',start);
  const scope=stockUi.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.doesNotMatch(scope,/api\(|fetch\(|\/api\/inventory\/purchase|\/api\/transactions|localStorage/);
  assert.match(markup,/id="stockPickerSearch"/);
  assert.match(markup,/id="stockPickerSearchStatus"/);
  assert.match(markup,/id="stockPickerLocalSafetyNote"/);
  assert.ok(markup.indexOf('id="stockPickerSearch"')>markup.indexOf('id="stockForm"'));
});
