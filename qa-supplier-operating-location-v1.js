export async function runSupplierOperatingLocationV1Acceptance({pool,base,secret,aliases,helpers}){
  const {requestJson,expectStatus,qaAccountSession,ensureActiveRole}=helpers;
  const supplierEmail=aliases.supplier,merchantEmail=aliases.merchant;

  const [supplier,merchant]=await Promise.all([
    qaAccountSession({pool,base,secret,email:supplierEmail,role:'supplier',label:'Supplier location QA'}),
    qaAccountSession({pool,base,secret,email:merchantEmail,role:'merchant',label:'Supplier location Merchant QA'})
  ]);
  await ensureActiveRole({base,token:supplier.token,role:'supplier',label:'Supplier location QA'});
  await ensureActiveRole({base,token:merchant.token,role:'merchant',label:'Supplier location Merchant QA'});

  const supplierBindings=await pool.query(
    "SELECT business_id,is_primary FROM profile_business_bindings WHERE account_id=$1 AND role='supplier' AND status='active' ORDER BY is_primary DESC,business_id",
    [supplier.accountId]
  );
  let businessA=Number(supplierBindings.rows[0]?.business_id);
  if(!businessA)throw new Error('Supplier operating-location QA has no primary Supplier business.');

  let businessB=Number(supplierBindings.rows[1]?.business_id||0);
  if(!businessB){
    const baseBusiness=await pool.query("SELECT territory_id FROM businesses WHERE id=$1",[businessA]);
    const name='Business & Life QA Supplier Location B';
    const existing=await pool.query(
      "SELECT b.id FROM businesses b JOIN business_memberships bm ON bm.business_id=b.id AND bm.account_id=$1 WHERE b.name=$2 ORDER BY b.id LIMIT 1",
      [supplier.accountId,name]
    );
    if(existing.rowCount)businessB=Number(existing.rows[0].id);
    else{
      const created=await pool.query(
        "INSERT INTO businesses(name,country_code,currency_code,territory_id) VALUES($1,'PH','PHP',$2) RETURNING id",
        [name,baseBusiness.rows[0]?.territory_id||null]
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
  }

  const merchantBinding=await pool.query(
    "SELECT business_id FROM profile_business_bindings WHERE account_id=$1 AND role='merchant' AND status='active' ORDER BY is_primary DESC,business_id LIMIT 1",
    [merchant.accountId]
  );
  const merchantBusinessId=Number(merchantBinding.rows[0]?.business_id);
  if(!merchantBusinessId)throw new Error('Supplier operating-location QA has no Merchant business.');

  await pool.query(
    "INSERT INTO account_business_preferences(account_id,role,business_id) VALUES($1,'supplier',$2) ON CONFLICT(account_id,role) DO UPDATE SET business_id=EXCLUDED.business_id,updated_at=NOW()",
    [supplier.accountId,businessA]
  );

  const invite=await requestJson(base,'/api/procurement/relationships/invite',{
    method:'POST',token:merchant.token,
    body:{business_id:merchantBusinessId,supplier_email:supplierEmail,supplier_business_id:businessA,note:'Supplier location privacy QA'}
  });
  expectStatus(invite,201,'Supplier location relationship invite');
  const accepted=await requestJson(base,'/api/supplier/relationships/'+merchantBusinessId+'/respond',{
    method:'POST',token:supplier.token,body:{accept:true,supplier_business_id:businessA}
  });
  expectStatus(accepted,200,'Supplier location relationship accept');
  if(Number(accepted.json?.supplier_business_id)!==businessA)throw new Error('Supplier location QA relationship bound to wrong Supplier business.');

  const addressA='QA Warehouse A — Relationship Street';
  const addressB='QA Warehouse B — Private Street';

  const privateA=await requestJson(base,'/api/supplier/operating-location',{
    method:'PUT',token:supplier.token,
    body:{business_id:businessA,use_override:true,location_type:'warehouse_dispatch_pickup',location_label:'QA Warehouse A',exact_address:addressA,visibility:'private'}
  });
  expectStatus(privateA,200,'Supplier location private A save');
  if(privateA.json?.operating_location?.exact_address!==addressA)throw new Error('Supplier could not read its private business A work location.');

  const merchantPrivate=await requestJson(base,'/api/procurement/relationships?business_id='+merchantBusinessId,{token:merchant.token});
  expectStatus(merchantPrivate,200,'Supplier location merchant private read');
  const relPrivate=(merchantPrivate.json||[]).find(x=>Number(x.supplier_account_id)===supplier.accountId);
  if(relPrivate?.operating_location_address)throw new Error('Private Supplier exact location leaked to Merchant relationship.');

  const sharedA=await requestJson(base,'/api/supplier/operating-location',{
    method:'PUT',token:supplier.token,
    body:{business_id:businessA,use_override:true,location_type:'warehouse_dispatch_pickup',location_label:'QA Warehouse A',exact_address:addressA,visibility:'relationships'}
  });
  expectStatus(sharedA,200,'Supplier location relationship A save');

  const merchantShared=await requestJson(base,'/api/procurement/relationships?business_id='+merchantBusinessId,{token:merchant.token});
  expectStatus(merchantShared,200,'Supplier location merchant shared read');
  const relShared=(merchantShared.json||[]).find(x=>Number(x.supplier_account_id)===supplier.accountId);
  if(relShared?.operating_location_address!==addressA)throw new Error('Accepted Merchant relationship did not receive explicitly shared Supplier work location.');

  const savedB=await requestJson(base,'/api/supplier/operating-location',{
    method:'PUT',token:supplier.token,
    body:{business_id:businessB,use_override:true,location_type:'warehouse',location_label:'QA Warehouse B',exact_address:addressB,visibility:'private'}
  });
  expectStatus(savedB,200,'Supplier location B save');

  const [readA,readB]=await Promise.all([
    requestJson(base,'/api/supplier/operating-location?business_id='+businessA,{token:supplier.token}),
    requestJson(base,'/api/supplier/operating-location?business_id='+businessB,{token:supplier.token})
  ]);
  expectStatus(readA,200,'Supplier location A read');
  expectStatus(readB,200,'Supplier location B read');
  if(readA.json?.operating_location?.exact_address!==addressA||readB.json?.operating_location?.exact_address!==addressB){
    throw new Error('Supplier work locations leaked or collapsed across business workspaces.');
  }

  for(const businessId of [businessA,businessB]){
    const reset=await requestJson(base,'/api/supplier/operating-location',{
      method:'PUT',token:supplier.token,
      body:{business_id:businessId,use_override:false,location_mode:'personal_default'}
    });
    expectStatus(reset,200,'Supplier location reset '+businessId);
    if(reset.json?.operating_location?.exact_address||reset.json?.operating_location?.visibility!=='private'){
      throw new Error('Supplier location reset did not remove the exact override.');
    }
  }

  await requestJson(base,'/api/auth/logout',{method:'POST',token:supplier.token,body:{}});
  await requestJson(base,'/api/auth/logout',{method:'POST',token:merchant.token,body:{}});

  return{
    status:'PASS',
    wave:'supplier_operating_location_v1',
    supplier_account_id:supplier.accountId,
    supplier_business_a:businessA,
    supplier_business_b:businessB,
    merchant_business_id:merchantBusinessId,
    private_default_protected:true,
    relationship_opt_in_verified:true,
    business_isolation_verified:true,
    reset_to_personal_default:true,
    qa_revision:String(process.env.RAILWAY_GIT_COMMIT_SHA||process.env.GITHUB_SHA||'local').slice(0,12)
  };
}
