'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

global.window = global;
global.location = { protocol: 'https:', hostname: 'example.test' };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'google-drive.js'), 'utf8'));

const sync = global.TeleprompterGoogleDrive.sync;
sync.accessToken = 'test-token';
sync.tokenExpiresAt = Date.now() + 60_000;
sync.findWorkspaceFiles = async () => [
  { id: 'fresh-default', modifiedTime: '2026-08-11T00:10:00Z' },
  { id: 'real-workspace', modifiedTime: '2026-08-10T23:00:00Z' }
];
sync.downloadWorkspaceFile = async (id) => {
  if (id === 'fresh-default') {
    return {
      cloud: { revision: 9 },
      scripts: [{
        title: 'Welcome to Teleprompter',
        body: 'Write or paste your script here.\n\nOpen the player when you are ready. Use Space to play or pause and the arrow keys to adjust speed.'
      }]
    };
  }
  return {
    cloud: { revision: 1 },
    scripts: [
      { title: 'Council update', body: 'A real saved script.' },
      { title: 'Second script', body: 'More saved content.' }
    ]
  };
};

(async () => {
  const result = await sync.fetchWorkspace();
  assert.strictEqual(result.file.id, 'real-workspace', 'meaningful workspace must outrank a duplicate fresh-default workspace');
  assert.strictEqual(result.duplicates, 1);
  console.log('google-drive selection regression: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
