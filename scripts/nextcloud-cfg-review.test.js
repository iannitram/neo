'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

// recursive freeze so any mutation of an input throws
function deepFreeze(o) {
  if (o && typeof o === 'object' && !ArrayBuffer.isView(o) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Reflect.ownKeys(o)) deepFreeze(o[k]);
  }
  return o;
}

const { parseNextcloudCfg, localPathFor } = require('../desktop/nextcloud-cfg');

const ACCT_URL = 'https://cloud.x.ts.net';
const acct = (localPath, targetPath = '/') =>
  deepFreeze([{
    index: 0, url: ACCT_URL, user: 'u',
    folders: [{ localPath, targetPath, paused: false }],
  }]);

// Windows: localPath uses backslashes
test('a Windows localPath joins the remote path with backslashes', () => {
  assert.equal(
    localPathFor(acct('C:\\Users\\u\\Nextcloud\\'), ACCT_URL, '/Docs/a.md'),
    'C:\\Users\\u\\Nextcloud\\Docs\\a.md',
  );
});

test('a Windows localPath without a trailing backslash joins with one backslash', () => {
  assert.equal(
    localPathFor(acct('C:\\Users\\u\\Nextcloud'), ACCT_URL, '/Docs/a.md'),
    'C:\\Users\\u\\Nextcloud\\Docs\\a.md',
  );
});

// no trailing separator on the localPath
test('a Unix localPath without a trailing slash gets one before the remote path', () => {
  assert.equal(
    localPathFor(acct('/home/u/Nextcloud'), ACCT_URL, '/Docs/a.md'),
    '/home/u/Nextcloud/Docs/a.md',
  );
});

test('a folder with a targetPath and no trailing slash joins with a slash', () => {
  assert.equal(
    localPathFor(acct('/home/u/Docs', '/Docs'), ACCT_URL, '/Docs/a.md'),
    '/home/u/Docs/a.md',
  );
});

// never a doubled separator
test('no output has a doubled separator, whatever the localPath ends with', () => {
  const remotes = ['/Docs/a.md', '/a.md', '/Docs/sub/b.md'];
  const locals = [
    ['/home/u/Nextcloud', '/home/u/Nextcloud/'],
    ['C:\\Users\\u\\Nextcloud', 'C:\\Users\\u\\Nextcloud\\'],
  ];
  for (const [noSep, withSep] of locals) {
    for (const local of [noSep, withSep]) {
      for (const remote of remotes) {
        const out = localPathFor(acct(local), ACCT_URL, remote);
        assert.ok(!/[\\/]{2}/.test(out), `doubled separator in ${JSON.stringify(out)}`);
      }
    }
  }
  assert.equal(localPathFor(acct('/home/u/Nextcloud/'), ACCT_URL, '/Docs/a.md'), '/home/u/Nextcloud/Docs/a.md');
  assert.equal(localPathFor(acct('/'), ACCT_URL, '/Docs/a.md'), '/Docs/a.md');
});

// only [Accounts] holds account keys
test('keys in a non-[Accounts] section are ignored, even when they look like account keys', () => {
  // The ignored sections use an account index (7) and a folder number (2) that
  // [Accounts] never mentions, so a parser that reads them would add both.
  // [Proxy] comes last, so a parser that reads it would also overwrite the url.
  const text = [
    '[General]',
    '7\\url=https://evil.example',
    '7\\dav_user=mallory',
    '0\\Folders\\2\\localPath=/tmp/evil/',
    '0\\Folders\\2\\targetPath=/',
    '[Accounts]',
    '0\\url=https://cloud.x.ts.net',
    '0\\dav_user=u',
    '0\\Folders\\1\\localPath=/home/u/Nextcloud/',
    '0\\Folders\\1\\targetPath=/',
    '0\\Folders\\1\\paused=false',
    '[Proxy]',
    '0\\url=https://proxy.example',
  ].join('\n') + '\n';
  const accounts = parseNextcloudCfg(text);
  assert.deepEqual(accounts, [{
    index: 0, url: 'https://cloud.x.ts.net', user: 'u',
    folders: [{ localPath: '/home/u/Nextcloud/', targetPath: '/', paused: false }],
  }]);
});

test('keys before any section header are ignored', () => {
  const text = '3\\url=https://evil.example\n[Accounts]\n0\\url=https://cloud.x.ts.net\n';
  assert.deepEqual(parseNextcloudCfg(text).map(a => a.index), [0]);
});
