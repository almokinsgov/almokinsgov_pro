// Shared manager UI; storage adapters commit successfully before updating live data.
(() => {
  'use strict';
  globalThis.mountLexiconManager=function(root,adapter){
    const lib=ReoRiteLexicons;
    const node=(tag,value,attrs={})=>{const n=document.createElement(tag);n.textContent=value;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
    root.replaceChildren();root.dataset.lexiconManager='';
    root.append(node('h2','Manage lexicons'),node('p','Add a workbench master.json, master_workspace.json or lexicon.tsv, a ReoRite lexicon JSON, or a table with unit and ipa columns. Imports stay in this browser. Built-in lexicons are preserved.'));
    const name=node('input','',{'aria-label':'New lexicon name',type:'text',placeholder:'Name for imported lexicon',maxlength:'80'});
    const file=node('input','',{'aria-label':'Lexicon file',type:'file',accept:'.json,.tsv'});
    name.style.width='min(280px, 100%)';file.style.width='min(420px, 100%)';
    const add=node('button','Add lexicon',{type:'button',class:'btn primary'}),status=node('p','',{role:'status','aria-live':'polite'}),list=node('div','');
    const controls=node('div','');controls.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap';controls.append(name,file,add);
    root.append(controls,status,list);
    const tell=(message,error=false)=>{status.textContent=message;status.className=error?'error':'muted';status.style.color=error?'var(--danger, #b42318)':'';};
    let busy=false;
    async function commit(next,message,selected){
      if(busy)return;busy=true;add.disabled=true;
      try{await adapter.commit(next,selected);lib.setImports(next);await adapter.changed?.();draw();tell(message);}
      catch(error){tell(error.name==='QuotaExceededError'?'Browser storage is full. Remove an imported lexicon or clear unused ReoRite history.':error.message,true);}
      finally{busy=false;add.disabled=false;}
    }
    function draw(){
      list.replaceChildren();
      for(const item of lib.list()){
        const row=node('div','',{class:'lexicon-entry'});row.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0';
        row.append(node('span',`${item.name} · ${item.bundled?'built in':item.count+' segment'+(item.count===1?'':'s')}`));
        const use=node('button','Use',{type:'button',class:'btn','aria-label':'Use '+item.name});
        use.onclick=async()=>{try{await adapter.select(item.id);tell(`${item.name} selected for pronunciation.`);}catch(error){tell(error.message,true);}};row.append(use);
        if(!item.bundled){
          const edit=node('input','',{'aria-label':'Rename '+item.name,type:'text',maxlength:'80'});edit.value=item.name;edit.style.width='min(260px, 100%)';
          const rename=node('button','Rename',{type:'button',class:'btn','aria-label':'Rename '+item.name});
          rename.onclick=()=>{if(busy)return;try{void commit(lib.rename(item.id,edit.value),'Lexicon renamed.');}catch(error){tell(error.message,true);}};
          const download=node('button','Export',{type:'button',class:'btn','aria-label':'Export '+item.name});
          download.onclick=()=>{const data=lib.listImports().find(x=>x.id===item.id);const url=URL.createObjectURL(new Blob([JSON.stringify({name:data.name,rows:data.rows},null,2)+'\n'],{type:'application/json'}));const a=node('a','');a.href=url;a.download=data.name.replace(/[^\p{L}\p{N} _.-]/gu,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
          const remove=node('button','Remove',{type:'button',class:'btn','aria-label':'Remove '+item.name});
          remove.onclick=()=>{if(busy)return;try{void commit(lib.remove(item.id),'Imported lexicon removed. If selected, pronunciation returns to V6.5.');}catch(error){tell(error.message,true);}};
          row.append(edit,rename,download,remove);
        }list.append(row);
      }
    }
    add.onclick=async()=>{if(busy)return;try{const chosen=file.files[0];if(!chosen)throw new Error('Choose a JSON or TSV lexicon file first.');if(chosen.size>lib.maxFileBytes)throw new Error('Lexicon file is too large (15 MB maximum).');const next=lib.add(await chosen.text(),chosen.name,name.value);await commit(next,'Lexicon added. Choose Use to select it.');file.value='';}catch(error){tell(error.message,true);}};
    draw();return {refresh:draw};
  };
})();
