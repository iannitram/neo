'use strict';

(function (root) {
  // Exported functions
  const api = {
    configPaths(platform, env) {
      if (platform === 'win32') {
        return [env.APPDATA + '\\Nextcloud\\nextcloud.cfg'];
      } else if (platform === 'darwin') {
        return [
          env.HOME + '/Library/Containers/com.nextcloud.desktopclient/Data/Library/Preferences/Nextcloud/nextcloud.cfg',
          env.HOME + '/Library/Preferences/Nextcloud/nextcloud.cfg',
        ];
      } else if (platform === 'linux') {
        return [
          env.HOME + '/.var/app/com.nextcloud.desktopclient.nextcloud/config/Nextcloud/nextcloud.cfg',
          (env.XDG_CONFIG_HOME || env.HOME + '/.config') + '/Nextcloud/nextcloud.cfg'
        ];
      }
      return [];
    },

    parseNextcloudCfg(text) {
      // Split into lines, handling both LF and CRLF
      const lines = text.split(/\r?\n/);
      
      const accounts = [];
      let section = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith(';')) continue;

        // Section headers like "[General]". Only [Accounts] holds account keys.
        const sectionMatch = line.match(/^\[(.*)\]$/);
        if (sectionMatch) {
          section = sectionMatch[1];
          continue;
        }
        if (section !== 'Accounts') continue;

        // Match account properties like "0\url=https://..."
        const accountMatch = line.match(/^(\d+)\\(.+?)=(.+)$/);
        if (accountMatch) {
          const index = parseInt(accountMatch[1]);
          const key = accountMatch[2];
          const value = accountMatch[3];
          
          // Ensure account exists
          if (!accounts[index]) {
            accounts[index] = { index, url: '', user: '', folders: [] };
          }
          const account = accounts[index];
          
          if (key === 'url') {
            account.url = value;
          } else if (key === 'dav_user') {
            account.user = value;
          } else if (key.startsWith('Folders\\')) {
            // Match folder like "0\Folders\1\localPath=/home/u/Nextcloud/"
            const folderMatch = key.match(/^Folders\\(\d+)\\(.+)$/);
            if (folderMatch) {
              const folderNumber = parseInt(folderMatch[1]);
              const folderKey = folderMatch[2];
              
              // Find or create folder
              let folder = account.folders.find(f => f.number === folderNumber);
              if (!folder) {
                folder = { number: folderNumber, localPath: '', targetPath: '', paused: false };
                account.folders.push(folder);
              }
              
              if (folderKey === 'localPath') {
                // Handle Windows doubled backslashes
                const unescapedPath = value.replace(/\\\\/g, '\\');
                folder.localPath = unescapedPath;
              } else if (folderKey === 'targetPath') {
                folder.targetPath = value;
              } else if (folderKey === 'paused') {
                folder.paused = value === 'true';
              }
            }
          }
        }
      }
      
      // Filter out undefined accounts and sort by index
      const result = accounts.filter(Boolean).sort((a, b) => a.index - b.index);
      
      // Sort folders by folder number within each account
      result.forEach(account => {
        account.folders.sort((a, b) => a.number - b.number);
        // Remove the number property since it's only for sorting
        account.folders.forEach(folder => {
          delete folder.number;
        });
      });
      
      return result;
    },

    localPathFor(accounts, accountUrl, remotePath) {
      // Find the account with matching URL (ignore trailing slash)
      const account = accounts.find(acc => {
        const normalizedUrl = acc.url.endsWith('/') ? acc.url.slice(0, -1) : acc.url;
        const normalizedAccountUrl = accountUrl.endsWith('/') ? accountUrl.slice(0, -1) : accountUrl;
        return normalizedUrl === normalizedAccountUrl;
      });
      
      if (!account) return null;
      
      // Find the folder with the longest matching targetPath on a segment boundary
      let bestFolder = null;
      let bestMatchLength = -1;
      
      for (const folder of account.folders) {
        // Skip paused folders
        if (folder.paused) continue;
        
        // Check if the remotePath starts with the targetPath
        if (remotePath.startsWith(folder.targetPath)) {
          // Check if the match is on a segment boundary (starts with / or is the full path)
          if (folder.targetPath === '/' || remotePath[folder.targetPath.length] === '/') {
            // Prefer longer matches
            if (folder.targetPath.length > bestMatchLength) {
              bestMatchLength = folder.targetPath.length;
              bestFolder = folder;
            }
          }
        }
      }
      
      // If no matching folder found, return null
      if (!bestFolder) return null;
      
      // Remote path below the folder, without its leading slashes
      const rest = remotePath.substring(bestFolder.targetPath.length).replace(/^\/+/, '');
      // The folder itself: give back its localPath as it was written
      if (!rest) return bestFolder.localPath;

      // Join in the localPath's own separator style: backslashes for a Windows path
      const localPath = bestFolder.localPath;
      const sep = localPath.includes('\\') ? '\\' : '/';
      // Exactly one separator between the localPath and the rest, whether or not it ends with one
      const base = localPath ? localPath.replace(/[\\/]+$/, '') + sep : '';
      return base + (sep === '\\' ? rest.replace(/\//g, '\\') : rest);
    }
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_NextcloudCfg = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);