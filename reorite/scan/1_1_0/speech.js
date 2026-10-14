(() => {
  'use strict';
  if (globalThis.ReoRiteSpeech) return;
  const xml = value => String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
  function plan(text, settings, scope='selection') {
    if(typeof text!=='string' || !text.trim() || text.length>500000) throw new Error('Select readable text before playing.');
    if(!['word','block','selection','detected'].includes(scope)) throw new Error('Unknown playback scope.');
    const analysis=ReoRiteEngine.analyze(text,{...settings,joinMode:settings.speechJoinMode});
    const pieces=[];let index=0;
    // Bound literal pieces before escaping; never slice XML entities or IPA tags.
    function literal(raw){const characters=Array.from(raw);for(let i=0;i<characters.length;i+=120)pieces.push({raw:characters.slice(i,i+120).join(''),ipa:null});}
    for(const part of analysis.parts) {
      if(part.type==='word') {
        const word=analysis.words[index++];
        const included=scope==='word' || scope==='block' || word.included;
        if(scope==='detected' && !included) {literal(' ');continue;}
        let ipa=word.pronunciation.ipa;
        if(settings.removeLowerArticulation) ipa=ipa.replace(/[\u031E\u02D5]/g,'');
        const complete=word.pronunciation.rows.every(row=>row.status==='match');
        if(included && ipa && complete && word.raw.length<=600 && xml(ipa).length<3500)pieces.push({raw:word.raw,ipa});
        else literal(word.raw);
      } else {
        // Keep punctuation outside phoneme tags, including closing quotation marks.
        for(const raw of part.text.match(/\r\n|[\r\n]|[.!?]+["'”’)\]]*|[^.!?\r\n]+/g)||[])literal(raw);
      }
    }
    if(scope==='detected' && !analysis.words.some(word=>word.included)) throw new Error('No detected te reo to play.');
    const open=`<speak><prosody rate="${settings.speechRate}%">`, close='</prosody></speak>';
    function render(tokens){
      let content='',ipa=[],body='',space='';
      const empty=settings.ssmlCompactEnabled?settings.ssmlCompactEmptyBody:settings.emptyPhonemeBody;
      function flushIpa(){if(ipa.length)content+=`<phoneme alphabet="ipa" ph="${xml(ipa.join(' '))}">${empty?'':xml(body)}</phoneme>`;ipa=[];body='';if(space)content+=xml(space);space='';}
      for(const token of tokens){
        if(token.ipa){
          if(!settings.ssmlCompactEnabled)flushIpa();
          body+=(ipa.length?(space||' '):'')+token.raw;space='';ipa.push(token.ipa);
          if(!settings.ssmlCompactEnabled)flushIpa();
        }else if(ipa.length && settings.ssmlCompactEnabled && /^\s+$/.test(token.raw) && !(settings.ssmlCompactSplitNewline && /[\r\n]/.test(token.raw)))space+=token.raw;
        else {flushIpa();content+=xml(token.raw);}
      }
      flushIpa();return content;
    }
    const chunks=[];let tokens=[],chars=0,boundary=false;
    function flush(){const content=render(tokens);if(content.replace(/<[^>]*>/g,'').trim() || tokens.some(token=>token.ipa))chunks.push(open+content+close);tokens=[];chars=0;boundary=false;}
    for(const piece of pieces) {
      // Include closing punctuation/quotes and blank lines with the sentence;
      // flush only when the next spoken word arrives, avoiding empty requests.
      if(boundary && (piece.ipa || /[\p{L}\p{N}]/u.test(piece.raw)))flush();
      // A short initial request starts sooner; later requests remain bounded even
      // with compact empty bodies, where billed-character counts alone are tiny.
      const sourceLimit=chunks.length?600:180;
      if(tokens.length && (chars+piece.raw.length>sourceLimit || render([...tokens,piece]).length>4800))flush();
      tokens.push(piece);chars+=piece.raw.length;
      if(!piece.ipa && ((settings.ssmlCompactSplitSentence && /[.!?]/.test(piece.raw)) || (settings.ssmlCompactSplitNewline && /[\r\n]/.test(piece.raw))))boundary=true;
    }
    flush();if(!chunks.length)throw new Error('No playable text.');
    return chunks;
  }
  globalThis.ReoRiteSpeech=Object.freeze({plan});
})();
