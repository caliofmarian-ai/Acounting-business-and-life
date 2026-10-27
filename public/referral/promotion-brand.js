// Owner-approved choices. Presentation preferences store these IDs, never image URLs.
const artwork = (id, name, filipinoName, alt, filipinoAlt) => Object.freeze({
  id,
  src: '/referral/assets/brand-' + id + '.jpg',
  thumbnail: '/referral/assets/brand-' + id + '-thumb.webp',
  name: Object.freeze({ 'en-PH': name, 'fil-PH': filipinoName }),
  alt: Object.freeze({ 'en-PH': alt, 'fil-PH': filipinoAlt })
});

export const PROMOTION_BRAND_ASSETS = Object.freeze([
  artwork('app-platform', 'App platform', 'Plataporma ng app',
    'Business & Life phone app on a navy and teal background, surrounded by shopping, store, delivery and service icons.', 'Business & Life app sa telepono, na may mga simbolo ng pamimili, tindahan, paghahatid at serbisyo sa navy at teal na likuran.'),
  artwork('connected-profiles', 'Connected profiles', 'Magkakaugnay na profile',
    'Business & Life phone app connected to Customer, Merchant, Supplier, Courier and Services profiles.', 'Business & Life app sa telepono na konektado sa mga profile ng mamimili, negosyante, tagapagtustos, tagapaghatid at serbisyo.'),
  artwork('everyday-life', 'Everyday life', 'Araw-araw na buhay',
    'A hand holding the Business & Life app, surrounded by shopping bags, parcels, a helmet and household items.', 'Kamay na may hawak na Business & Life app, napapaligiran ng mga shopping bag, pakete, helmet at gamit sa bahay.')
]);
export const DEFAULT_PROMOTION_ARTWORK_ID = 'connected-profiles';
export const PROMOTION_ARTWORK_IDS = Object.freeze(PROMOTION_BRAND_ASSETS.map(item => item.id));

export function getPromotionBrandAsset(id) {
  return PROMOTION_BRAND_ASSETS.find(item => item.id === id) || null;
}
