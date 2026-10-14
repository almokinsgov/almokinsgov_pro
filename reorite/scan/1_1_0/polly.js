(() => {
  'use strict';
  const encoder=new TextEncoder();
  const bytes=value=>typeof value==='string'?encoder.encode(value):value;
  const hex=value=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
  const sha=async value=>hex(await crypto.subtle.digest('SHA-256',bytes(value)));
  async function hmac(key,value){const imported=await crypto.subtle.importKey('raw',bytes(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',imported,bytes(value));}
  function endpoint(region){if(!/^[a-z]{2}(?:-[a-z]+){1,3}-\d$/.test(region))throw new Error('Invalid AWS region.');return `https://polly.${region}.${region.startsWith('cn-')?'amazonaws.com.cn':'amazonaws.com'}`;}
  function credentials(value){
    if(!value || !/^(?:AKIA|ASIA)[A-Z0-9]{16}$/.test(value.accessKeyId) || !/^[A-Za-z0-9/+=]{40}$/.test(value.secretAccessKey)) throw new Error('Enter valid AWS access and secret keys in Settings & config → Playback.');
    if(value.sessionToken && (typeof value.sessionToken!=='string' || /[\s\u0000-\u001f\u007f]/.test(value.sessionToken) || value.sessionToken.length>10000))throw new Error('Invalid AWS session token.');
    if(value.accessKeyId.startsWith('ASIA') && !value.sessionToken)throw new Error('Temporary AWS credentials require a session token.');
    return {accessKeyId:value.accessKeyId,secretAccessKey:value.secretAccessKey,sessionToken:value.sessionToken||''};
  }
  async function sign({region,credentials:creds,payload,now=new Date()}) {
    credentials(creds);const host=new URL(endpoint(region)).host, timestamp=now.toISOString().replace(/[:-]|\.\d{3}/g,''), date=timestamp.slice(0,8);
    const headers={'content-type':'application/json',host,'x-amz-date':timestamp,'x-amz-content-sha256':await sha(payload)};
    if(creds.sessionToken)headers['x-amz-security-token']=creds.sessionToken;
    const names=Object.keys(headers).sort(), signedHeaders=names.join(';');
    const canonicalRequest=['POST','/v1/speech','',names.map(key=>`${key}:${headers[key]}\n`).join(''),signedHeaders,await sha(payload)].join('\n');
    const scope=`${date}/${region}/polly/aws4_request`, stringToSign=['AWS4-HMAC-SHA256',timestamp,scope,await sha(canonicalRequest)].join('\n');
    const key=await hmac(await hmac(await hmac(await hmac('AWS4'+creds.secretAccessKey,date),region),'polly'),'aws4_request');
    const signature=hex(await hmac(key,stringToSign));
    headers.authorization=`AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    delete headers.host;return {headers,canonicalRequest,signature};
  }
  async function synthesize(ssml,settings,creds,signal) {
    if(typeof ssml!=='string' || ssml.length>6000 || !ssml.startsWith('<speak>'))throw new Error('Invalid playback text.');
    const payload=JSON.stringify({Text:ssml,TextType:'ssml',OutputFormat:'mp3',VoiceId:settings.voiceId,Engine:settings.speechEngine,LanguageCode:settings.languageCode});
    const {headers}=await sign({region:settings.awsRegion,credentials:creds,payload});
    let response;
    try{response=await fetch(endpoint(settings.awsRegion)+'/v1/speech',{method:'POST',headers,body:payload,signal,redirect:'error',credentials:'omit'});}
    catch(error){if(signal?.aborted)throw new Error('Playback cancelled.');throw new Error('Could not reach Amazon Polly. Check your connection and region.');}
    if(!response.ok){
      if(response.status===401 || response.status===403)throw new Error('Polly access denied. Check your keys, session token and polly:SynthesizeSpeech permission.');
      if(response.status===429)throw new Error('Polly is busy. Try playback again shortly.');
      if(response.status===400)throw new Error('Polly rejected this pronunciation or voice setting. Check voice/engine/language and try another word.');
      throw new Error('Amazon Polly could not synthesize this text. Try again later.');
    }
    const audio=new Uint8Array(await response.arrayBuffer());
    if(!audio.length || audio.length>15000000)throw new Error('Polly returned an invalid audio response.');
    let binary='';for(let i=0;i<audio.length;i+=8192)binary+=String.fromCharCode(...audio.subarray(i,i+8192));
    return {base64:btoa(binary),mime:'audio/mpeg'};
  }
  globalThis.ReoRitePolly=Object.freeze({endpoint,credentials,sign,synthesize});
})();
