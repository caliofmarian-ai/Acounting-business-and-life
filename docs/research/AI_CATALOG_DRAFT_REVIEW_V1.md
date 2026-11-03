# AI Catalog review envelope — internal foundation

Status: INTERNAL / NOT A USER-VISIBLE FEATURE. Child #845 of #170.

The provider-neutral module converts untrusted structured suggestion JSON into an inert review envelope for Merchant prepared food, fresh food, packaged food, non-food and Supplier catalog. It uses the current catalog-v3-core.js category and attribute definitions, not another product source of truth.

The model cannot confirm a name, label, category, brand, SKU, barcode, ingredient or amount. Ingredient names for prepared food are suggested only; the Merchant must enter all quantities in the existing canonical Recipe editor. Price, stock, expiry, allergen, certification, warranty, account/business identifiers, payout and publish state are withheld and NEVER supplied as a write payload. Supplier category is distinct from Merchant Universal Catalog taxonomy.

This code never uploads an image, calls an AI provider, saves data, creates inventory or publishes a product. Before integration, require a verified authenticated Merchant/Supplier business, explicit consent for image processing, configured provider/retention, bounded model requests and a separate human-confirmed Draft Save via the current canonical editor. Explicit Publish remains a separate user action. Never accept model-supplied evidence as human approval.

Unit and adversarial tests: node --test tests/catalog-ai-draft-core.test.js. This is not an authenticated Preview/Production acceptance claim. Parent #170 stays OPEN for photo capture, provider adapter, editable UI, canonical Draft/Publish, Android and caliof.com verification. No paid provider/service, new secrets or environment change in this slice.
