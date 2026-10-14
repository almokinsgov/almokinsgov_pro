// Geometry and OCR/result normalization shared by the UI and deterministic tests.
(() => {
  'use strict';
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function uuid(){const bytes=crypto.getRandomValues(new Uint8Array(16));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
  function selection(start,end,width,height){
    const x=clamp(Math.min(start.x,end.x),0,width),y=clamp(Math.min(start.y,end.y),0,height);
    return {x,y,width:clamp(Math.max(start.x,end.x),0,width)-x,height:clamp(Math.max(start.y,end.y),0,height)-y};
  }
  function point(event,rect,width,height){return {x:clamp((event.clientX-rect.left)/rect.width*width,0,width),y:clamp((event.clientY-rect.top)/rect.height*height,0,height)};}
  function crop(rect,width,height){
    if(!rect)return {x:0,y:0,width,height};
    const x=clamp(Math.floor(rect.x),0,width-1),y=clamp(Math.floor(rect.y),0,height-1);
    return {x,y,width:clamp(Math.ceil(rect.width),1,width-x),height:clamp(Math.ceil(rect.height),1,height-y)};
  }
  function flatten(data,region,scale,imageWidth,imageHeight){
    const words=[];let lineIndex=0;
    for(const block of data.blocks||[])for(const paragraph of block.paragraphs||[])for(const line of paragraph.lines||[]){
      for(const word of line.words||[]){
        const text=String(word.text||'').normalize('NFC').trim(),b=word.bbox;if(!text||!b||![b.x0,b.y0,b.x1,b.y1].every(Number.isFinite))continue;
        const x=clamp(region.x+b.x0/scale,0,imageWidth),y=clamp(region.y+b.y0/scale,0,imageHeight);
        const x1=clamp(region.x+b.x1/scale,0,imageWidth),y1=clamp(region.y+b.y1/scale,0,imageHeight);
        if(x1<=x||y1<=y)continue;
        words.push({id:'word-'+words.length,text,originalText:text,confidence:clamp(Number(word.confidence)||0,0,100),line:lineIndex,box:{x,y,width:x1-x,height:y1-y}});
      }lineIndex++;
    }
    if(words.length>5000)throw new Error('Too much text in one scan. Draw a smaller region and scan again.');
    return words;
  }
  function analyze(words,settings){
    let text='',line=null;const ranges=[];
    for(const word of words){if(text)text+=word.line!==line?'\n':' ';line=word.line;const start=text.length;text+=word.text;ranges.push({start,end:text.length,word});}
    if(text.length>100000)throw new Error('Too much text in one scan. Select a smaller region.');
    const analysis=ReoRiteEngine.analyze(text,settings);let offset=0,index=0,owner=0;
    const mapped=words.map(word=>({...word,tokens:[]}));
    for(const part of analysis.parts){const raw=part.type==='word'?part.raw:part.text;
      if(part.type==='word'){const token=analysis.words[index++];while(owner<ranges.length&&ranges[owner].end<=offset)owner++;for(let i=owner;i<ranges.length&&ranges[i].start<offset+raw.length;i++)mapped[i].tokens.push(token);}
      offset+=raw.length;
    }
    for(const word of mapped){word.included=word.tokens.some(t=>t.included);word.score=word.tokens.length?Math.max(...word.tokens.map(t=>t.score)):0;word.ipa=word.tokens.map(t=>t.pronunciation.ipa).filter(Boolean).join(' ');word.phonetic=word.tokens.flatMap(t=>t.pronunciation.phoneticParts).filter(p=>p&&p!=='(N/A)').join(' ');word.lowConfidence=word.confidence<settings.minOcrConfidence;}
    return {text,words:mapped,analysis};
  }
  function label(word,display){return display==='ipa'?(word.ipa||word.text):display==='phonetic'?(word.phonetic||word.text):word.text;}
  function tokenList(value){return [...new Set(String(value).normalize('NFC').toLowerCase().split(/[\s,]+/u).filter(Boolean))];}
  globalThis.ScanCore=Object.freeze({clamp,uuid,selection,point,crop,flatten,analyze,label,tokenList});
})();
