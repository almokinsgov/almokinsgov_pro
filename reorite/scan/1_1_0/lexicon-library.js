// Shared data-only lexicon importer. Used by ReoRite and its Chrome extension.
(() => {
  'use strict';
  if(globalThis.ReoRiteLexicons)return;
  const maxFileBytes=15*1024*1024, maxStoredCharacters=1500000;
  const bundled=Object.freeze([{id:'v4',name:'V4'},{id:'v5',name:'V5'},{id:'v6',name:'V6'},{id:'v6.5',name:'V6.5'}]);
  let imports=[], revision=0, signature='[]';
  function text(value,max=2000){
    if(value==null)return '';
    if(typeof value!=='string' && typeof value!=='number')throw new Error('Lexicon fields must contain text.');
    const out=String(value).normalize('NFC').trim();
    if(out.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(out))throw new Error('Lexicon field is too long or contains control characters.');
    return out;
  }
  const first=values=>values.map(v=>text(v)).find(Boolean)||'';
  function name(value){const out=text(value,80);if(!out)throw new Error('Enter a lexicon name (up to 80 characters).');return out;}
  function cleanRow(row,index){
    if(!row || typeof row!=='object' || Array.isArray(row))throw new Error('Invalid lexicon row.');
    const unit=text(row.unit??row.Unit,100), ipa=text(row.ipa??row.proper_ipa??row['Proper IPA'],1000);
    const id=Number(row.segment_id??row.unit_number??row['Unit Number']??index+1);
    if(!unit || !/^[\p{L}\p{M}'’ -]+$/u.test(unit) || !ipa || !Number.isSafeInteger(id) || id<1)throw new Error('Each row needs a unit, IPA and a positive segment ID.');
    if(row.vars!=null && !Array.isArray(row.vars))throw new Error('Invalid pronunciation variations.');
    if((row.vars||[]).length>100)throw new Error('Too many pronunciation variations.');
    const vars=(row.vars||[]).map(v=>({label:text(v.label,40),bracket:text(v.bracket),just_part:text(v.just_part)})).filter(v=>v.bracket||v.just_part);
    return {segment_id:id,unit,unit_norm:unit.toLowerCase(),ipa,phonetic:text(row.phonetic),vars,eng_variants:vars.map(v=>v.bracket).filter(Boolean)};
  }
  function cleanRows(rows){
    if(!Array.isArray(rows) || !rows.length || rows.length>5000)throw new Error('A lexicon must contain 1 to 5000 segment rows.');
    const ids=new Set();
    return rows.map((row,i)=>{const clean=cleanRow(row,i);if(ids.has(clean.segment_id))throw new Error('Duplicate segment ID.');ids.add(clean.segment_id);return clean;}).sort((a,b)=>a.segment_id-b.segment_id);
  }
  function segmentRow(segment){
    const variations=segment.variations;
    if(!Array.isArray(variations) || !variations.length)throw new Error('Segment has no variations.');
    if(segment.variation_count!=null && segment.variation_count!==variations.length)throw new Error('Variation count does not match.');
    const labels=new Set();
    for(const v of variations){if(!/^(base|v[1-9]\d*)$/.test(v.label) || labels.has(v.label))throw new Error('Invalid or duplicate variation label.');labels.add(v.label);}
    const versions=variations.filter(v=>v.label!=='base').sort((a,b)=>Number(a.label.slice(1))-Number(b.label.slice(1)));
    const selected=versions.length?versions:variations;
    const source={...(selected[0].source_variation||{}),...(segment.source_common||{})};
    return {segment_id:segment.segment_id,unit:segment.unit,ipa:segment.proper_ipa,
      phonetic:first([source['Combination amo manual'],source['Phonetic amo manual - using lookup'],source['Phonectics-testwith-ipatophonexticstool']]),
      vars:selected.map(v=>{const s=v.source_variation||{};return {label:v.label,bracket:first([s['Full word used bracket part of word'],s['full word used ipa bracket part of word']]),just_part:first([s['Just the part of full word'],s['Just part of full word ipa']])};})};
  }
  // TSV supports quoted tabs/newlines and doubled quotes, including workbench record_json cells.
  function tsv(source){
    const records=[];let row=[],cell='',quoted=false,closed=false;
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
      if(ch==='"'){if(cell || closed)throw new Error('Unexpected quote in TSV.');quoted=true;continue;}
      if(ch==='\t' || ch==='\n' || ch==='\r'){
        row.push(cell);cell='';closed=false;
        if(ch!=='\t'){if(ch==='\r' && source[i+1]==='\n')i++;if(row.some(Boolean))records.push(row);row=[];}
      }else{if(closed)throw new Error('Unexpected text after TSV quote.');cell+=ch;}
    }
    if(quoted)throw new Error('Unclosed TSV quote.');
    row.push(cell);if(row.some(Boolean))records.push(row);
    const headers=records.shift()?.map(h=>h.trim());
    if(!headers || new Set(headers).size!==headers.length)throw new Error('Missing or duplicate TSV headers.');
    const rows=records.map(cells=>{if(cells.length!==headers.length)throw new Error('TSV row has the wrong number of columns.');return Object.fromEntries(headers.map((h,i)=>[h,cells[i]]));});
    if(headers.includes('segment_unit') && headers.includes('segment_proper_ipa')){
      const groups=new Map();
      for(const row of rows){
        const id=Number(row.new_id),unit=row.segment_unit,ipa=row.segment_proper_ipa;
        if(!groups.has(id))groups.set(id,{segment_id:id,unit,proper_ipa:ipa,variations:[]});
        const segment=groups.get(id);
        if(segment.unit!==unit || segment.proper_ipa!==ipa)throw new Error('TSV records disagree on current unit or IPA.');
        segment.variations.push({label:row.version,source_variation:Object.fromEntries(Object.entries(row).filter(([key])=>key.startsWith('source.')).map(([key,value])=>[key.slice(7),value]))});
      }
      return [...groups.values()].map(segmentRow);
    }
    if(!(headers.includes('unit') && (headers.includes('ipa') || headers.includes('proper_ipa'))) && !(headers.includes('Unit') && headers.includes('Proper IPA')))throw new Error('TSV needs unit / ipa columns or workbench export columns.');
    return rows;
  }
  function parse(source,filename='lexicon.json'){
    if(typeof source!=='string' || source.length>maxFileBytes)throw new Error('Lexicon file is too large (15 MB maximum).');
    source=source.replace(/^\uFEFF/,'');let rows;
    if(/\.tsv$/i.test(filename))rows=tsv(source);
    else if(/\.json$/i.test(filename)){
      let data;try{data=JSON.parse(source);}catch{throw new Error('Invalid lexicon JSON.');}
      if(Array.isArray(data))rows=data;
      else if(Array.isArray(data?.segments)){
        if(data.segment_count!=null && data.segment_count!==data.segments.length)throw new Error('Segment count does not match.');
        rows=data.segments.map(segmentRow);
      }else if(Array.isArray(data?.rows))rows=data.rows;
      else throw new Error('Choose master.json, master_workspace.json, a ReoRite lexicon JSON, or lexicon.tsv.');
    }else throw new Error('Choose a .json or .tsv lexicon file.');
    return cleanRows(rows);
  }
  function validateImports(value){
    if(!Array.isArray(value) || value.length>10)throw new Error('Up to 10 imported lexicons are supported.');
    const ids=new Set();
    const next=value.map(item=>{
      if(!/^import-[a-z0-9-]{8,80}$/.test(item?.id) || ids.has(item.id))throw new Error('Invalid imported lexicon ID.');ids.add(item.id);
      return {id:item.id,name:name(item.name),rows:cleanRows(item.rows)};
    });
    if(JSON.stringify(next).length>maxStoredCharacters)throw new Error('Imported lexicon storage is full. Export and remove an imported lexicon before adding another.');
    return next;
  }
  function setImports(value){const next=validateImports(value),key=JSON.stringify(next);if(key!==signature){imports=next;signature=key;revision++;}return listImports();}
  function listImports(){return imports.map(item=>({...item,rows:item.rows.map(row=>({...row,vars:row.vars.map(v=>({...v})),eng_variants:[...row.eng_variants]}))}));}
  function list(){return [...bundled.map(item=>({...item,bundled:true})),...imports.map(({id,name,rows})=>({id,name,count:rows.length,bundled:false}))];}
  function add(source,filename,label){return validateImports([...imports,{id:'import-'+ScanCore.uuid(),name:name(label||filename.replace(/\.(json|tsv)$/i,'')),rows:parse(source,filename)}]);}
  function rename(id,label){if(!imports.some(item=>item.id===id))throw new Error('Only imported lexicons can be renamed.');return validateImports(imports.map(item=>item.id===id?{...item,name:name(label)}:item));}
  function remove(id){if(!imports.some(item=>item.id===id))throw new Error('Only imported lexicons can be removed.');return imports.filter(item=>item.id!==id);}
  function rows(id){return imports.find(item=>item.id===id)?.rows||null;}
  function label(id){return list().find(item=>item.id===id)?.name||String(id).toUpperCase();}
  globalThis.ReoRiteLexicons=Object.freeze({bundled,maxFileBytes,parse,validateImports,setImports,listImports,list,add,rename,remove,rows,label,get revision(){return revision;}});
})();
