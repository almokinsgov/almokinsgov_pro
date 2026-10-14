(() => {
  'use strict';
  let worker=null,creating=null,key='',generation=0,reporter=()=>{};
  async function stop(){generation++;const current=worker,pending=creating;worker=null;creating=null;key='';reporter=()=>{};if(pending)pending.then(ready=>ready.terminate()).catch(()=>{});if(current)await current.terminate().catch(()=>{});}
  async function recognize(canvas,region,settings,progress){
    const token=generation,wanted=settings.ocrQuality+':'+settings.ocrLanguages;reporter=progress;
    if(worker&&key!==wanted){await stop();return recognize(canvas,region,settings,progress);}
    if(!worker){
      if(!creating){const base=new URL('.',location.href);
        // Tesseract 7 relaxed SIMD lacks DotProductSSE for float best models (#1080).
        // Detect regular SIMD explicitly, retaining the scalar fallback for older devices.
        const core=settings.ocrQuality==='best'?'vendor/core/tesseract-core-'+(await wasmFeatureDetect.simd()?'simd-':'')+'lstm.wasm.js':'vendor/core/';
        if(token!==generation)throw new Error('Scan cancelled.');
        creating=Tesseract.createWorker(settings.ocrLanguages.split('+'),1,{workerPath:new URL('vendor/worker.min.js',base).href,corePath:new URL(core,base).href,langPath:new URL('vendor/lang/'+settings.ocrQuality,base).href,workerBlobURL:false,cacheMethod:'none',logger:message=>{if(generation===token)reporter(message.status,Number(message.progress)||0);},errorHandler:()=>{}},{load_system_dawg:'1'});}
      const pending=creating;let ready;try{ready=await pending;}finally{if(creating===pending)creating=null;}
      if(token!==generation){await ready.terminate().catch(()=>{});throw new Error('Scan cancelled.');}worker=ready;key=wanted;
    }
    const selected=ScanCore.crop(region,canvas.width,canvas.height),largest=Math.max(selected.width,selected.height);
    // Upscale small print while bounding mobile memory and preserving source coordinates.
    const scale=Math.min(2,2400/largest),input=document.createElement('canvas');input.width=Math.max(1,Math.round(selected.width*scale));input.height=Math.max(1,Math.round(selected.height*scale));
    const ctx=input.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,input.width,input.height);ctx.drawImage(canvas,selected.x,selected.y,selected.width,selected.height,0,0,input.width,input.height);
    if(settings.preprocess==='contrast'){
      const pixels=ctx.getImageData(0,0,input.width,input.height);
      for(let i=0;i<pixels.data.length;i+=4){const grey=pixels.data[i]*.299+pixels.data[i+1]*.587+pixels.data[i+2]*.114,v=ScanCore.clamp((grey-128)*1.5+128,0,255);pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}ctx.putImageData(pixels,0,0);
    }
    await worker.setParameters({tessedit_pageseg_mode:{auto:'3',block:'6',sparse:'11'}[settings.ocrLayout],preserve_interword_spaces:'1',user_defined_dpi:'300'});
    const output=await worker.recognize(input,{}, {text:true,blocks:true});
    if(token!==generation)throw new Error('Scan cancelled.');
    return {words:ScanCore.flatten(output.data,selected,scale,canvas.width,canvas.height),confidence:output.data.confidence,region:selected};
  }
  globalThis.ScanOCR=Object.freeze({recognize,stop});
})();
