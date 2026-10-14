// Generated validation/defaults shared with the extension. No Chrome APIs required.
(() => {
  'use strict';
  if (globalThis.ReoRiteConfig) return;
  const defaults = Object.freeze({
    schemaVersion: 1, lexicon: 'v6', mode: 'block', display: 'highlight', threshold: 0.75,
    joinMode: 'space', highlightColor: '#d3f3dc', textColor: '#123c2a',
    showDetails: true, showSsml: false, hoverDetails: true, hoverElements: true,
    highlightStyle: 'ribbon', accentColor: '#237b62', maxCharacters: 100000,
    awsRegion: 'ap-southeast-2', voiceId: 'Aria', speechEngine: 'neural', languageCode: 'en-NZ',
    speechRate: 100, speechJoinMode: 'dot', removeLowerArticulation: false, emptyPhonemeBody: true,
    ssmlCompactEnabled: true, ssmlCompactSplitSentence: true, ssmlCompactSplitNewline: true, ssmlCompactEmptyBody: true,
    excludedSelectors: 'nav, footer, [data-reorite-ignore]',
    ambiguousTokens: ['to','he','me','no','a','hi','take','ha','range','we','are','more','one','here','were','area','in','im','the','open','make','who'],
    particleTokens: ['te','ki','ko','nga','ngā','kei','kua','hei','nā','na','mā','ma','mō','mo','ka','o','i','e']
  });
  function validate(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Config must be a JSON object.');
    for (const key of Object.keys(input)) if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown config setting: ${key}`);
    const value = {...defaults, ...input};
    if (!['v4','v5','v6','v6.5'].includes(value.lexicon) && !(typeof ReoRiteLexicons !== 'undefined' && ReoRiteLexicons.rows(value.lexicon))) throw new Error('Lexicon is unavailable. Import it in Settings & config first.');
    if (value.schemaVersion !== 1) throw new Error('Unsupported config version.');
    for (const [key, choices] of Object.entries({mode:['word','block'],display:['highlight','ipa','phonetic'],joinMode:['space','dot','none'],speechJoinMode:['space','dot','none'],highlightStyle:['ribbon','underline','soft'],speechEngine:['neural','standard']})) {
      if (!choices.includes(value[key])) throw new Error(`Invalid ${key}.`);
    }
    if (typeof value.threshold !== 'number' || !Number.isFinite(value.threshold) || value.threshold < 0.5 || value.threshold > 0.9) throw new Error('Threshold must be between 0.50 and 0.90.');
    if (!Number.isInteger(value.maxCharacters) || value.maxCharacters < 100 || value.maxCharacters > 500000) throw new Error('Character limit must be an integer from 100 to 500000.');
    for (const key of ['highlightColor','textColor','accentColor']) if (!/^#[0-9a-f]{6}$/i.test(value[key])) throw new Error(`Invalid ${key}. Use a six-digit hex colour.`);
    for (const key of ['showDetails','showSsml','hoverDetails','hoverElements','removeLowerArticulation','emptyPhonemeBody','ssmlCompactEnabled','ssmlCompactSplitSentence','ssmlCompactSplitNewline','ssmlCompactEmptyBody']) if (typeof value[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
    if (!/^[a-z]{2}(?:-[a-z]+){1,3}-\d$/.test(value.awsRegion)) throw new Error('Invalid AWS region.');
    if (typeof value.voiceId!=='string' || !/^[A-Za-z]{1,40}$/.test(value.voiceId)) throw new Error('Invalid Polly voice ID.');
    if (typeof value.languageCode!=='string' || !/^[a-z]{2,3}(?:-[A-Z]{2}(?:-[A-Z]{3})?)?$/.test(value.languageCode)) throw new Error('Invalid language code.');
    if (typeof value.speechRate!=='number' || !Number.isInteger(value.speechRate) || value.speechRate<50 || value.speechRate>150) throw new Error('Speech rate must be 50 to 150 percent.');
    if (typeof value.excludedSelectors !== 'string' || value.excludedSelectors.length > 2000) throw new Error('Excluded selectors must be text of at most 2000 characters.');
    for (const key of ['ambiguousTokens','particleTokens']) {
      if (!Array.isArray(value[key]) || value[key].length > 1000 || value[key].some(item => typeof item !== 'string' || !/^[a-zāēīōū]{1,50}$/i.test(item))) throw new Error(`Invalid ${key}. Use up to 1000 words, letters only.`);
      value[key] = [...new Set(value[key].map(item => item.normalize('NFC').toLowerCase()))];
    }
    return value;
  }
  globalThis.ReoRiteConfig=Object.freeze({defaults,validate});
})();
