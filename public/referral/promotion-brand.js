// Owner-approved choices. Presentation preferences store these IDs, never image URLs.
const artwork = (id, name, filipinoName, alt, filipinoAlt) => Object.freeze({
  id,
  src: '/referral/assets/brand-' + id + '.jpg',
  thumbnail: '/referral/assets/brand-' + id + '-thumb.webp',
  name: Object.freeze({ 'en-PH': name, 'fil-PH': filipinoName }),
  alt: Object.freeze({ 'en-PH': alt, 'fil-PH': filipinoAlt })
});

export const PROMOTION_BRAND_ASSETS = Object.freeze([
  artwork('local-business', 'Local business', 'Lokal na negosyo',
    'A shopkeeper hands a customer a bag, with a delivery rider nearby.', 'Inaabot ng tindera ang supot sa mamimili habang may tagapaghatid sa malapit.'),
  artwork('community', 'Community', 'Komunidad',
    'An illustration of people and businesses in a connected community.', 'Ilustrasyon ng mga tao at negosyo sa isang magkakaugnay na komunidad.'),
  artwork('miniature', 'Miniature world', 'Munting mundo',
    'A miniature world of local shops and everyday services.', 'Munting mundo ng mga lokal na tindahan at pang-araw-araw na serbisyo.')
]);
export const DEFAULT_PROMOTION_ARTWORK_ID = 'local-business';
export const PROMOTION_ARTWORK_IDS = Object.freeze(PROMOTION_BRAND_ASSETS.map(item => item.id));

export function getPromotionBrandAsset(id) {
  return PROMOTION_BRAND_ASSETS.find(item => item.id === id) || null;
}
