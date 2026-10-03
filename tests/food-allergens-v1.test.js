import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const core=readFileSync(new URL('../food-allergen-core.js',import.meta.url),'utf8');
const accounting=readFileSync(new URL('../server-business-accounting.js',import.meta.url),'utf8');
const marketplace=readFileSync(new URL('../server-marketplace.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ui=readFileSync(new URL('../public/v03.js',import.meta.url),'utf8');
const marketUi=readFileSync(new URL('../public/marketplace-ui.js',import.meta.url),'utf8');
const guestUi=readFileSync(new URL('../public/guest-explore.js',import.meta.url),'utf8');
const marketCss=readFileSync(new URL('../public/marketplace.css',import.meta.url),'utf8');
const guestCss=readFileSync(new URL('../public/guest-explore.css',import.meta.url),'utf8');
const baseCss=readFileSync(new URL('../public/v03.css',import.meta.url),'utf8');

test('allergen evidence schema separates ingredients cross-contact and review revisions',()=>{
  assert.match(core,/CREATE TABLE IF NOT EXISTS inventory_allergen_evidence/);
  assert.match(core,/evidence_kind IN \('contains','may_contain'\)/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS product_cross_contact_allergens/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS product_allergen_reviews/);
  assert.match(core,/allergen_revision INTEGER NOT NULL DEFAULT 1/);
});

test('Ingredient allergen evidence is explicit Merchant evidence and only applies to Ingredient stock',()=>{
  assert.match(accounting,/\/api\/inventory\/:id\/allergens/);
  assert.match(accounting,/Allergen evidence is recorded on Ingredient stock only/);
  assert.match(accounting,/source:'merchant_declared'/);
  assert.match(accounting,/normalizeAllergenCodes/);
  assert.match(accounting,/One or more allergen codes are not supported/);
});

test('ingredient evidence and recipe changes invalidate dependent prepared-product allergen review',()=>{
  assert.match(accounting,/invalidateAllergenReviewForInventory\(client/);
  const recipe=accounting.slice(accounting.indexOf("app.put('/api/products/:id/recipe'"),accounting.indexOf("app.post('/api/product-sales'"));
  assert.match(recipe,/invalidateProductAllergenReview\(client,\{businessId:business\.id,productId\}\)/);
  assert.match(recipe,/invalidateProductAllergenReview\(client,\{businessId:ctx\.business\.id,productId\}\)/);
  assert.match(core,/SET allergen_revision=allergen_revision\+1/);
  assert.match(core,/SET published=FALSE/);
});

test('cross-contact remains Merchant-controlled and changing it invalidates the review',()=>{
  assert.match(accounting,/\/api\/products\/:id\/allergens\/cross-contact/);
  assert.match(accounting,/product_cross_contact_allergens/);
  assert.match(accounting,/invalidateProductAllergenReview\(client/);
  assert.doesNotMatch(core,/productName.*allergen/i);
});

test('Merchant must review current prepared-product allergen revision before publication',()=>{
  assert.match(accounting,/\/api\/products\/:id\/allergens\/review/);
  assert.match(accounting,/reviewed_revision/);
  assert.match(marketplace,/ALLERGEN_REVIEW_REQUIRED/);
  assert.match(marketplace,/Review and confirm the current allergen information before publishing this prepared food/);
});

test('public Marketplace exposes reviewed disclosure only and never exposes internal legacy product id',()=>{
  assert.match(marketplace,/allergen_information:reviewed\?allergen_information:null/);
  assert.match(marketplace,/const \{legacy_product_id,\.\.\.safe\}=row/);
  assert.match(marketplace,/allergen_review_current:reviewed/);
  assert.match(marketplace,/merchant_declared_ingredient_and_kitchen_evidence|allergenPublicProjection/);
});

test('Merchant mobile UI separates Contains May contain Cross-contact and review',()=>{
  assert.match(html,/Ingredient allergen evidence/);
  assert.match(html,/id="ingredientContainsGrid"/);
  assert.match(html,/id="ingredientMayContainGrid"/);
  assert.match(html,/Allergens & cross-contact/);
  assert.match(html,/id="productCrossContactGrid"/);
  assert.match(html,/Review & confirm allergen information/);
  assert.match(ui,/No allergen is inferred from an ingredient or product name/);
  assert.match(ui,/Cross-contact risk/);
  assert.match(ui,/Review required/);
  assert.match(baseCss,/\.allergenGrid/);
  assert.match(baseCss,/\.allergenCheck/);
});

test('Customer and guest product cards show cautious reviewed ingredient disclosure or pending-review copy',()=>{
  assert.match(marketUi,/function marketplaceAllergenInfo/);
  assert.match(marketUi,/Ingredient disclosure pending review/);
  assert.match(marketUi,/Contains:/);
  assert.match(marketUi,/Cross-contact risk:/);
  assert.match(guestUi,/function guestIngredientDisclosure/);
  assert.match(guestUi,/Contact the Merchant for current ingredient information/);
  assert.match(marketCss,/\.marketAllergenInfo/);
  assert.match(guestCss,/\.guestAllergenInfo/);
});

test('Merchant Storefront catalog visibly identifies current versus required ingredient disclosure review',()=>{
  assert.match(marketUi,/Ingredient disclosure reviewed/);
  assert.match(marketUi,/Ingredient disclosure review required/);
  assert.match(marketCss,/\.allergenReviewBadge\.current/);
  assert.match(marketCss,/\.allergenReviewBadge\.required/);
});
