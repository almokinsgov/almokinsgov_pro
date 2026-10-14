(() => {
  'use strict';
  const key='reorite-scan-settings-v1',lexiconKey='reorite-scan-lexicons-v1';
  const extra={ocrLanguages:'mri+eng',ocrQuality:'best',ocrLayout:'auto',preprocess:'original',minOcrConfidence:55,ttsProvider:'browser',deviceVoice:'',cameraFacing:'environment'};
  const defaults=Object.freeze({...ReoRiteConfig.defaults,lexicon:'v6.5',...extra});
  function validate(input={}){
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Settings must be an object.');
    for(const name of Object.keys(input))if(!Object.hasOwn(defaults,name))throw new Error('Unknown setting: '+name);
    const merged={...defaults,...input},base=Object.fromEntries(Object.keys(ReoRiteConfig.defaults).map(name=>[name,merged[name]]));
    const settings={...ReoRiteConfig.validate(base),...Object.fromEntries(Object.keys(extra).map(name=>[name,merged[name]]))};
    for(const [name,choices]of Object.entries({ocrLanguages:['mri+eng','mri','eng'],ocrQuality:['best','fast'],ocrLayout:['auto','block','sparse'],preprocess:['original','contrast'],ttsProvider:['browser','polly'],cameraFacing:['environment','user']}))if(!choices.includes(settings[name]))throw new Error('Invalid '+name+'.');
    if(!Number.isInteger(settings.minOcrConfidence)||settings.minOcrConfidence<0||settings.minOcrConfidence>100)throw new Error('OCR confidence threshold must be 0 to 100.');
    if(typeof settings.deviceVoice!=='string'||settings.deviceVoice.length>300)throw new Error('Invalid device voice.');
    return settings;
  }
  function load(){
    ReoRiteLexicons.setImports(JSON.parse(localStorage.getItem(lexiconKey)||'[]'));
    const saved=JSON.parse(localStorage.getItem(key)||'{}');
    if(saved.lexicon?.startsWith('import-')&&!ReoRiteLexicons.rows(saved.lexicon))saved.lexicon='v6.5';
    return validate(saved);
  }
  function save(input){const settings=validate(input);localStorage.setItem(key,JSON.stringify(settings));return settings;}
  function commitLexicons(next){
    next=ReoRiteLexicons.validateImports(next);localStorage.setItem(lexiconKey,JSON.stringify(next));ReoRiteLexicons.setImports(next);
    // The loader safely normalizes a removed selected ID even if a quota blocks the preference write.
    const current=load();try{save(current);}catch(_){}return current;
  }
  globalThis.ScanSettings=Object.freeze({defaults,validate,load,save,commitLexicons});
})();
