const INVENTORY_CLASSIFICATION_VERSION='universal-inventory-v2a-2026-10-03';

export const INVENTORY_DOMAINS=Object.freeze(['food','non_food','operations']);
export const INVENTORY_STOCK_ROLES=Object.freeze([
  'ingredient',
  'direct_resale',
  'production_material',
  'packaging',
  'operational_consumable',
  'operational_supply'
]);

const DOMAIN_SET=new Set(INVENTORY_DOMAINS);
const ROLE_SET=new Set(INVENTORY_STOCK_ROLES);
const clean=(value,max=80)=>String(value??'').trim().slice(0,max);

const LEGACY_CLASSIFICATION=Object.freeze({
  ingredient:{inventory_domain:'food',stock_role:'ingredient'},
  resale_item:{inventory_domain:'non_food',stock_role:'direct_resale'},
  production_material:{inventory_domain:'non_food',stock_role:'production_material'},
  packaging:{inventory_domain:'operations',stock_role:'packaging'},
  kitchen_consumable:{inventory_domain:'operations',stock_role:'operational_consumable'},
  hygiene:{inventory_domain:'operations',stock_role:'operational_consumable'},
  cleaning_sanitation:{inventory_domain:'operations',stock_role:'operational_supply'},
  operational_supply:{inventory_domain:'operations',stock_role:'operational_supply'}
});

const COMPATIBLE_ROLES=Object.freeze({
  food:new Set(['ingredient','direct_resale']),
  non_food:new Set(['direct_resale','production_material']),
  operations:new Set(['packaging','operational_consumable','operational_supply'])
});

export {INVENTORY_CLASSIFICATION_VERSION};

export function legacyInventoryClassification(inventoryType='ingredient'){
  const type=clean(inventoryType,40)||'ingredient';
  const mapped=LEGACY_CLASSIFICATION[type]||LEGACY_CLASSIFICATION.ingredient;
  return{...mapped};
}

export function normalizeInventoryClassification(input={},context={}){
  const fallback=legacyInventoryClassification(context.inventoryType||input.inventory_type||'ingredient');
  const domain=clean(input.inventory_domain||fallback.inventory_domain,30).toLowerCase();
  const role=clean(input.stock_role||fallback.stock_role,40).toLowerCase();
  if(!DOMAIN_SET.has(domain))throw new TypeError('Choose a valid Inventory domain.');
  if(!ROLE_SET.has(role))throw new TypeError('Choose a valid Inventory stock role.');
  if(!COMPATIBLE_ROLES[domain]?.has(role)){
    throw new TypeError(`${role} is not valid for the ${domain} Inventory domain.`);
  }
  return{
    inventory_domain:domain,
    stock_role:role,
    classification_version:INVENTORY_CLASSIFICATION_VERSION
  };
}

export function compatibilityInventoryType(classification={},legacyInventoryType=''){
  const domain=clean(classification.inventory_domain,30);
  const role=clean(classification.stock_role,40);
  const legacy=clean(legacyInventoryType,40);
  if(role==='ingredient')return'ingredient';
  if(role==='direct_resale')return'resale_item';
  if(role==='production_material')return'production_material';
  if(role==='packaging')return'packaging';
  if(role==='operational_consumable'){
    return ['kitchen_consumable','hygiene'].includes(legacy)?legacy:'kitchen_consumable';
  }
  if(role==='operational_supply'){
    return ['cleaning_sanitation','operational_supply'].includes(legacy)?legacy:'operational_supply';
  }
  return domain==='food'?'ingredient':'operational_supply';
}

export function inventoryClassificationInputProvided(input={}){
  return Object.prototype.hasOwnProperty.call(input||{},'inventory_domain')
    ||Object.prototype.hasOwnProperty.call(input||{},'stock_role');
}

export async function ensureUniversalInventorySchema(pool){
  await pool.query(`
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS inventory_domain TEXT NOT NULL DEFAULT 'food';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stock_role TEXT NOT NULL DEFAULT 'ingredient';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS classification_version TEXT NOT NULL DEFAULT '';

    ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_domain_check;
    ALTER TABLE inventory ADD CONSTRAINT inventory_domain_check
      CHECK(inventory_domain IN ('food','non_food','operations'));

    ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_stock_role_check;
    ALTER TABLE inventory ADD CONSTRAINT inventory_stock_role_check
      CHECK(stock_role IN (
        'ingredient','direct_resale','production_material',
        'packaging','operational_consumable','operational_supply'
      ));

    ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_domain_role_check;
    ALTER TABLE inventory ADD CONSTRAINT inventory_domain_role_check CHECK(
      (inventory_domain='food' AND stock_role IN ('ingredient','direct_resale'))
      OR
      (inventory_domain='non_food' AND stock_role IN ('direct_resale','production_material'))
      OR
      (inventory_domain='operations' AND stock_role IN ('packaging','operational_consumable','operational_supply'))
    );

    CREATE INDEX IF NOT EXISTS inventory_business_domain_role_idx
      ON inventory(business_id,inventory_domain,stock_role,item);
  `);

  const marketplace=await pool.query("SELECT to_regclass('public.marketplace_products') rel");
  if(marketplace.rows[0]?.rel){
    await pool.query(`
      UPDATE inventory i
         SET inventory_domain=CASE
               WHEN linked.product_kind='non_food_resale' THEN 'non_food'
               ELSE 'food'
             END,
             stock_role='direct_resale',
             classification_version=$1,
             updated_at=NOW()
        FROM (
          SELECT DISTINCT ON (inventory_id)
                 inventory_id,product_kind
            FROM marketplace_products
           WHERE inventory_id IS NOT NULL
             AND product_kind IN ('fresh_direct','packaged_resale','non_food_resale')
           ORDER BY inventory_id,
                    CASE product_kind
                      WHEN 'non_food_resale' THEN 0
                      WHEN 'packaged_resale' THEN 1
                      ELSE 2
                    END
        ) linked
       WHERE i.id=linked.inventory_id
         AND i.classification_version=''
    `,[INVENTORY_CLASSIFICATION_VERSION]);
  }

  await pool.query(`
    UPDATE inventory
       SET inventory_domain=CASE inventory_type
             WHEN 'ingredient' THEN 'food'
             WHEN 'resale_item' THEN 'non_food'
             WHEN 'production_material' THEN 'non_food'
             ELSE 'operations'
           END,
           stock_role=CASE inventory_type
             WHEN 'ingredient' THEN 'ingredient'
             WHEN 'resale_item' THEN 'direct_resale'
             WHEN 'production_material' THEN 'production_material'
             WHEN 'packaging' THEN 'packaging'
             WHEN 'kitchen_consumable' THEN 'operational_consumable'
             WHEN 'hygiene' THEN 'operational_consumable'
             WHEN 'cleaning_sanitation' THEN 'operational_supply'
             WHEN 'operational_supply' THEN 'operational_supply'
             ELSE 'ingredient'
           END,
           classification_version=$1,
           updated_at=NOW()
     WHERE classification_version=''
       AND inventory_type<>'ingredient'
  `,[INVENTORY_CLASSIFICATION_VERSION]);

  if(marketplace.rows[0]?.rel){
    await pool.query(`
      UPDATE inventory
         SET inventory_domain='food',
             stock_role='ingredient',
             classification_version=$1,
             updated_at=NOW()
       WHERE classification_version=''
         AND inventory_type='ingredient'
    `,[INVENTORY_CLASSIFICATION_VERSION]);
  }

  return{version:INVENTORY_CLASSIFICATION_VERSION,marketplace_available:Boolean(marketplace.rows[0]?.rel)};
}
