export async function runSupplierBusinessAttributionV2EAcceptance({pool,base,secret,aliases,helpers}){
  const {
    requestJson,expectStatus,qaAccountSession,ensureActiveRole,runSupplierExperienceAcceptance
  }=helpers;
  const supplierEmail=aliases.supplier,merchantEmail=aliases.merchant;

  const supplierAccount=await pool.query(
    "SELECT id FROM accounts WHERE LOWER(email)=$1",
    [supplierEmail]
  );
  const supplierAccountId=Number(supplierAccount.rows[0]?.id);
  if(!supplierAccountId)throw new Error("Supplier V2E QA identity is unavailable.");

  const fixtureName="Business & Life QA Supply B V2E";
  const existingFixture=await pool.query(
    "SELECT b.id FROM businesses b JOIN profile_business_bindings pb ON pb.business_id=b.id AND pb.account_id=$1 AND pb.role='supplier' WHERE b.name=$2 ORDER BY b.id LIMIT 1",
    [supplierAccountId,fixtureName]
  );
  const existingFixtureId=Number(existingFixture.rows[0]?.id||0);
  if(existingFixtureId){
    await pool.query(
      "UPDATE profile_business_bindings SET status='suspended',is_primary=FALSE,updated_at=NOW() WHERE account_id=$1 AND role='supplier' AND business_id=$2",
      [supplierAccountId,existingFixtureId]
    );
  }

  const primaryBefore=await pool.query(
    "SELECT business_id FROM profile_business_bindings WHERE account_id=$1 AND role='supplier' AND status='active' ORDER BY is_primary DESC,business_id LIMIT 1",
    [supplierAccountId]
  );
  const initialBusinessA=Number(primaryBefore.rows[0]?.business_id);
  if(initialBusinessA){
    await pool.query(
      "INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'supplier',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()",
      [supplierAccountId,initialBusinessA]
    );
  }

  const baseline=await runSupplierExperienceAcceptance({pool,base,secret});
  if(baseline.status!=="PASS")throw new Error("Supplier Experience prerequisite did not pass.");

  const [supplier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:supplierEmail,role:"supplier",label:"Supplier V2E QA"}),
    qaAccountSession({pool,base,secret,email:merchantEmail,role:"merchant",label:"Supplier V2E Merchant QA"})
  ]);
  await ensureActiveRole({base,token:supplier.token,role:"supplier",label:"Supplier V2E QA"});
  await ensureActiveRole({base,token:merchant.token,role:"merchant",label:"Supplier V2E Merchant QA"});

  const businessA=Number(baseline.supplier_business_id);
  const merchantBusinessId=Number(baseline.merchant_business_id);
  const poA=Number(baseline.purchase_order_id);
  const catalogItemId=Number(baseline.catalog_item_id);
  if(!businessA||!merchantBusinessId||!poA||!catalogItemId){
    throw new Error("Supplier V2E baseline evidence is incomplete.");
  }

  const businessARow=await pool.query("SELECT territory_id FROM businesses WHERE id=$1",[businessA]);
  let businessB=existingFixtureId;
  if(!businessB){
    const created=await pool.query(
      "INSERT INTO businesses(name,country_code,currency_code,territory_id) VALUES($1,'PH','PHP',$2) RETURNING id",
      [fixtureName,businessARow.rows[0]?.territory_id||null]
    );
    businessB=Number(created.rows[0].id);
    await pool.query(
      "INSERT INTO business_memberships(business_id,account_id,membership_role,active) VALUES($1,$2,'owner',TRUE) ON CONFLICT(business_id,account_id) DO UPDATE SET active=TRUE",
      [businessB,supplier.accountId]
    );
  }
  await pool.query(
    "INSERT INTO profile_business_bindings(account_id,role,business_id,status,is_primary) VALUES($1,'supplier',$2,'active',FALSE) ON CONFLICT(account_id,role,business_id) DO UPDATE SET status='active',is_primary=FALSE,updated_at=NOW()",
    [supplier.accountId,businessB]
  );

  const publishFor=async businessId=>{
    const settings=await requestJson(base,"/api/supplier/v4/sourcing-settings",{
      method:"PUT",token:supplier.token,
      body:{
        business_id:businessId,visibility:"private",accepts_rfqs:true,
        categories:["other"],published_catalog_item_ids:[catalogItemId]
      }
    });
    expectStatus(settings,200,"Supplier V2E sourcing settings "+businessId);
  };
  await publishFor(businessA);
  await publishFor(businessB);

  await pool.query(
    "INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'supplier',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()",
    [supplier.accountId,businessB]
  );

  const reinvite=await requestJson(base,"/api/procurement/relationships/invite",{
    method:"POST",token:merchant.token,
    body:{
      business_id:merchantBusinessId,
      supplier_email:supplierEmail,
      note:"Controlled QA Supplier V2E business B relationship"
    }
  });
  expectStatus(reinvite,201,"Supplier V2E relationship re-invite");

  const acceptedB=await requestJson(base,"/api/supplier/relationships/"+merchantBusinessId+"/respond",{
    method:"POST",token:supplier.token,body:{accept:true}
  });
  expectStatus(acceptedB,200,"Supplier V2E business B relationship accept");
  if(Number(acceptedB.json?.supplier_business_id)!==businessB){
    throw new Error("Supplier relationship did not bind to business B.");
  }

  const catalogB=await requestJson(
    base,"/api/procurement/suppliers/"+supplier.accountId+"/catalog?business_id="+merchantBusinessId,
    {token:merchant.token}
  );
  expectStatus(catalogB,200,"Supplier V2E business B catalog");
  if(!(catalogB.json?.items||[]).some(x=>Number(x.id)===catalogItemId)){
    throw new Error("Supplier business B catalog association is missing.");
  }

  const noteB="Controlled QA Supplier Business Attribution V2E PO B";
  const existingPoB=await pool.query(
    "SELECT id FROM purchase_orders WHERE business_id=$1 AND supplier_account_id=$2 AND supplier_business_id=$3 AND merchant_note=$4 ORDER BY id DESC LIMIT 1",
    [merchantBusinessId,supplier.accountId,businessB,noteB]
  );
  let poB;
  if(existingPoB.rowCount){
    const detail=await requestJson(base,"/api/procurement/orders/"+Number(existingPoB.rows[0].id),{token:merchant.token});
    expectStatus(detail,200,"Supplier V2E existing PO B");
    poB=detail.json;
  }else{
    const created=await requestJson(base,"/api/procurement/orders",{
      method:"POST",token:merchant.token,
      body:{
        business_id:merchantBusinessId,
        supplier_account_id:supplier.accountId,
        fulfilment_mode:"delivery",
        delivery_fee:0,
        merchant_note:noteB,
        items:[{catalog_item_id:catalogItemId,packs:1}]
      }
    });
    expectStatus(created,201,"Supplier V2E PO B create");
    poB=created.json;
  }

  const poBId=Number(poB?.id);
  if(!poBId||Number(poB?.supplier_business_id)!==businessB){
    throw new Error("PO B lost Supplier business attribution.");
  }

  if(["sent","supplier_received","accepted","partially_accepted"].includes(poB.status)){
    const items=(poB.items||[]).map(item=>({
      item_id:Number(item.id),
      confirmed_packs:Number(item.ordered_packs),
      confirmed_price_per_pack:Number(item.price_per_pack_snapshot)
    }));
    const responded=await requestJson(base,"/api/supplier/orders/"+poBId+"/respond",{
      method:"POST",token:supplier.token,
      body:{business_id:businessB,items,supplier_note:"Supplier V2E business B acceptance"}
    });
    expectStatus(responded,200,"Supplier V2E PO B acceptance");
    poB=responded.json;
  }

  if(!["received","cancelled","rejected"].includes(poB.status)){
    const delivered=await requestJson(base,"/api/supplier/orders/"+poBId+"/status",{
      method:"POST",token:supplier.token,
      body:{business_id:businessB,status:"delivered",supplier_note:"Supplier V2E B delivered"}
    });
    expectStatus(delivered,200,"Supplier V2E PO B delivered");
    poB=delivered.json;
  }

  if(poB.status!=="received"){
    const receiveItems=(poB.items||[]).map(item=>({
      item_id:Number(item.id),
      received_packs:Math.max(0,Number(item.confirmed_packs??item.ordered_packs)-Number(item.received_packs||0)),
      actual_price_per_pack:Number(item.confirmed_price_per_pack??item.price_per_pack_snapshot)
    })).filter(item=>item.received_packs>0);
    if(receiveItems.length){
      const received=await requestJson(base,"/api/procurement/orders/"+poBId+"/receive",{
        method:"POST",token:merchant.token,
        body:{items:receiveItems,note:"Supplier V2E Merchant receives PO B"}
      });
      expectStatus(received,200,"Supplier V2E PO B receipt");
      poB=received.json;
    }
  }
  if(poB.status!=="received")throw new Error("Supplier V2E PO B was not fully received.");

  const outstandingB=Math.max(0,Number(poB.expected_total)-Number(poB.paid_amount||0));
  if(outstandingB>0.001){
    const paid=await requestJson(base,"/api/procurement/orders/"+poBId+"/payment",{
      method:"POST",token:merchant.token,body:{amount:outstandingB,account:"cash"}
    });
    expectStatus(paid,200,"Supplier V2E PO B payment");
    poB=paid.json;
  }
  if(poB.payment_status!=="paid")throw new Error("Supplier V2E PO B is not paid.");

  const [ordersA,ordersB,financeA,financeB,moneyA,moneyB,crossDenied,receiptB]=await Promise.all([
    requestJson(base,"/api/procurement/orders?business_id="+businessA,{token:supplier.token}),
    requestJson(base,"/api/procurement/orders?business_id="+businessB,{token:supplier.token}),
    requestJson(base,"/api/accounting/finance-overview?business_id="+businessA,{token:supplier.token}),
    requestJson(base,"/api/accounting/finance-overview?business_id="+businessB,{token:supplier.token}),
    requestJson(base,"/api/supplier/v5/today?business_id="+businessA+"&view=money",{token:supplier.token}),
    requestJson(base,"/api/supplier/v5/today?business_id="+businessB+"&view=money",{token:supplier.token}),
    requestJson(base,"/api/procurement/orders/"+poA+"?business_id="+businessB,{token:supplier.token}),
    pool.query(
      "SELECT business_id,amount,note,source_id FROM transactions WHERE source='supplier_receipt' AND source_id=$1 ORDER BY id DESC LIMIT 1",
      [poBId*1000000+Math.round(Number(poB.paid_amount||0)*100)]
    )
  ]);

  for(const pair of [[ordersA,"orders A"],[ordersB,"orders B"],[financeA,"finance A"],[financeB,"finance B"],[moneyA,"money A"],[moneyB,"money B"]]){
    expectStatus(pair[0],200,"Supplier V2E "+pair[1]);
  }
  if(crossDenied.status!==403)throw new Error("Supplier business B could read business A PO detail.");

  const idsA=(ordersA.json||[]).map(x=>Number(x.id));
  const idsB=(ordersB.json||[]).map(x=>Number(x.id));
  if(!idsA.includes(poA)||idsA.includes(poBId)||!idsB.includes(poBId)||idsB.includes(poA)){
    throw new Error("Supplier Orders leaked purchase orders across economic workspaces.");
  }
  if(Number(financeA.json?.business?.id)!==businessA||Number(financeB.json?.business?.id)!==businessB){
    throw new Error("Supplier Finance resolved the wrong economic workspace.");
  }
  if(financeA.json?.commercial?.attribution_status!=="SUPPLIER_BUSINESS_ATTRIBUTED"
    ||financeB.json?.commercial?.attribution_status!=="SUPPLIER_BUSINESS_ATTRIBUTED"){
    throw new Error("Supplier Finance did not report exact business attribution.");
  }
  if(!receiptB.rowCount){
    throw new Error("Supplier payment receipt evidence is missing for PO B.");
  }
  if(Number(receiptB.rows[0]?.business_id)!==businessB){
    throw new Error("Supplier payment receipt business mismatch: actual "
      +Number(receiptB.rows[0]?.business_id)+" expected "+businessB+".");
  }
  if(Number(moneyA.json?.business?.id)!==businessA||Number(moneyB.json?.business?.id)!==businessB){
    throw new Error("Supplier Today Money resolved the wrong economic workspace.");
  }

  await pool.query(
    "INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'supplier',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()",
    [supplier.accountId,businessA]
  );

  const restoreInvite=await requestJson(base,"/api/procurement/relationships/invite",{
    method:"POST",token:merchant.token,
    body:{business_id:merchantBusinessId,supplier_email:supplierEmail,note:"Restore Supplier V2E relationship to business A"}
  });
  expectStatus(restoreInvite,201,"Supplier V2E restore relationship invite");
  const restoreAccept=await requestJson(base,"/api/supplier/relationships/"+merchantBusinessId+"/respond",{
    method:"POST",token:supplier.token,body:{accept:true}
  });
  expectStatus(restoreAccept,200,"Supplier V2E restore relationship accept");
  if(Number(restoreAccept.json?.supplier_business_id)!==businessA){
    throw new Error("Supplier V2E relationship was not restored to business A.");
  }

  await requestJson(base,"/api/auth/logout",{method:"POST",token:supplier.token,body:{}});
  await requestJson(base,"/api/auth/logout",{method:"POST",token:merchant.token,body:{}});

  return{
    status:"PASS",
    wave:"supplier_business_attribution_v2e",
    supplier_account_id:supplier.accountId,
    merchant_business_id:merchantBusinessId,
    supplier_business_a:businessA,
    supplier_business_b:businessB,
    purchase_order_a:poA,
    purchase_order_b:poBId,
    orders_isolated:true,
    cross_business_detail_denied:true,
    finance_isolated:true,
    today_money_isolated:true,
    supplier_receipt_business_b:true,
    relationship_restored_to_business_a:true
  };
}
