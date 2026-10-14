(() => {
  'use strict';
  let run=0,audio=null,url=null,controller=null,finish=null,keys=null;
  function credentials(input){if(!isSecureContext||!crypto.subtle)throw new Error('Polly needs HTTPS or localhost. Use a device voice on HTTP.');keys=ReoRitePolly.credentials(input);}
  function clearCredentials(){stop();keys=null;}
  function stop(){run++;controller?.abort();controller=null;if(audio){audio.pause();audio.removeAttribute('src');audio.load();audio=null;}if(url){URL.revokeObjectURL(url);url=null;}finish?.();finish=null;globalThis.speechSynthesis?.cancel();}
  function device(text,settings,update,token){
    if(!globalThis.speechSynthesis||!globalThis.SpeechSynthesisUtterance)throw new Error('Device speech is unavailable. Choose Amazon Polly on HTTPS or localhost.');
    const voices=speechSynthesis.getVoices(),voice=voices.find(v=>v.voiceURI===settings.deviceVoice)||voices.find(v=>/^mi(?:-|$)/i.test(v.lang))||voices.find(v=>v.lang==='en-NZ');
    const utterance=new SpeechSynthesisUtterance(text);if(voice)utterance.voice=voice;utterance.lang=voice?.lang||'mi-NZ';utterance.rate=settings.speechRate/100;
    utterance.onstart=()=>{if(run===token)update('Playing with a device voice.');};utterance.onend=()=>{if(run===token)update('Playback finished.');};utterance.onerror=event=>{if(run===token&&event.error!=='canceled'&&event.error!=='interrupted')update('Device voice could not play this text. Choose another voice or Polly.',true);};speechSynthesis.speak(utterance);
  }
  async function play(text,settings,scope,update){
    if(typeof text!=='string'||!text.trim())throw new Error('Scan or select some text first.');stop();const token=run;
    if(settings.ttsProvider==='browser'){device(text,settings,update,token);return;}
    if(!isSecureContext||!crypto.subtle)throw new Error('Polly needs HTTPS or localhost. Use a device voice on HTTP.');
    if(!keys)throw new Error('Enter AWS playback keys in Settings. Keys stay in this tab until it closes.');
    const chunks=ReoRiteSpeech.plan(text,settings,scope),local=controller=new AbortController(),signal=local.signal;
    const request=async index=>{const timeout=setTimeout(()=>local.abort(),25000);try{return await ReoRitePolly.synthesize(chunks[index],settings,keys,signal);}finally{clearTimeout(timeout);}};
    try{
      let pending=request(0);pending.catch(()=>{});
      for(let index=0;index<chunks.length;index++){
        update('Preparing audio '+(index+1)+' of '+chunks.length+'…');const result=await pending;if(run!==token)return;
        const data=Uint8Array.from(atob(result.base64),ch=>ch.charCodeAt(0));url=URL.createObjectURL(new Blob([data],{type:result.mime}));audio=new Audio(url);
        const ended=new Promise((resolve,reject)=>{finish=resolve;audio.addEventListener('ended',resolve,{once:true});audio.addEventListener('error',()=>reject(new Error('Audio could not be decoded.')),{once:true});});ended.catch(()=>{});
        await audio.play();if(run!==token)return;pending=index+1<chunks.length?request(index+1):null;pending?.catch(()=>{});update('Playing '+(index+1)+' of '+chunks.length+' · Polly');await ended;if(run!==token)return;
        URL.revokeObjectURL(url);url=null;audio=null;finish=null;
      }if(run===token){controller=null;update('Playback finished.');}
    }catch(error){if(run===token){stop();throw error;}}
  }
  globalThis.ScanPlayer=Object.freeze({play,stop,credentials,clearCredentials,get hasCredentials(){return !!keys;}});
})();
