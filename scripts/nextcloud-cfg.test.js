'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

// recursive freeze so any mutation of an input throws (R28)
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

const { configPaths, parseNextcloudCfg, localPathFor } = require('../desktop/nextcloud-cfg');

const lines = (a, eol) => a.join(eol) + eol;

// two accounts; folders and accounts deliberately out of order
const UNIX = lines([
  '[General]',
  'confirmExternalStorage=true',
  '',
  '[Accounts]',
  '1\\url=https://other.x.ts.net/',
  '1\\dav_user=v',
  '1\\Folders\\1\\localPath=/home/u/Other/',
  '1\\Folders\\1\\targetPath=/',
  '1\\Folders\\1\\paused=false',
  '0\\Folders\\2\\localPath=/home/u/Docs/',
  '0\\Folders\\2\\targetPath=/Docs',
  '0\\Folders\\2\\paused=true',
  '0\\Folders\\1\\localPath=/home/u/Nextcloud/',
  '0\\Folders\\1\\targetPath=/',
  '0\\Folders\\1\\paused=false',
  '0\\dav_user=u',
  '0\\url=https://cloud.x.ts.net',
  'version=2',
], '\n');

// Windows: CRLF and doubled backslashes inside values
const WIN = lines([
  '[Accounts]',
  String.raw`0\url=https://cloud.x.ts.net`,
  String.raw`0\dav_user=u`,
  String.raw`0\Folders\1\localPath=C:\\Users\\u\\Nextcloud\\`,
  String.raw`0\Folders\1\targetPath=/`,
  String.raw`0\Folders\1\paused=false`,
], '\r\n');

test('1. a two-account sample parses, sorted by index and folder number', () => {
  const a = parseNextcloudCfg(UNIX);
  assert.equal(a.length, 2);
  assert.deepEqual(a[0], {
    index: 0, url: 'https://cloud.x.ts.net', user: 'u',
    folders: [
      { localPath: '/home/u/Nextcloud/', targetPath: '/', paused: false },
      { localPath: '/home/u/Docs/', targetPath: '/Docs', paused: true },
    ],
  });
  assert.equal(a[1].index, 1);
  assert.equal(a[1].user, 'v');
  assert.deepEqual(a[1].folders, [{ localPath: '/home/u/Other/', targetPath: '/', paused: false }]);
});

test('2. Windows doubled backslashes are un-doubled (CRLF file)', () => {
  const a = parseNextcloudCfg(WIN);
  assert.equal(a.length, 1);
  assert.equal(a[0].folders[0].localPath, 'C:\\Users\\u\\Nextcloud\\');
  assert.equal(a[0].url, 'https://cloud.x.ts.net');
});

const acct = (folders) => deepFreeze([{ index: 0, url: 'https://cloud.x.ts.net', user: 'u', folders }]);
const ROOT = { localPath: '/home/u/Nextcloud/', targetPath: '/', paused: false };

test('3. the root folder maps a remote path; a trailing slash on the account url is ignored', () => {
  assert.equal(localPathFor(acct([ROOT]), 'https://cloud.x.ts.net', '/Docs/a.md'), '/home/u/Nextcloud/Docs/a.md');
  assert.equal(localPathFor(acct([ROOT]), 'https://cloud.x.ts.net/', '/Docs/a.md'), '/home/u/Nextcloud/Docs/a.md');
});

test('4. a paused folder is skipped and the root folder is used', () => {
  const docs = { localPath: '/home/u/Docs/', targetPath: '/Docs', paused: true };
  assert.equal(localPathFor(acct([docs, ROOT]), 'https://cloud.x.ts.net', '/Docs/a.md'), '/home/u/Nextcloud/Docs/a.md');
});

test('the longest matching targetPath on a segment boundary wins', () => {
  const docs = { localPath: '/home/u/Docs/', targetPath: '/Docs', paused: false };
  assert.equal(localPathFor(acct([ROOT, docs]), 'https://cloud.x.ts.net', '/Docs/a.md'), '/home/u/Docs/a.md');
  assert.equal(localPathFor(acct([ROOT, docs]), 'https://cloud.x.ts.net', '/Docsy/a.md'), '/home/u/Nextcloud/Docsy/a.md');
});

test('5. an unknown account gives null', () => {
  assert.equal(localPathFor(acct([ROOT]), 'https://nope.x.ts.net', '/Docs/a.md'), null);
});

test('6. configPaths on Linux lists the Flatpak path first', () => {
  assert.deepEqual(configPaths('linux', { HOME: '/home/deck' }), [
    '/home/deck/.var/app/com.nextcloud.desktopclient.nextcloud/config/Nextcloud/nextcloud.cfg',
    '/home/deck/.config/Nextcloud/nextcloud.cfg',
  ]);
});

test('configPaths on Windows, macOS and with XDG_CONFIG_HOME', () => {
  assert.deepEqual(configPaths('win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }), ['C:\\Users\\u\\AppData\\Roaming\\Nextcloud\\nextcloud.cfg']);
  assert.deepEqual(configPaths('darwin', { HOME: '/Users/u' }), ['/Users/u/Library/Preferences/Nextcloud/nextcloud.cfg']);
  assert.equal(configPaths('linux', { HOME: '/h', XDG_CONFIG_HOME: '/x' })[1], '/x/Nextcloud/nextcloud.cfg');
});
