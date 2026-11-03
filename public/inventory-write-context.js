// A request may finish on the server after navigation. Only its original UI may
// consume that result; changing the UI never cancels or reinterprets the write.
export function createInventoryWriteController({captureContext,isContextCurrent,byId}){
  const pending=new Map();
  let epoch=0;
  function begin(root){
    if(!root)return null;
    const context=captureContext();
    if(!context||!isContextCurrent(context))return null;
    const previous=pending.get(root);
    if(previous?.isPending())return null;
    previous?.finish();
    const generation=epoch;
    let edited=false,accepted=false,finished=false;
    const changed=()=>{edited=true};
    for(const name of ['input','change','reset'])root.addEventListener(name,changed);
    const connected=()=>!root.id||byId(root.id)===root;
    const scope={
      isPending:()=>!finished&&pending.get(root)===scope&&generation===epoch&&
        connected()&&isContextCurrent(context),
      isCurrent:()=>!finished&&pending.get(root)===scope&&generation===epoch&&
        connected()&&isContextCurrent(context)&&(accepted||!edited),
      accept(){
        if(!scope.isCurrent())return false;
        accepted=true;
        return true;
      },
      finish(){
        if(finished)return;
        finished=true;
        for(const name of ['input','change','reset'])root.removeEventListener(name,changed);
        if(pending.get(root)===scope){
          pending.delete(root);
        }
      }
    };
    pending.set(root,scope);
    return scope;
  }
  return{begin,invalidate(){epoch+=1;for(const scope of [...pending.values()])scope.finish()}};
}
