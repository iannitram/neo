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
  assert.deepEqual(configPaths('darwin', { HOME: '/Users/u' }), ['/Users/u/Library/Containers/com.nextcloud.desktopclient/Data/Library/Preferences/Nextcloud/nextcloud.cfg', '/Users/u/Library/Preferences/Nextcloud/nextcloud.cfg']);
  assert.equal(configPaths('linux', { HOME: '/h', XDG_CONFIG_HOME: '/x' })[1], '/x/Nextcloud/nextcloud.cfg');
});

// ---- extended 2026-10-27 after PR #98's review: separators, trailing separators, [Accounts] only ----
const CLOUD = 'https://cloud.x.ts.net';
const folder = (localPath, targetPath = '/') => ({ localPath, targetPath, paused: false });
const lp = (localPath, remote, targetPath) => localPathFor(acct([folder(localPath, targetPath)]), CLOUD, remote);

test('Windows localPath: backslashes throughout, with or without a trailing backslash', () => {
  assert.equal(lp('C:\\Users\\u\\Nextcloud\\', '/Docs/a.md'), 'C:\\Users\\u\\Nextcloud\\Docs\\a.md');
  assert.equal(lp('C:\\Users\\u\\Nextcloud', '/Docs/a.md'), 'C:\\Users\\u\\Nextcloud\\Docs\\a.md');
});

test('Windows localPath: nested remote paths use backslashes at every level', () => {
  const want = 'C:\\Users\\u\\Nextcloud\\Docs\\Sub\\deep\\a.md';
  assert.equal(lp('C:\\Users\\u\\Nextcloud\\', '/Docs/Sub/deep/a.md'), want);
  assert.equal(lp('C:\\Users\\u\\Nextcloud', '/Docs/Sub/deep/a.md'), want);
});

test('Windows localPath: a non-root targetPath is stripped and the rest joined with backslashes', () => {
  assert.equal(lp('D:\\Sync\\Docs\\', '/Docs/Sub/a.md', '/Docs'), 'D:\\Sync\\Docs\\Sub\\a.md');
  assert.equal(lp('D:\\Sync\\Docs', '/Docs/Sub/a.md', '/Docs'), 'D:\\Sync\\Docs\\Sub\\a.md');
});

test('Windows localPath parsed from a cfg maps end to end', () => {
  assert.equal(localPathFor(deepFreeze(parseNextcloudCfg(WIN)), CLOUD, '/Docs/Sub/a.md'), 'C:\\Users\\u\\Nextcloud\\Docs\\Sub\\a.md');
});

test('POSIX localPath: slashes throughout, with or without a trailing slash', () => {
  assert.equal(lp('/home/u/Nextcloud/', '/Docs/a.md'), '/home/u/Nextcloud/Docs/a.md');
  assert.equal(lp('/home/u/Nextcloud', '/Docs/a.md'), '/home/u/Nextcloud/Docs/a.md');
});

test('POSIX localPath: nested remote paths and a non-root targetPath', () => {
  assert.equal(lp('/home/u/Nextcloud', '/Docs/Sub/deep/a.md'), '/home/u/Nextcloud/Docs/Sub/deep/a.md');
  assert.equal(lp('/home/u/Docs/', '/Docs/Sub/a.md', '/Docs'), '/home/u/Docs/Sub/a.md');
  assert.equal(lp('/home/u/Docs', '/Docs/Sub/a.md', '/Docs'), '/home/u/Docs/Sub/a.md');
  assert.equal(lp('/home/u/Docs', '/Docs/Sub/a.md', '/Docs/Sub'), '/home/u/Docs/a.md');
});

// the same-looking keys in other sections must be ignored, before and after [Accounts]
const MULTI = lines([
  '[Other]',
  String.raw`0\url=https://wrong.x.ts.net`,
  String.raw`5\url=https://ghost.x.ts.net`,
  String.raw`5\dav_user=ghost`,
  '[Accounts]',
  String.raw`0\url=https://cloud.x.ts.net`,
  String.raw`0\dav_user=u`,
  String.raw`0\Folders\1\localPath=/home/u/Nextcloud/`,
  String.raw`0\Folders\1\targetPath=/`,
  String.raw`0\Folders\1\paused=false`,
  '[Proxy]',
  String.raw`0\url=https://proxy.x.ts.net`,
  String.raw`0\dav_user=proxyuser`,
  String.raw`0\Folders\1\localPath=/tmp/elsewhere/`,
  String.raw`0\Folders\1\paused=true`,
  String.raw`0\Folders\2\localPath=/tmp/extra/`,
  String.raw`7\url=https://ghost2.x.ts.net`,
], '\n');

test('only keys in [Accounts] are parsed; other sections cannot add or change accounts or folders', () => {
  const a = parseNextcloudCfg(MULTI);
  assert.deepEqual(a, [{
    index: 0, url: 'https://cloud.x.ts.net', user: 'u',
    folders: [{ localPath: '/home/u/Nextcloud/', targetPath: '/', paused: false }],
  }]);
});

test('a cfg with no [Accounts] section gives no accounts, and CRLF does not hide the header', () => {
  assert.deepEqual(parseNextcloudCfg(lines(['[General]', String.raw`0\url=https://cloud.x.ts.net`], '\n')), []);
  const crlf = lines(['[Other]', String.raw`0\url=https://wrong.x.ts.net`, '[Accounts]', String.raw`1\url=https://cloud.x.ts.net`], '\r\n');
  assert.deepEqual(parseNextcloudCfg(crlf).map((x) => x.index), [1]);
});
