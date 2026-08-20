'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

global.window = global;
Object.defineProperty(global, 'localStorage', { value: new MemoryStorage(), configurable: true });
vm.runInThisContext(fs.readFileSync(require('path').join(__dirname, 'sync-safety.js'), 'utf8'));

const S = global.TeleprompterSyncSafety;
const defaults = {
  defaultSpeed: 35,
  defaultFontSize: 54,
  defaultLineHeight: 1.45,
  defaultParagraphSpacing: 0.45,
  defaultTextWidth: 82,
  alignment: 'left',
  mirrorHorizontal: false,
  mirrorVertical: false,
  focusGuide: true,
  cameraEnabled: false,
  cameraFacing: 'user',
  cameraOpacity: 65,
  cameraDim: 25,
  cameraMirror: true,
  faceControlsEnabled: false,
  ttsEnabled: false,
  ttsPaceWpm: 130,
  voiceControlsEnabled: false
};

function starter(id = 'starter') {
  return {
    schemaVersion: 3,
    workspaceId: 'local-workspace',
    cloud: { revision: 0 },
    profile: { displayName: '', provider: 'local', email: '' },
    preferences: { ...defaults },
    scripts: [{
      id,
      title: S.STARTER_TITLE,
      body: S.STARTER_BODY,
      playerSettings: { speed: 35, fontSize: 54, lineHeight: 1.45, paragraphSpacing: 0.45, textWidth: 82, alignment: 'left', mirrorHorizontal: false, mirrorVertical: false, focusGuide: true, cameraEnabled: false, cameraFacing: 'user', cameraOpacity: 65, cameraDim: 25, cameraMirror: true, faceControlsEnabled: false, ttsEnabled: false, ttsPaceWpm: 130, voiceControlsEnabled: false }
    }],
    activeScriptId: id
  };
}

function workspace(id, title = 'Script', body = 'Hello') {
  return {
    schemaVersion: 3,
    workspaceId: id,
    cloud: { revision: 1 },
    profile: { displayName: '', provider: 'local', email: '' },
    preferences: { ...defaults },
    scripts: [{ id: 's1', title, body, playerSettings: { speed: 35, fontSize: 54, lineHeight: 1.45, paragraphSpacing: 0.45, textWidth: 82, alignment: 'left', mirrorHorizontal: false, mirrorVertical: false, focusGuide: true, cameraEnabled: false, cameraFacing: 'user', cameraOpacity: 65, cameraDim: 25, cameraMirror: true, faceControlsEnabled: false, ttsEnabled: false, ttsPaceWpm: 130, voiceControlsEnabled: false } }],
    activeScriptId: 's1'
  };
}

assert.strictEqual(S.isPristineStarterWorkspace(starter(), defaults), true, 'fresh starter must be recognised');
const editedStarter = starter();
editedStarter.scripts[0].body += ' changed';
assert.strictEqual(S.isPristineStarterWorkspace(editedStarter, defaults), false, 'edited starter must not be treated as pristine');
const changedDefaults = starter();
changedDefaults.preferences.defaultSpeed = 50;
assert.strictEqual(S.isPristineStarterWorkspace(changedDefaults, defaults), false, 'changed settings make the local workspace meaningful');
const changedStarterPlayer = starter();
changedStarterPlayer.scripts[0].playerSettings.speed = 60;
assert.strictEqual(S.isPristineStarterWorkspace(changedStarterPlayer, defaults), false, 'changed per-script player settings make the starter workspace meaningful');

const remote = workspace('shared');
const same = JSON.parse(JSON.stringify(remote));
same.cloud.revision = 99;
same.cloud.updatedAt = new Date().toISOString();
assert.strictEqual(S.sameWorkspaceContent(remote, same), true, 'cloud metadata must not create false content differences');

const base = workspace('shared', 'Script', 'Base');
const localOnly = JSON.parse(JSON.stringify(base));
localOnly.scripts[0].body = 'Local edit';
const remoteSame = JSON.parse(JSON.stringify(base));
let merged = S.threeWayMerge(base, localOnly, remoteSame);
assert.strictEqual(merged.workspace.scripts.length, 1);
assert.strictEqual(merged.workspace.scripts[0].body, 'Local edit', 'local-only edit must survive');
assert.strictEqual(merged.conflicts, 0);

const remoteOnly = JSON.parse(JSON.stringify(base));
remoteOnly.scripts[0].body = 'Remote edit';
merged = S.threeWayMerge(base, base, remoteOnly);
assert.strictEqual(merged.workspace.scripts[0].body, 'Remote edit', 'remote-only edit must survive');
assert.strictEqual(merged.conflicts, 0);

const bothLocal = JSON.parse(JSON.stringify(base));
bothLocal.scripts[0].body = 'Local divergent';
const bothRemote = JSON.parse(JSON.stringify(base));
bothRemote.scripts[0].body = 'Remote divergent';
merged = S.threeWayMerge(base, bothLocal, bothRemote);
assert.strictEqual(merged.workspace.scripts.length, 2, 'divergent script edits must preserve both versions');
assert.ok(merged.workspace.scripts.some((script) => script.body === 'Remote divergent'));
assert.ok(merged.workspace.scripts.some((script) => script.body === 'Local divergent'));
assert.ok(merged.conflicts >= 1);

const localDeleted = JSON.parse(JSON.stringify(base));
localDeleted.scripts = [];
localDeleted.activeScriptId = null;
merged = S.threeWayMerge(base, localDeleted, remoteSame);
assert.strictEqual(merged.workspace.scripts.length, 0, 'a deletion should propagate when the other side is unchanged');

const remoteDeleted = JSON.parse(JSON.stringify(base));
remoteDeleted.scripts = [];
remoteDeleted.activeScriptId = null;
merged = S.threeWayMerge(base, localOnly, remoteDeleted);
assert.strictEqual(merged.workspace.scripts.length, 1, 'an edited local script must not be lost when the remote side deleted it concurrently');
assert.strictEqual(merged.workspace.scripts[0].body, 'Local edit');

const existingRemote = workspace('remote', 'Drive script', 'Drive');
const localWithStarterAndScript = starter();
localWithStarterAndScript.scripts.push({ id: 'local2', title: 'Local script', body: 'Local', playerSettings: { speed: 40 } });
const unrelated = S.mergeUnrelatedWorkspaces(existingRemote, localWithStarterAndScript);
assert.strictEqual(unrelated.workspace.scripts.some((script) => script.title === S.STARTER_TITLE), false, 'starter template must not be merged into a meaningful Drive workspace');
assert.strictEqual(unrelated.workspace.scripts.some((script) => script.title === 'Local script'), true, 'meaningful local script must be merged');

const profile = { sub: 'google-user-1', email: 'person@example.com' };
S.establishBaseline(profile, existingRemote, { id: 'drive-file-1' });
const baseline = S.getAccountRecord(profile);
assert.strictEqual(baseline.workspaceId, 'remote');
assert.strictEqual(baseline.fileId, 'drive-file-1');
assert.ok(baseline.baseWorkspace);

S.saveRecoverySnapshot(localOnly, { reason: 'test', source: 'local', profile });
const recovery = S.getLatestRecovery(profile);
assert.strictEqual(recovery.workspace.scripts[0].body, 'Local edit');

console.log('sync-safety regression: PASS');
