// Credentials are deliberately separate from settings and all export formats.
(() => {
  'use strict';
  const key='reorite-scan-aws-keys-v1';
  function secure(){if(!isSecureContext||!crypto.subtle)throw new Error('Polly needs HTTPS or localhost.');}
  function use(input,remember){
    secure();if(typeof remember!=='boolean')throw new Error('Choose whether to save keys.');
    const valid=ReoRitePolly.credentials(input);
    // Persist before replacing active keys, so rejected writes leave playback unchanged.
    try{if(remember)localStorage.setItem(key,JSON.stringify(valid));else localStorage.removeItem(key);}
    catch(_){throw new Error('Browser storage could not update playback keys. Try again or allow local storage.');}
    ScanPlayer.credentials(valid);
  }
  function restore(){
    if(!isSecureContext||!crypto.subtle)return false;
    try{const value=localStorage.getItem(key);if(!value)return false;ScanPlayer.credentials(ReoRitePolly.credentials(JSON.parse(value)));return true;}
    catch(_){throw new Error('Saved playback keys could not be loaded. Clear keys and enter them again.');}
  }
  function forget(){
    try{localStorage.removeItem(key);}catch(_){throw new Error('Browser storage could not remove saved keys. Try again or allow local storage.');}
    ScanPlayer.clearCredentials();
  }
  globalThis.ScanCredentials=Object.freeze({use,restore,forget});
})();
