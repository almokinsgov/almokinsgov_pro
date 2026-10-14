(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),frame=$('#frame'),video=$('#video'),media=$('#media'),overlay=$('#overlay'),form=$('#settingsForm'),popup=$('#wordPopup');
  let settings;try{settings=ScanSettings.load();}catch(error){settings=ScanSettings.defaults;setTimeout(()=>tell('Saved settings could not be loaded. Restore defaults in Settings to repair.',true),0);}
  const state={stream:null,live:false,hasFrame:false,busy:false,selecting:false,region:null,words:[],result:null,job:0,load:0,cameraRequest:0,popupId:null,pinned:false,anchor:null};
  let drag=null,hoverTimer=null,leaveTimer=null,holdTimer=null;
  const node=(tag,text,attrs={})=>{const element=document.createElement(tag);element.textContent=text;for(const [key,value]of Object.entries(attrs))element.setAttribute(key,value);return element;};
  function tell(text,error=false){$('#status').textContent=text;$('#status').classList.toggle('error',error);}
  function audioStatus(text,error=false){$('#audioStatus').textContent=text;$('#audioStatus').classList.toggle('error',error);if(error)tell(text,true);}
  function setBusy(value){state.busy=value;$('#scanBusy').hidden=!value;updateControls();}
  function view(name){
    if(name!=='scan')stopCamera(true);
    for(const value of ['scan','review','settings'])$('#'+value+'View').hidden=value!==name;
    for(const button of document.querySelectorAll('nav [data-view]')){if(button.dataset.view===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
    closePopup();if(name==='review')renderReview();window.scrollTo({top:0});
  }
  for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>view(button.dataset.view));
  function dimensions(){return state.live?{width:video.videoWidth,height:video.videoHeight}:{width:frame.width,height:frame.height};}
  function layout(){
    const {width,height}=dimensions();if(!width||!height)return;
    const maxHeight=innerWidth<=760?500:580,fitted=Math.min($('#stageShell').clientWidth,maxHeight*width/height);media.style.width=fitted+'px';
    renderRegion();for(const button of overlay.querySelectorAll('[data-word-id]')){const word=state.result?.words.find(word=>word.id===button.dataset.wordId);if(word)button.style.fontSize=Math.max(9,Math.min(38,word.box.height/frame.height*media.getBoundingClientRect().height*.78))+'px';}positionPopup();
  }
  new ResizeObserver(layout).observe($('#stageShell'));window.addEventListener('resize',layout);window.addEventListener('scroll',positionPopup,{passive:true});
  function updateControls(){
    const available=state.hasFrame||state.live;
    for(const id of ['scan','draw','whole','rotate','clear'])$('#'+id).disabled=!available||state.busy;
    $('#scan').textContent=state.region?'Scan selected area →':'Scan text →';$('#draw').setAttribute('aria-pressed',String(state.selecting));media.classList.toggle('selecting',state.selecting);
    $('#resume').hidden=!state.stream||state.live;$('#stopCamera').hidden=!state.stream;$('#camera').textContent=state.live?'Camera live':'Camera';
    $('#sourceState').textContent=state.busy?'Scanning':state.live?'Live camera':state.hasFrame?'Captured / image':'Ready';
    $('#selectionInfo').textContent=state.selecting?'Drag a rectangle over the text.':state.region?'Selected area · '+Math.round(state.region.width)+' × '+Math.round(state.region.height)+' px':available?'Whole frame selected.':'Choose a camera or image to begin.';
    for(const id of ['playAll','playDetected','review','copyText','exportScan'])$('#'+id).disabled=!state.words.length||state.busy;
    $('#playDetected').disabled=!state.result?.words.some(word=>word.included)||state.busy;
  }
  function renderRegion(){const element=$('#selection'),region=state.region,{width,height}=dimensions();element.hidden=!region;if(!region||!width)return;element.style.left=region.x/width*100+'%';element.style.top=region.y/height*100+'%';element.style.width=region.width/width*100+'%';element.style.height=region.height/height*100+'%';}
  function clearResults(){ScanPlayer.stop();state.words=[];state.result=null;overlay.replaceChildren();$('#resultText').replaceChildren(node('p','Your scanned text will appear here.',{class:'placeholder'}));$('#resultTitle').textContent='A little closer to the words.';$('#resultSummary').textContent='Green overlays show detected te reo. Hover, tap or hold a word to review it.';$('#reviewCount').textContent='0';closePopup();renderReview();}
  function cancelScan(quiet=false){state.job++;void ScanOCR.stop();setBusy(false);if(!quiet)tell('Scan cancelled.');}
  function stopCamera(keepFrame=false){
    state.cameraRequest++;if(keepFrame&&state.live&&video.videoWidth)capture();
    state.stream?.getTracks().forEach(track=>track.stop());state.stream=null;state.live=false;video.srcObject=null;video.hidden=true;updateControls();
  }
  function capture(){
    if(!state.live||!video.videoWidth)return;
    frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d').drawImage(video,0,0);state.live=false;state.hasFrame=true;video.hidden=true;frame.hidden=false;state.region=null;clearResults();layout();updateControls();
  }
  async function camera(){
    if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){tell('Live camera needs HTTPS or localhost. On your phone, use Take photo, or import an image.',true);return;}
    cancelScan(true);stopCamera();const token=++state.cameraRequest;tell('Opening camera…');
    try{
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:settings.cameraFacing},width:{ideal:1920},height:{ideal:1080}},audio:false});
      if(token!==state.cameraRequest){stream.getTracks().forEach(track=>track.stop());return;}
      state.stream=stream;video.srcObject=stream;await video.play();
      if(token!==state.cameraRequest){stream.getTracks().forEach(track=>track.stop());return;}
      state.live=true;state.region=null;state.selecting=false;clearResults();frame.hidden=true;video.hidden=false;media.hidden=false;$('#emptyStage').hidden=true;$('#sourceLabel').textContent='Camera · scan to freeze a frame';layout();updateControls();tell('Camera ready. Scan the whole frame or draw a rectangle.');
    }catch(error){if(token!==state.cameraRequest)return;stopCamera();const messages={NotAllowedError:'Camera permission was denied. Allow it in your browser, or import an image.',NotFoundError:'No camera found. Import an image instead.',NotReadableError:'The camera is busy. Close other camera apps or import an image.'};tell(messages[error.name]||'Could not open the camera. Try an image or another camera setting.',true);}
  }
  for(const button of document.querySelectorAll('[data-open-camera]'))button.onclick=camera;
  $('#stopCamera').onclick=()=>{stopCamera(true);tell('Camera stopped. The captured frame remains available.');};$('#resume').onclick=async()=>{if(!state.stream)return camera();cancelScan(true);clearResults();state.live=true;state.region=null;frame.hidden=true;video.hidden=false;await video.play();layout();updateControls();tell('Camera live.');};
  async function loadImage(file){
    if(!file)return;
    if(file.size>25*1024*1024)throw new Error('Image is too large. Choose a photo below 25 MB.');
    if(!/^image\/(png|jpeg|webp|bmp|gif|avif|heic|heif)$/i.test(file.type))throw new Error('Choose a readable PNG, JPEG, WebP or BMP image.');
    const token=++state.load,url=URL.createObjectURL(file);let image;
    try{image=await new Promise((resolve,reject)=>{const element=new Image();element.onload=()=>resolve(element);element.onerror=()=>reject(new Error('This image could not be opened. Try PNG or JPEG.'));element.src=url;});
      if(token!==state.load)return;if(!image.naturalWidth||image.naturalWidth*image.naturalHeight>32000000)throw new Error('Image dimensions are too large. Choose an image below 32 megapixels.');
      cancelScan(true);stopCamera();const scale=Math.min(1,3200/Math.max(image.naturalWidth,image.naturalHeight));frame.width=Math.round(image.naturalWidth*scale);frame.height=Math.round(image.naturalHeight*scale);frame.getContext('2d').drawImage(image,0,0,frame.width,frame.height);
      state.hasFrame=true;state.region=null;state.selecting=false;clearResults();video.hidden=true;frame.hidden=false;media.hidden=false;$('#emptyStage').hidden=true;$('#sourceLabel').textContent=file.name||'Imported image';layout();updateControls();view('scan');tell('Image ready. Scan the whole image or draw a rectangle.');
    }finally{URL.revokeObjectURL(url);}
  }
  for(const button of document.querySelectorAll('[data-import-image]'))button.onclick=()=>$('#imageFile').click();$('#takePhoto').onclick=()=>$('#photoFile').click();
  for(const id of ['imageFile','photoFile'])$('#'+id).onchange=async event=>{try{await loadImage(event.target.files[0]);}catch(error){tell(error.message,true);}finally{event.target.value='';}};
  $('#stageShell').addEventListener('dragover',event=>event.preventDefault());$('#stageShell').addEventListener('drop',async event=>{event.preventDefault();try{await loadImage(event.dataTransfer.files[0]);}catch(error){tell(error.message,true);}});
  $('#sample').onclick=()=>{cancelScan(true);stopCamera();frame.width=1400;frame.height=760;const ctx=frame.getContext('2d');ctx.fillStyle='#fffef7';ctx.fillRect(0,0,1400,760);ctx.fillStyle='#234333';ctx.font='bold 75px Arial';ctx.fillText('Haere mai ki te marae.',90,170);ctx.font='68px Arial';ctx.fillText('Ko te reo Māori he taonga.',90,310);ctx.fillText('Taiaha',90,450);ctx.fillStyle='#5b6a60';ctx.font='42px Arial';ctx.fillText('Welcome to our community.',90,620);state.hasFrame=true;state.region=null;state.selecting=false;clearResults();frame.hidden=false;media.hidden=false;$('#emptyStage').hidden=true;$('#sourceLabel').textContent='Sample · Māori + English';layout();updateControls();tell('Sample ready. Press Scan text to recognize it locally.');};
  $('#rotate').onclick=()=>{if(state.live)capture();cancelScan(true);const copy=document.createElement('canvas');copy.width=frame.width;copy.height=frame.height;copy.getContext('2d').drawImage(frame,0,0);frame.width=copy.height;frame.height=copy.width;const ctx=frame.getContext('2d');ctx.translate(frame.width,0);ctx.rotate(Math.PI/2);ctx.drawImage(copy,0,0);state.region=null;clearResults();layout();updateControls();tell('Image rotated. Scan again.');};
  $('#clear').onclick=()=>{state.load++;cancelScan(true);stopCamera();ScanPlayer.stop();state.hasFrame=false;state.region=null;state.selecting=false;frame.width=1;frame.height=1;media.hidden=true;$('#emptyStage').hidden=false;clearResults();updateControls();tell('Cleared. Choose another camera or image.');};
  $('#draw').onclick=()=>{state.selecting=!state.selecting;closePopup();updateControls();};$('#whole').onclick=()=>{state.region=null;state.selecting=false;renderRegion();updateControls();tell('Whole frame selected.');};
  media.addEventListener('pointerdown',event=>{if(!state.selecting||state.busy||event.button!==0)return;if(state.live)capture();const size=dimensions();drag={pointer:event.pointerId,start:ScanCore.point(event,media.getBoundingClientRect(),size.width,size.height),previous:state.region};media.setPointerCapture(event.pointerId);event.preventDefault();});
  media.addEventListener('pointermove',event=>{if(!drag||drag.pointer!==event.pointerId)return;const size=dimensions();state.region=ScanCore.selection(drag.start,ScanCore.point(event,media.getBoundingClientRect(),size.width,size.height),size.width,size.height);renderRegion();});
  media.addEventListener('pointerup',event=>{if(!drag||drag.pointer!==event.pointerId)return;const size=dimensions(),region=ScanCore.selection(drag.start,ScanCore.point(event,media.getBoundingClientRect(),size.width,size.height),size.width,size.height),rect=media.getBoundingClientRect();if(region.width/size.width*rect.width<8||region.height/size.height*rect.height<8){state.region=drag.previous;tell('Draw a larger rectangle around readable text.',true);}else{state.region=region;tell('Area selected. Press Scan selected area.');}drag=null;state.selecting=false;renderRegion();updateControls();});
  media.addEventListener('pointercancel',()=>{if(drag)state.region=drag.previous;drag=null;state.selecting=false;renderRegion();updateControls();});
  async function scan(){
    if(state.busy||!state.hasFrame&&!state.live)return;if(state.live)capture();closePopup();const token=++state.job;setBusy(true);$('#ocrProgress').value=0;
    try{const result=await ScanOCR.recognize(frame,state.region,settings,(status,progress)=>{if(token!==state.job)return;$('#ocrStage').textContent=status==='recognizing text'?'Reading text…':'Preparing local OCR…';$('#ocrProgress').value=progress;});
      if(token!==state.job)return;state.words=result.words;recalculate();tell(state.words.length?'Scan complete. Select a green word to review or play it.':'No readable text found. Try a sharper image, a tighter rectangle or another layout setting.');
    }catch(error){if(token===state.job)tell(error.message==='Scan cancelled.'?error.message:'Could not recognize this image. Try a smaller, clearer area or another OCR setting.',true);}
    finally{if(token===state.job)setBusy(false);}
  }
  $('#scan').onclick=scan;$('#cancelScan').onclick=()=>cancelScan();
  function recalculate(){
    state.result=ScanCore.analyze(state.words,settings);const words=state.result.words,detected=words.filter(word=>word.included).length,review=words.filter(word=>word.needsReview).length;
    $('#lexiconBadge').textContent=ReoRiteLexicons.label(settings.lexicon);$('#resultTitle').textContent=words.length?'Your text, in focus.':'No text found.';$('#resultSummary').textContent=words.length?words.length+' words · '+detected+' te reo · '+review+' to review':'Try a clearer image or select a tighter region.';$('#reviewCount').textContent=String(review);renderOverlays();renderText();renderReview();updateControls();
  }
  function renderOverlays(){
    overlay.replaceChildren();const rect=media.getBoundingClientRect();
    for(const word of state.result?.words||[]){if(!word.included)continue;const b=word.box,button=node('button',ScanCore.label(word,settings.display),{class:'ocr-word'+(word.needsReview?' uncertain':''),'data-word-id':word.id,'aria-label':'Review '+word.text});button.style.left=b.x/frame.width*100+'%';button.style.top=b.y/frame.height*100+'%';button.style.width=b.width/frame.width*100+'%';button.style.height=b.height/frame.height*100+'%';button.style.fontSize=Math.max(9,Math.min(38,b.height/frame.height*rect.height*.78))+'px';
      button.onclick=event=>{event.stopPropagation();openPopup(word.id,button,true);};button.onfocus=()=>openPopup(word.id,button,false);button.onpointerenter=()=>{if(settings.hoverDetails&&!state.pinned){clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>openPopup(word.id,button,false),140);}};button.onpointerleave=scheduleClose;button.onpointerdown=()=>{holdTimer=setTimeout(()=>openPopup(word.id,button,true),450);};button.onpointerup=()=>clearTimeout(holdTimer);button.onpointercancel=()=>clearTimeout(holdTimer);button.oncontextmenu=event=>event.preventDefault();overlay.append(button);
    }
  }
  function renderText(){const host=$('#resultText');host.replaceChildren();let previous=null;for(const word of state.result?.words||[]){if(previous!=null)host.append(document.createTextNode(previous===word.line?' ':'\n'));previous=word.line;const button=node('button',word.text,{class:'text-word'+(word.included?' detected':''),'aria-label':'Review text '+word.text});button.onclick=()=>openPopup(word.id,button,true);host.append(button);}}
  function renderReview(){const list=$('#wordList');list.replaceChildren();const q=$('#reviewSearch').value.trim().toLowerCase();let count=0;for(const word of state.result?.words||[]){if(!word.text.toLowerCase().includes(q))continue;if(count++>=200)continue;const row=node('article','',{class:'review-row'}),info=node('div',''),title=node('h3',word.text),metrics=node('p',Math.round(word.confidence)+'% OCR · '+Math.round(word.score*100)+'% te reo · '+(word.reviewed?'Reviewed':word.needsReview?'Needs review':'Automatic'),{class:word.needsReview?'uncertain-label':''});info.append(title,metrics);const actions=node('div','',{class:'button-row'}),edit=node('button','Review',{class:'button','aria-label':'Review word '+word.text});edit.onclick=()=>openPopup(word.id,edit,true);const play=node('button','▶',{class:'icon-button','aria-label':'Play '+word.text});play.onclick=()=>playText(word.text,'word');actions.append(edit,play);row.append(info,actions);list.append(row);}if(!count)list.append(node('p',state.words.length?'No matching words.':'Scan an image to review its words here.',{class:'muted'}));if(count>200)list.append(node('p','Showing the first 200 matches. Use search to find another word.',{class:'muted'}));}
  $('#reviewSearch').oninput=renderReview;$('#review').onclick=()=>view('review');
  function openPopup(id,anchor,pinned){const word=state.result?.words.find(word=>word.id===id);if(!word)return;clearTimeout(leaveTimer);clearTimeout(hoverTimer);state.popupId=id;state.pinned=pinned;state.anchor=anchor;$('#popupWord').textContent=word.text;$('#popupMetrics').textContent=Math.round(word.confidence)+'% OCR confidence · '+Math.round(word.score*100)+'% likely te reo';$('#popupIpa').textContent=word.ipa||'No complete IPA available';$('#popupPhonetic').textContent=word.phonetic||'No phonetic text available';$('#wordEdit').value=word.text;$('#wordOverride').value=word.override;$('#wordReviewed').checked=word.reviewed;$('#wordEditForm').hidden=!pinned;$('#pinReview').hidden=pinned;popup.hidden=false;positionPopup();}
  function positionPopup(){if(popup.hidden||!state.anchor?.isConnected)return;const rect=state.anchor.getBoundingClientRect(),box=popup.getBoundingClientRect();let left=ScanCore.clamp(rect.left+rect.width/2-box.width/2,12,innerWidth-box.width-12),top;
    if(rect.top>=box.height+22)top=rect.top-box.height-10;
    else if(innerHeight-rect.bottom>=box.height+22)top=rect.bottom+10;
    else if(innerWidth-rect.right>=box.width+22){left=rect.right+10;top=rect.top-30;}
    else if(rect.left>=box.width+22){left=rect.left-box.width-10;top=rect.top-30;}
    else top=rect.bottom+10;
    popup.style.left=left+'px';popup.style.top=ScanCore.clamp(top,12,Math.max(12,innerHeight-box.height-12))+'px';}
  function closePopup(){clearTimeout(hoverTimer);clearTimeout(leaveTimer);clearTimeout(holdTimer);popup.hidden=true;state.popupId=null;state.pinned=false;state.anchor=null;}
  function scheduleClose(){if(state.pinned)return;clearTimeout(leaveTimer);leaveTimer=setTimeout(closePopup,300);}
  popup.onpointerenter=()=>clearTimeout(leaveTimer);popup.onpointerleave=scheduleClose;$('#closePopup').onclick=closePopup;document.addEventListener('pointerdown',event=>{if(!popup.hidden&&!popup.contains(event.target)&&!event.target.closest('[data-word-id],.text-word,.review-row'))closePopup();});
  $('#pinReview').onclick=()=>{state.pinned=true;$('#wordEditForm').hidden=false;$('#pinReview').hidden=true;positionPopup();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closePopup();if(state.selecting){state.selecting=false;drag=null;updateControls();}}});
  $('#wordEditForm').onsubmit=event=>{event.preventDefault();const index=state.words.findIndex(word=>word.id===state.popupId);if(index<0)return;try{const text=ScanCore.reviewText($('#wordEdit').value);state.words[index]={...state.words[index],text,override:$('#wordOverride').value,reviewed:$('#wordReviewed').checked};recalculate();closePopup();tell('Word review applied. Text and pronunciation updated.');}catch(error){tell(error.message,true);}};
  async function playText(text,scope){try{await ScanPlayer.play(text,settings,scope,audioStatus);}catch(error){audioStatus(error.message,true);}}
  $('#playWord').onclick=()=>{state.pinned=true;const word=state.result?.words.find(word=>word.id===state.popupId);if(word)void playText(word.text,'word');};$('#playLine').onclick=()=>{state.pinned=true;const word=state.result?.words.find(word=>word.id===state.popupId);if(word)void playText(state.result.words.filter(item=>item.line===word.line).map(item=>item.text).join(' '),'selection');};
  $('#playAll').onclick=()=>playText(state.result?.text||'','selection');$('#playDetected').onclick=()=>playText((state.result?.words||[]).filter(word=>word.included).map(word=>word.text).join(' '),'block');for(const id of ['stopAudio','popupStop'])$('#'+id).onclick=()=>{ScanPlayer.stop();audioStatus('Playback stopped.');};
  $('#copyText').onclick=async()=>{try{await navigator.clipboard.writeText(state.result?.text||'');tell('Text copied.');}catch(_){tell('Clipboard unavailable here. Use Export reviewed text instead.',true);}};
  function download(filename,value){const url=URL.createObjectURL(new Blob([value],{type:'application/json'})),link=node('a','');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  $('#exportScan').onclick=()=>{if(state.result)download('reorite-scan-text.json',JSON.stringify({version:1,text:state.result.text,lexicon:ReoRiteLexicons.label(settings.lexicon),words:state.words.map(({id,text,originalText,confidence,box,reviewed,override})=>({id,text,originalText,confidence,box,reviewed,override}))},null,2));};
  function populate(){
    const select=$('#lexiconSelect');select.replaceChildren();for(const item of ReoRiteLexicons.list()){const option=node('option',item.name,{value:item.id});select.append(option);}
    for(const [key,value]of Object.entries(settings)){const field=form.elements.namedItem(key);if(!field)continue;if(field.type==='checkbox')field.checked=value;else field.value=value;}
    $('#lexiconBadge').textContent=ReoRiteLexicons.label(settings.lexicon);
  }
  function collect(){const next={...settings};for(const key of Object.keys(next)){const field=form.elements.namedItem(key);if(!field)continue;if(field.type==='checkbox')next[key]=field.checked;else if(field.type==='number')next[key]=Number(field.value);else next[key]=field.value;}return ScanSettings.validate(next);}
  function settingsStatus(text,error=false){$('#settingsStatus').textContent=text;$('#settingsStatus').classList.toggle('error',error);}
  function apply(next){settings=ScanSettings.save(next);populate();if(state.words.length)recalculate();audioStatus(settings.ttsProvider==='browser'?'Device voice · pronunciation depends on installed voices':'Amazon Polly · lexicon IPA');}
  form.onsubmit=event=>{event.preventDefault();try{apply(collect());settingsStatus('Settings saved. OCR changes apply on the next scan.');}catch(error){settingsStatus(error.message,true);}};
  $('#resetSettings').onclick=()=>{try{apply(ScanSettings.defaults);settingsStatus('Defaults restored.');}catch(error){settingsStatus(error.message,true);}};
  $('#exportSettings').onclick=()=>{try{download('reorite-scan-settings.json',JSON.stringify({format:'reorite-scan-settings-v1',settings:collect()},null,2));settingsStatus('Settings exported. Keys and images are excluded.');}catch(error){settingsStatus(error.message,true);}};
  $('#importSettings').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>100000)throw new Error('Settings file is too large.');const parsed=JSON.parse(await file.text());if(parsed.format!=='reorite-scan-settings-v1')throw new Error('Choose a ReoRite Scan settings export.');apply(ScanSettings.validate(parsed.settings));settingsStatus('Settings imported.');}catch(error){settingsStatus(error.message,true);}finally{event.target.value='';}};
  function voices(){const select=$('#deviceVoice'),current=select.value||settings.deviceVoice;select.replaceChildren(node('option','Automatic · Māori if available',{value:''}));for(const voice of globalThis.speechSynthesis?.getVoices()||[])select.append(node('option',voice.name+' · '+voice.lang,{value:voice.voiceURI}));select.value=[...select.options].some(option=>option.value===current)?current:'';}
  globalThis.speechSynthesis?.addEventListener('voiceschanged',voices);voices();populate();
  $('#setKeys').onclick=()=>{try{const next=collect();ScanPlayer.credentials(Object.fromEntries(['accessKeyId','secretAccessKey','sessionToken'].map(key=>[key,$('#'+key).value.trim()])));apply({...next,ttsProvider:'polly'});for(const id of ['accessKeyId','secretAccessKey','sessionToken'])$('#'+id).value='';$('#keyStatus').textContent='Polly keys are in this tab’s memory.';settingsStatus('Polly configured for this tab.');}catch(error){settingsStatus(error.message,true);}};
  $('#clearKeys').onclick=()=>{ScanPlayer.clearCredentials();for(const id of ['accessKeyId','secretAccessKey','sessionToken'])$('#'+id).value='';$('#keyStatus').textContent='No Polly keys in memory.';settingsStatus('Playback keys cleared.');};
  if(!isSecureContext){$('#secureNotice').hidden=false;$('#secureNotice').textContent='Live camera and Polly playback need HTTPS or localhost. On HTTP, use Take photo / image import and a device voice.';for(const id of ['accessKeyId','secretAccessKey','sessionToken','setKeys'])$('#'+id).disabled=true;}
  mountLexiconManager($('#lexiconManager'),{async commit(next){settings=ScanSettings.commitLexicons(next);},changed(){populate();if(state.words.length)recalculate();},async select(id){apply({...settings,lexicon:id});}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera(true);});window.addEventListener('pagehide',()=>{stopCamera();ScanPlayer.stop();void ScanOCR.stop();});
  updateControls();layout();
  // Read-only diagnostics for regression tests and local troubleshooting; no image pixels or keys.
  globalThis.ReoRiteScan=Object.freeze({snapshot:()=>({live:state.live,hasFrame:state.hasFrame,busy:state.busy,region:state.region,dimensions:dimensions(),words:state.result?.words||[],settings:{...settings}})});
})();
