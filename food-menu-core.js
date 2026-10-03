const FOOD_MENU_SCHEMA_VERSION='food-menu-v3-2026-10-03';
const MANILA_TIME_ZONE='Asia/Manila';
const MAX_MENU_SECTIONS=100;
const MAX_MENU_SCHEDULES=50;
const MAX_MODIFIER_OPTIONS=50;

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const positiveInt=value=>Number.isInteger(Number(value))&&Number(value)>0;
const codeFor=value=>clean(value,100).toLowerCase()
  .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,70);
const timeRe=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const money=value=>{
  const n=Number(value);
  if(!Number.isFinite(n)||n<0)throw new TypeError('Modifier price must be zero or greater.');
  return Math.round((n+Number.EPSILON)*100)/100;
};

export {
  FOOD_MENU_SCHEMA_VERSION,
  MANILA_TIME_ZONE,
  MAX_MENU_SECTIONS,
  MAX_MENU_SCHEDULES,
  MAX_MODIFIER_OPTIONS
};

export function manilaDayEnd(now=new Date()){
  const d=now instanceof Date?now:new Date(now);
  if(Number.isNaN(d.getTime()))throw new TypeError('A valid date is required.');
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:MANILA_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(d);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const utc=Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day)+1,0,0,0)-8*60*60*1000;
  return new Date(utc);
}

export function normalizeFoodAvailability(input={},now=new Date()){
  const state=clean(input.state||input.availability_state||'available',30).toLowerCase();
  if(!['available','sold_out_today','unavailable_until','hidden'].includes(state)){
    throw new TypeError('Availability must be Available, Sold out today, Unavailable until or Hidden.');
  }
  let until=null;
  if(state==='sold_out_today')until=manilaDayEnd(now);
  if(state==='unavailable_until'){
    until=new Date(input.until||input.availability_until||'');
    if(Number.isNaN(until.getTime())||until.getTime()<=new Date(now).getTime()){
      throw new TypeError('Choose a future time for temporary unavailability.');
    }
  }
  return{
    state,
    until:until?until.toISOString():null,
    note:clean(input.note||input.availability_note,180)
  };
}

export function effectiveFoodAvailability(row={},now=new Date()){
  const state=clean(row.availability_state||'available',30).toLowerCase()||'available';
  if(['sold_out_today','unavailable_until'].includes(state)&&row.availability_until){
    const until=new Date(row.availability_until);
    if(!Number.isNaN(until.getTime())&&until.getTime()<=new Date(now).getTime()){
      return{state:'available',until:null,note:'',orderable:true,hidden:false};
    }
  }
  return{
    state,
    until:row.availability_until||null,
    note:clean(row.availability_note,180),
    orderable:state==='available',
    hidden:state==='hidden'
  };
}

export function normalizeMenuConfiguration(input={}){
  const name=clean(input.name,100);
  if(!name)throw new TypeError('Menu name is required.');
  const code=codeFor(input.code||name);
  if(!code)throw new TypeError('Menu code is required.');
  const rawSchedules=Array.isArray(input.schedules)?input.schedules:[];
  const rawSections=Array.isArray(input.sections)?input.sections:[];
  if(rawSchedules.length>MAX_MENU_SCHEDULES)throw new TypeError(`A menu supports up to ${MAX_MENU_SCHEDULES} schedule windows.`);
  if(rawSections.length>MAX_MENU_SECTIONS)throw new TypeError(`A menu supports up to ${MAX_MENU_SECTIONS} sections.`);
  const schedules=rawSchedules.map((raw,index)=>{
    const day=Number(raw.day_of_week);
    const start=clean(raw.start_time,5),end=clean(raw.end_time,5);
    if(!Number.isInteger(day)||day<0||day>6)throw new TypeError('Menu schedule day must be between 0 and 6.');
    if(!timeRe.test(start)||!timeRe.test(end)||start===end)throw new TypeError('Menu schedule needs valid start and end times.');
    return{day_of_week:day,start_time:start,end_time:end,active:raw.active!==false,sort_order:index};
  });
  const sectionCodes=new Set();
  const sections=rawSections.map((raw,index)=>{
    const label=clean(raw.name,100);
    if(!label)throw new TypeError('Every menu section needs a name.');
    const sectionCode=codeFor(raw.code||label);
    if(!sectionCode||sectionCodes.has(sectionCode))throw new TypeError(`Menu section ${label} is duplicated.`);
    sectionCodes.add(sectionCode);
    const productIds=[...new Set((Array.isArray(raw.product_ids)?raw.product_ids:[])
      .map(Number).filter(positiveInt))];
    return{
      code:sectionCode,
      name:label,
      description:clean(raw.description,300),
      active:raw.active!==false,
      sort_order:index,
      product_ids:productIds
    };
  });
  return{
    name,code,
    active:input.active!==false,
    sort_order:Number.isInteger(Number(input.sort_order))?Number(input.sort_order):0,
    timezone:MANILA_TIME_ZONE,
    schedules,sections
  };
}

export function normalizeModifierGroupConfiguration(input={}){
  const name=clean(input.name,100);
  if(!name)throw new TypeError('Modifier group name is required.');
  const code=codeFor(input.code||name);
  if(!code)throw new TypeError('Modifier group code is required.');
  const min=Number(input.min_select??(input.required?1:0));
  const max=Number(input.max_select??1);
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<1||max>20||min>max){
    throw new TypeError('Modifier selection limits are invalid.');
  }
  const rawOptions=Array.isArray(input.options)?input.options:[];
  if(!rawOptions.length||rawOptions.length>MAX_MODIFIER_OPTIONS){
    throw new TypeError(`A modifier group needs 1–${MAX_MODIFIER_OPTIONS} options.`);
  }
  const optionCodes=new Set();
  const options=rawOptions.map((raw,index)=>{
    const label=clean(raw.name||raw.label,100);
    if(!label)throw new TypeError('Every modifier option needs a name.');
    const optionCode=codeFor(raw.code||label);
    if(!optionCode||optionCodes.has(optionCode))throw new TypeError(`Modifier option ${label} is duplicated.`);
    optionCodes.add(optionCode);
    return{
      code:optionCode,
      name:label,
      price_delta:money(raw.price_delta??0),
      active:raw.active!==false,
      sort_order:index
    };
  });
  const productIds=[...new Set((Array.isArray(input.product_ids)?input.product_ids:[])
    .map(Number).filter(positiveInt))];
  return{
    name,code,min_select:min,max_select:max,
    active:input.active!==false,
    sort_order:Number.isInteger(Number(input.sort_order))?Number(input.sort_order):0,
    options,product_ids:productIds
  };
}

function minuteOfDay(value){
  const [hour,minute]=String(value).slice(0,5).split(':').map(Number);
  return hour*60+minute;
}

export function scheduleWindowActive(schedule,{dayOfWeek,minute}={}){
  if(schedule?.active===false)return false;
  const day=Number(dayOfWeek),nowMinute=Number(minute);
  if(!Number.isInteger(day)||day<0||day>6||!Number.isFinite(nowMinute))return false;
  const scheduleDay=Number(schedule.day_of_week),start=minuteOfDay(schedule.start_time),end=minuteOfDay(schedule.end_time);
  if(start<end)return scheduleDay===day&&nowMinute>=start&&nowMinute<end;
  if(scheduleDay===day&&nowMinute>=start)return true;
  return ((scheduleDay+1)%7)===day&&nowMinute<end;
}

export function manilaClock(now=new Date()){
  const d=now instanceof Date?now:new Date(now);
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:MANILA_TIME_ZONE,weekday:'short',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(d);
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  const dayMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return{
    dayOfWeek:dayMap[values.weekday],
    minute:Number(values.hour)*60+Number(values.minute)
  };
}

export function menuScheduleActive(schedules=[],now=new Date()){
  const active=(Array.isArray(schedules)?schedules:[]).filter(schedule=>schedule.active!==false);
  if(!active.length)return true;
  const clock=manilaClock(now);
  return active.some(schedule=>scheduleWindowActive(schedule,clock));
}

export async function ensureFoodMenuSchema(db){
  await db.query(`
    ALTER TABLE marketplace_products
      ADD COLUMN IF NOT EXISTS availability_state TEXT NOT NULL DEFAULT 'available';
    ALTER TABLE marketplace_products
      ADD COLUMN IF NOT EXISTS availability_until TIMESTAMPTZ;
    ALTER TABLE marketplace_products
      ADD COLUMN IF NOT EXISTS availability_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE marketplace_products DROP CONSTRAINT IF EXISTS marketplace_products_availability_state_check;
    ALTER TABLE marketplace_products ADD CONSTRAINT marketplace_products_availability_state_check
      CHECK(availability_state IN ('available','sold_out_today','unavailable_until','hidden'));

    CREATE TABLE IF NOT EXISTS merchant_menus (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(business_id,code)
    );
    CREATE INDEX IF NOT EXISTS merchant_menus_business_idx
      ON merchant_menus(business_id,active,sort_order,id);

    CREATE TABLE IF NOT EXISTS merchant_menu_schedules (
      id BIGSERIAL PRIMARY KEY,
      menu_id BIGINT NOT NULL REFERENCES merchant_menus(id) ON DELETE CASCADE,
      day_of_week SMALLINT NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      CHECK(start_time<>end_time)
    );
    CREATE INDEX IF NOT EXISTS merchant_menu_schedules_menu_idx
      ON merchant_menu_schedules(menu_id,day_of_week,sort_order,id);

    CREATE TABLE IF NOT EXISTS merchant_menu_sections (
      id BIGSERIAL PRIMARY KEY,
      menu_id BIGINT NOT NULL REFERENCES merchant_menus(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(menu_id,code)
    );
    CREATE INDEX IF NOT EXISTS merchant_menu_sections_menu_idx
      ON merchant_menu_sections(menu_id,active,sort_order,id);

    CREATE TABLE IF NOT EXISTS merchant_menu_items (
      section_id BIGINT NOT NULL REFERENCES merchant_menu_sections(id) ON DELETE CASCADE,
      product_id BIGINT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY(section_id,product_id)
    );
    CREATE INDEX IF NOT EXISTS merchant_menu_items_product_idx
      ON merchant_menu_items(product_id,active,section_id);

    CREATE TABLE IF NOT EXISTS merchant_modifier_groups (
      id BIGSERIAL PRIMARY KEY,
      business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      min_select INTEGER NOT NULL DEFAULT 0 CHECK(min_select>=0),
      max_select INTEGER NOT NULL DEFAULT 1 CHECK(max_select>=1 AND max_select<=20),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK(min_select<=max_select),
      UNIQUE(business_id,code)
    );
    CREATE INDEX IF NOT EXISTS merchant_modifier_groups_business_idx
      ON merchant_modifier_groups(business_id,active,sort_order,id);

    CREATE TABLE IF NOT EXISTS merchant_modifier_options (
      id BIGSERIAL PRIMARY KEY,
      group_id BIGINT NOT NULL REFERENCES merchant_modifier_groups(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      price_delta NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK(price_delta>=0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(group_id,code)
    );
    CREATE INDEX IF NOT EXISTS merchant_modifier_options_group_idx
      ON merchant_modifier_options(group_id,active,sort_order,id);

    CREATE TABLE IF NOT EXISTS merchant_product_modifier_groups (
      product_id BIGINT NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
      group_id BIGINT NOT NULL REFERENCES merchant_modifier_groups(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      PRIMARY KEY(product_id,group_id)
    );
    CREATE INDEX IF NOT EXISTS merchant_product_modifier_groups_group_idx
      ON merchant_product_modifier_groups(group_id,active,product_id);

    ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS modifier_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
}

async function assertFoodProducts(db,businessId,productIds){
  const ids=[...new Set((productIds||[]).map(Number).filter(positiveInt))];
  if(!ids.length)return;
  const q=await db.query(`
    SELECT id FROM marketplace_products
     WHERE business_id=$1 AND product_domain='food' AND id=ANY($2::bigint[])
  `,[Number(businessId),ids]);
  if(q.rowCount!==ids.length)throw Object.assign(new Error('One or more menu products are not Food products in this business.'),{status:409});
}

export async function createFoodMenu(db,{businessId,configuration}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))throw new TypeError('A valid Merchant business is required.');
  const normalized=normalizeMenuConfiguration(configuration);
  const allProductIds=normalized.sections.flatMap(section=>section.product_ids);
  await assertFoodProducts(db,bid,allProductIds);
  const inserted=await db.query(`
    INSERT INTO merchant_menus(business_id,code,name,timezone,active,sort_order)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING id
  `,[bid,normalized.code,normalized.name,normalized.timezone,normalized.active,normalized.sort_order]);
  return replaceFoodMenu(db,{businessId:bid,menuId:Number(inserted.rows[0].id),configuration:normalized});
}

export async function replaceFoodMenu(db,{businessId,menuId,configuration}={}){
  const bid=Number(businessId),mid=Number(menuId);
  if(!positiveInt(bid)||!positiveInt(mid))throw new TypeError('A valid Merchant menu is required.');
  const normalized=normalizeMenuConfiguration(configuration);
  const allProductIds=normalized.sections.flatMap(section=>section.product_ids);
  await assertFoodProducts(db,bid,allProductIds);
  const owned=await db.query(`
    UPDATE merchant_menus
       SET code=$1,name=$2,timezone=$3,active=$4,sort_order=$5,updated_at=NOW()
     WHERE id=$6 AND business_id=$7
     RETURNING id
  `,[normalized.code,normalized.name,normalized.timezone,normalized.active,normalized.sort_order,mid,bid]);
  if(!owned.rowCount)throw Object.assign(new Error('Menu not found in this business.'),{status:404});
  await db.query('DELETE FROM merchant_menu_schedules WHERE menu_id=$1',[mid]);
  for(const schedule of normalized.schedules){
    await db.query(`
      INSERT INTO merchant_menu_schedules(menu_id,day_of_week,start_time,end_time,active,sort_order)
      VALUES($1,$2,$3,$4,$5,$6)
    `,[mid,schedule.day_of_week,schedule.start_time,schedule.end_time,schedule.active,schedule.sort_order]);
  }
  await db.query('DELETE FROM merchant_menu_sections WHERE menu_id=$1',[mid]);
  for(const section of normalized.sections){
    const saved=await db.query(`
      INSERT INTO merchant_menu_sections(menu_id,code,name,description,active,sort_order)
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING id
    `,[mid,section.code,section.name,section.description,section.active,section.sort_order]);
    const sectionId=Number(saved.rows[0].id);
    for(const [sortOrder,productId] of section.product_ids.entries()){
      await db.query(`
        INSERT INTO merchant_menu_items(section_id,product_id,sort_order,active)
        VALUES($1,$2,$3,TRUE)
      `,[sectionId,productId,sortOrder]);
    }
  }
  return readFoodMenu(db,{businessId:bid,menuId:mid,publicOnly:false});
}

export async function readFoodMenu(db,{businessId,menuId,publicOnly=false,now=new Date()}={}){
  const bid=Number(businessId),mid=Number(menuId);
  const q=await db.query(`
    SELECT id,business_id,code,name,timezone,active,sort_order
      FROM merchant_menus
     WHERE business_id=$1 AND id=$2 ${publicOnly?'AND active=TRUE':''}
  `,[bid,mid]);
  if(!q.rowCount)return null;
  const menu=q.rows[0];
  const schedules=await db.query(`
    SELECT id,day_of_week,start_time::text,end_time::text,active,sort_order
      FROM merchant_menu_schedules
     WHERE menu_id=$1 ${publicOnly?'AND active=TRUE':''}
     ORDER BY sort_order,id
  `,[mid]);
  const sections=await db.query(`
    SELECT id,code,name,description,active,sort_order
      FROM merchant_menu_sections
     WHERE menu_id=$1 ${publicOnly?'AND active=TRUE':''}
     ORDER BY sort_order,id
  `,[mid]);
  const sectionRows=[];
  for(const section of sections.rows){
    const items=await db.query(`
      SELECT mi.product_id,mi.sort_order,p.name,p.selling_price,p.availability_state,p.availability_until,p.availability_note
        FROM merchant_menu_items mi
        JOIN marketplace_products p ON p.id=mi.product_id AND p.business_id=$2
       WHERE mi.section_id=$1 AND mi.active=TRUE
         ${publicOnly?"AND p.published=TRUE AND p.active=TRUE AND p.availability_state<>'hidden'":''}
       ORDER BY mi.sort_order,p.id
    `,[section.id,bid]);
    sectionRows.push({
      ...section,
      id:Number(section.id),
      items:items.rows.map(row=>({
        ...row,product_id:Number(row.product_id),sort_order:Number(row.sort_order||0),
        availability:effectiveFoodAvailability(row,now)
      }))
    });
  }
  const scheduleRows=schedules.rows.map(row=>({
    ...row,id:Number(row.id),day_of_week:Number(row.day_of_week),sort_order:Number(row.sort_order||0),
    start_time:String(row.start_time).slice(0,5),end_time:String(row.end_time).slice(0,5)
  }));
  return{
    ...menu,id:Number(menu.id),business_id:Number(menu.business_id),sort_order:Number(menu.sort_order||0),
    schedules:scheduleRows,
    schedule_active:menuScheduleActive(scheduleRows,now),
    sections:sectionRows
  };
}

export async function readFoodMenus(db,{businessId,publicOnly=false,now=new Date()}={}){
  const bid=Number(businessId);
  const q=await db.query(`
    SELECT id FROM merchant_menus
     WHERE business_id=$1 ${publicOnly?'AND active=TRUE':''}
     ORDER BY sort_order,id
  `,[bid]);
  const menus=[];
  for(const row of q.rows){
    const menu=await readFoodMenu(db,{businessId:bid,menuId:Number(row.id),publicOnly,now});
    if(menu&&(!publicOnly||menu.schedule_active))menus.push(menu);
  }
  return menus;
}

export async function createModifierGroup(db,{businessId,configuration}={}){
  const bid=Number(businessId);
  if(!positiveInt(bid))throw new TypeError('A valid Merchant business is required.');
  const normalized=normalizeModifierGroupConfiguration(configuration);
  await assertFoodProducts(db,bid,normalized.product_ids);
  const inserted=await db.query(`
    INSERT INTO merchant_modifier_groups(business_id,code,name,min_select,max_select,active,sort_order)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
  `,[bid,normalized.code,normalized.name,normalized.min_select,normalized.max_select,normalized.active,normalized.sort_order]);
  return replaceModifierGroup(db,{businessId:bid,groupId:Number(inserted.rows[0].id),configuration:normalized});
}

export async function replaceModifierGroup(db,{businessId,groupId,configuration}={}){
  const bid=Number(businessId),gid=Number(groupId);
  if(!positiveInt(bid)||!positiveInt(gid))throw new TypeError('A valid modifier group is required.');
  const normalized=normalizeModifierGroupConfiguration(configuration);
  await assertFoodProducts(db,bid,normalized.product_ids);
  const owned=await db.query(`
    UPDATE merchant_modifier_groups
       SET code=$1,name=$2,min_select=$3,max_select=$4,active=$5,sort_order=$6,updated_at=NOW()
     WHERE id=$7 AND business_id=$8
     RETURNING id
  `,[normalized.code,normalized.name,normalized.min_select,normalized.max_select,normalized.active,normalized.sort_order,gid,bid]);
  if(!owned.rowCount)throw Object.assign(new Error('Modifier group not found in this business.'),{status:404});
  await db.query('DELETE FROM merchant_modifier_options WHERE group_id=$1',[gid]);
  for(const option of normalized.options){
    await db.query(`
      INSERT INTO merchant_modifier_options(group_id,code,name,price_delta,active,sort_order)
      VALUES($1,$2,$3,$4,$5,$6)
    `,[gid,option.code,option.name,option.price_delta,option.active,option.sort_order]);
  }
  await db.query('DELETE FROM merchant_product_modifier_groups WHERE group_id=$1',[gid]);
  for(const [sortOrder,productId] of normalized.product_ids.entries()){
    await db.query(`
      INSERT INTO merchant_product_modifier_groups(product_id,group_id,sort_order,active)
      VALUES($1,$2,$3,TRUE)
    `,[productId,gid,sortOrder]);
  }
  return readModifierGroup(db,{businessId:bid,groupId:gid,publicOnly:false});
}

export async function readModifierGroup(db,{businessId,groupId,publicOnly=false}={}){
  const bid=Number(businessId),gid=Number(groupId);
  const q=await db.query(`
    SELECT id,business_id,code,name,min_select,max_select,active,sort_order
      FROM merchant_modifier_groups
     WHERE id=$1 AND business_id=$2 ${publicOnly?'AND active=TRUE':''}
  `,[gid,bid]);
  if(!q.rowCount)return null;
  const options=await db.query(`
    SELECT id,code,name,price_delta,active,sort_order
      FROM merchant_modifier_options
     WHERE group_id=$1 ${publicOnly?'AND active=TRUE':''}
     ORDER BY sort_order,id
  `,[gid]);
  const products=await db.query(`
    SELECT product_id,sort_order,active
      FROM merchant_product_modifier_groups
     WHERE group_id=$1 ${publicOnly?'AND active=TRUE':''}
     ORDER BY sort_order,product_id
  `,[gid]);
  return{
    ...q.rows[0],
    id:Number(q.rows[0].id),business_id:Number(q.rows[0].business_id),
    min_select:Number(q.rows[0].min_select),max_select:Number(q.rows[0].max_select),sort_order:Number(q.rows[0].sort_order||0),
    options:options.rows.map(row=>({...row,id:Number(row.id),price_delta:Number(row.price_delta),sort_order:Number(row.sort_order||0)})),
    product_ids:products.rows.map(row=>Number(row.product_id))
  };
}

export async function readModifierGroups(db,{businessId,publicOnly=false}={}){
  const q=await db.query(`
    SELECT id FROM merchant_modifier_groups
     WHERE business_id=$1 ${publicOnly?'AND active=TRUE':''}
     ORDER BY sort_order,id
  `,[Number(businessId)]);
  const groups=[];
  for(const row of q.rows){
    const group=await readModifierGroup(db,{businessId,groupId:Number(row.id),publicOnly});
    if(group)groups.push(group);
  }
  return groups;
}

export async function modifierProjectionForProducts(db,{businessId,productIds=[],publicOnly=false}={}){
  const ids=[...new Set((productIds||[]).map(Number).filter(positiveInt))];
  const map=new Map(ids.map(id=>[id,[]]));
  if(!ids.length)return map;
  const links=await db.query(`
    SELECT x.product_id,x.sort_order,g.id group_id
      FROM merchant_product_modifier_groups x
      JOIN merchant_modifier_groups g ON g.id=x.group_id AND g.business_id=$1
     WHERE x.product_id=ANY($2::bigint[]) AND x.active=TRUE
       ${publicOnly?'AND g.active=TRUE':''}
     ORDER BY x.product_id,x.sort_order,g.id
  `,[Number(businessId),ids]);
  const groupCache=new Map();
  for(const link of links.rows){
    const gid=Number(link.group_id);
    if(!groupCache.has(gid))groupCache.set(gid,await readModifierGroup(db,{businessId,groupId:gid,publicOnly}));
    const group=groupCache.get(gid);
    if(group)map.get(Number(link.product_id))?.push(group);
  }
  return map;
}

export async function validateProductModifierSelections(db,{businessId,productId,optionIds=[]}={}){
  const bid=Number(businessId),pid=Number(productId);
  const selectedIds=(Array.isArray(optionIds)?optionIds:[]).map(Number);
  if(selectedIds.some(id=>!positiveInt(id)))throw Object.assign(new Error('Choose valid product options.'),{status:400});
  if(new Set(selectedIds).size!==selectedIds.length)throw Object.assign(new Error('The same product option cannot be selected twice.'),{status:400});
  const groups=await modifierProjectionForProducts(db,{businessId:bid,productIds:[pid],publicOnly:true});
  const linked=groups.get(pid)||[];
  const allowed=new Map();
  for(const group of linked)for(const option of group.options)allowed.set(Number(option.id),{group,option});
  for(const id of selectedIds){
    if(!allowed.has(id))throw Object.assign(new Error('One or more selected options are not available for this product.'),{status:409});
  }
  let delta=0;
  const snapshotGroups=[];
  for(const group of linked){
    const chosen=selectedIds.map(id=>allowed.get(id)).filter(entry=>entry?.group.id===group.id).map(entry=>entry.option);
    if(chosen.length<group.min_select||chosen.length>group.max_select){
      throw Object.assign(new Error(`${group.name} requires ${group.min_select===group.max_select?group.min_select:`${group.min_select}–${group.max_select}`} selection${group.max_select===1?'':'s'}.`),{status:409});
    }
    if(chosen.length){
      delta+=chosen.reduce((sum,option)=>sum+Number(option.price_delta||0),0);
      snapshotGroups.push({
        group_id:Number(group.id),group_code:group.code,group_name:group.name,
        min_select:Number(group.min_select),max_select:Number(group.max_select),
        options:chosen.map(option=>({
          option_id:Number(option.id),option_code:option.code,option_name:option.name,price_delta:Number(option.price_delta||0)
        }))
      });
    }else if(group.min_select===0){
      snapshotGroups.push({
        group_id:Number(group.id),group_code:group.code,group_name:group.name,
        min_select:Number(group.min_select),max_select:Number(group.max_select),options:[]
      });
    }
  }
  return{
    price_delta:Math.round((delta+Number.EPSILON)*100)/100,
    snapshot:{groups:snapshotGroups}
  };
}

export async function foodProductOrderability(db,{businessId,productId,now=new Date()}={}){
  const bid=Number(businessId),pid=Number(productId);
  const product=await db.query(`
    SELECT id,availability_state,availability_until,availability_note
      FROM marketplace_products
     WHERE id=$1 AND business_id=$2 AND product_domain='food' AND published=TRUE AND active=TRUE
  `,[pid,bid]);
  if(!product.rowCount)return{orderable:false,reason:'product_unavailable',availability:null};
  const availability=effectiveFoodAvailability(product.rows[0],now);
  if(!availability.orderable)return{orderable:false,reason:availability.state,availability};
  const memberships=await db.query(`
    SELECT DISTINCT m.id
      FROM merchant_menu_items mi
      JOIN merchant_menu_sections s ON s.id=mi.section_id AND s.active=TRUE
      JOIN merchant_menus m ON m.id=s.menu_id AND m.business_id=$2 AND m.active=TRUE
     WHERE mi.product_id=$1 AND mi.active=TRUE
  `,[pid,bid]);
  if(!memberships.rowCount)return{orderable:true,reason:'legacy_or_unscheduled',availability};
  for(const row of memberships.rows){
    const menu=await readFoodMenu(db,{businessId:bid,menuId:Number(row.id),publicOnly:true,now});
    if(menu?.schedule_active)return{orderable:true,reason:'active_menu',availability};
  }
  return{orderable:false,reason:'outside_menu_schedule',availability};
}

export async function setFoodProductAvailability(db,{businessId,productId,input,now=new Date()}={}){
  const bid=Number(businessId),pid=Number(productId),normalized=normalizeFoodAvailability(input,now);
  const q=await db.query(`
    UPDATE marketplace_products
       SET availability_state=$1,availability_until=$2,availability_note=$3,updated_at=NOW()
     WHERE id=$4 AND business_id=$5 AND product_domain='food'
     RETURNING *
  `,[normalized.state,normalized.until,normalized.note,pid,bid]);
  if(!q.rowCount)throw Object.assign(new Error('Food product not found in this business.'),{status:404});
  return{...q.rows[0],availability:effectiveFoodAvailability(q.rows[0],now)};
}
