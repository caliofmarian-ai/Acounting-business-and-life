import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  PH_PSGC_SOURCE,
  PH_PSGC_SNAPSHOT,
  PH_PSGC_EXPECTED_COUNTS,
  loadBundledPhPsgcRows,
  validatePhPsgcRows,
  normalizePsgcCode,
  normalizePsgcLevel,
  territoryTypeForPsgcLevel,
  parsePhPsgcWorkbook,
  summarizePhPsgcRows
} from '../ph-geographic-registry.js';

test('PH PSGC source is pinned to the official 2Q 2026 publication',()=>{
  assert.equal(PH_PSGC_SOURCE.version,'2026-06-30');
  assert.equal(PH_PSGC_SOURCE.authority,'Philippine Statistics Authority (PSA)');
  assert.match(PH_PSGC_SOURCE.landing_url,/psa\.gov\.ph\/classification\/psgc/);
  assert.match(PH_PSGC_SOURCE.publication_url,/PSGC-2Q-2026-Publication-Datafile\.xlsx/);
});

test('bundled Q2 2026 snapshot is pinned and validates against PSA release totals',async()=>{
  assert.equal(PH_PSGC_SNAPSHOT.package,'@ianlabicani/geoph-lite');
  assert.equal(PH_PSGC_SNAPSHOT.package_version,'2.0.0');
  assert.equal(PH_PSGC_SNAPSHOT.source_version,'2026-06-30');
  const rows=await loadBundledPhPsgcRows();
  const counts=validatePhPsgcRows(rows,{strictVersion:true});
  for(const [level,expected] of Object.entries(PH_PSGC_EXPECTED_COUNTS))assert.equal(counts[level],expected,level);
  assert.equal(rows.find(x=>x.psgc_code==='0402103000')?.name,'City of Bacoor');
  assert.equal(rows.find(x=>x.psgc_code==='1102324000')?.name,'Sawata');
});

test('PSGC code and geographic-level normalization preserve official identifiers',()=>{
  assert.equal(normalizePsgcCode('0402103000'), '0402103000');
  assert.equal(normalizePsgcCode(402103000), '0402103000');
  assert.equal(normalizePsgcLevel('Reg'),'region');
  assert.equal(normalizePsgcLevel('Prov'),'province');
  assert.equal(normalizePsgcLevel('Mun'),'municipality');
  assert.equal(normalizePsgcLevel('Bgy'),'barangay');
  assert.equal(normalizePsgcLevel('SubMun'),'submunicipality');
  assert.equal(normalizePsgcLevel('SGU'),'special_geographic_unit');
  assert.equal(territoryTypeForPsgcLevel('SubMun'),'district');
  assert.equal(territoryTypeForPsgcLevel('SGU'),'district');
});

test('workbook parser finds headers, preserves leading zeroes and derives PH hierarchy',async()=>{
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet('PSGC');
  ws.addRow(['Philippine Standard Geographic Code']);
  ws.addRow([]);
  ws.addRow(['10-digit PSGC','Name','Correspondence Code','Geographic Level','Old Name','City Class','Income Classification']);
  ws.addRow(['0400000000','CALABARZON','040000000','Reg','','','']);
  ws.addRow(['0402100000','Cavite','042100000','Prov','','','']);
  ws.addRow(['0402103000','City of Bacoor','042103000','City','','Component City','1st Class']);
  ws.addRow(['0402103001','Alima','042103001','Bgy','','','']);
  const buf=await wb.xlsx.writeBuffer();
  const rows=await parsePhPsgcWorkbook(Buffer.from(buf));
  assert.equal(rows.length,4);
  const region=rows.find(x=>x.psgc_code==='0400000000');
  const province=rows.find(x=>x.psgc_code==='0402100000');
  const city=rows.find(x=>x.psgc_code==='0402103000');
  const barangay=rows.find(x=>x.psgc_code==='0402103001');
  assert.equal(region.parent_psgc_code,'');
  assert.equal(province.parent_psgc_code,'0400000000');
  assert.equal(city.parent_psgc_code,'0402100000');
  assert.equal(barangay.parent_psgc_code,'0402103000');
  assert.equal(city.path_text,'CALABARZON › Cavite › City of Bacoor');
  assert.equal(barangay.path_text,'CALABARZON › Cavite › City of Bacoor › Alima');
  assert.deepEqual(
    Object.fromEntries(Object.entries(summarizePhPsgcRows(rows)).filter(([k])=>['region','province','city','barangay'].includes(k))),
    {region:1,province:1,city:1,barangay:1}
  );
});

test('governance server opens official administrative territories from PSGC, not client-entered names',()=>{
  const server=fs.readFileSync(new URL('../server-profile-governance.js',import.meta.url),'utf8');
  assert.match(server,/\/api\/governance\/admin\/geography\/status/);
  assert.match(server,/\/api\/governance\/admin\/geography\/search/);
  assert.match(server,/\/api\/governance\/admin\/geography\/sync/);
  assert.match(server,/resolvePhGeographicUnit\(pool,psgcCode\)/);
  assert.match(server,/territory_created_from_psgc/);
  assert.match(server,/Official PH administrative territories must be selected from the PSGC registry/);
  assert.match(server,/process\.env\.APP_ENV==='qa'\|\|process\.env\.NODE_ENV==='test'/);
});

test('Admin Territories UI searches and browses PSGC instead of typing official names and codes',()=>{
  const ui=fs.readFileSync(new URL('../public/admin-console.js',import.meta.url),'utf8');
  assert.match(ui,/id="territoryGeoSearchForm"/);
  assert.match(ui,/\/api\/governance\/admin\/geography\/search/);
  assert.match(ui,/\/api\/governance\/admin\/geography\/sync/);
  assert.match(ui,/name="psgc_code"/);
  assert.match(ui,/Reference geography ≠ operating territory/);
  assert.doesNotMatch(ui,/placeholder="Actual territory name"/);
  assert.doesNotMatch(ui,/placeholder="Internal territory code"/);
});
