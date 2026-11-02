'use strict';

// Small XML 1.0 namespace reader for OOXML parts. No I/O, DTDs, entity
// declarations or HTML recovery. Kept separate so the package reader can
// apply its byte limits before constructing any trees.
(function (root) {
  const { xmlIsSafe } = typeof module === 'object' && module.exports
    ? require('./limits') : root.NeoCraft_DocxLimits;
  const XML = 'http://www.w3.org/XML/1998/namespace';
  const XMLNS = 'http://www.w3.org/2000/xmlns/';
  const name = '[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?';
  const space = '[ \\t\\n]';
  const eq = space + '*=' + space + '*';
  const quoted = (pattern) => '(?:"' + pattern + '"|\'' + pattern + '\')';
  const declaration = new RegExp('^<\\?xml' + space + '+version' + eq + quoted('1\\.0') +
    '(?:' + space + '+encoding' + eq + quoted('[Uu][Tt][Ff]-(?:8|16(?:[Ll][Ee]|[Bb][Ee])?)') + ')?' +
    '(?:' + space + '+standalone' + eq + quoted('(?:yes|no)') + ')?' + space + '*\\?>$');
  const fail = () => { throw new Error('Invalid DOCX XML'); };
  const validChar = (n) => n === 9 || n === 10 || n === 13 ||
    (n >= 32 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);

  function decode(text) {
    return text.replace(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);|&/g, (whole) => {
      if (whole === '&') return fail();
      const entity = whole.slice(1, -1);
      const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (Object.hasOwn(known, entity)) return known[entity];
      if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) return fail();
      const n = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!validChar(n)) return fail();
      return String.fromCodePoint(n);
    });
  }

  function parseXml(input) {
    if (!xmlIsSafe(input)) throw new Error('Unsafe DOCX XML: DTD or entity declaration');
    const xml = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    for (const char of xml) if (!validChar(char.codePointAt(0))) fail();
    const holder = { children: [], ns: { xml: XML, '': '' } };
    const stack = [holder];
    const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/(?:[^>]+)>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/gy;
    let offset = 0;
    let nodes = 0;
    let token;
    while ((token = tokens.exec(xml))) {
      if (token.index !== offset) fail();
      offset = tokens.lastIndex;
      const s = token[0];
      const parent = stack[stack.length - 1];
      if (s.startsWith('<!--')) {
        if (s.slice(4, -3).includes('--') || s.endsWith('--->')) fail();
      } else if (s.startsWith('<?')) {
        if (!/^<\?[A-Za-z_][\w.-]*(?:[ \t\n][\s\S]*)?\?>$/.test(s)) fail();
        if (/^<\?xml(?:[ \t\n]|\?)/i.test(s) &&
            (token.index !== 0 || !declaration.test(s))) fail();
      } else if (s.startsWith('</')) {
        const match = new RegExp('^</(' + name + ')' + space + '*>$').exec(s);
        if (!match || stack.length === 1 || parent.qname !== match[1]) fail();
        stack.pop();
      } else if (s.startsWith('<![CDATA[') || !s.startsWith('<')) {
        const cdata = s.startsWith('<![CDATA[');
        if (!cdata && s.includes(']]>')) fail();
        const text = cdata ? s.slice(9, -3) : decode(s);
        if (stack.length === 1) { if (cdata || !/^[ \t\n]*$/.test(s)) fail(); }
        else parent.children.push(text);
      } else {
        const match = new RegExp('^<(' + name + ')([\\s\\S]*?)(/?)>$').exec(s);
        if (!match || ++nodes > 200000 || stack.length > 128) fail();
        const attrs = [];
        const re = new RegExp(space + '+(' + name + ')' + space + '*=' + space + '*(?:"([^"<]*)"|\'([^\'<]*)\')', 'gy');
        let pos = 0;
        let attr;
        while ((attr = re.exec(match[2]))) {
          if (attr.index !== pos) fail();
          attrs.push([attr[1], decode((attr[2] ?? attr[3]).replace(/[\t\n]/g, ' '))]);
          pos = re.lastIndex;
        }
        if (!/^[ \t\n]*$/.test(match[2].slice(pos))) fail();
        const ns = Object.assign(Object.create(null), parent.ns);
        const rawNames = new Set();
        for (const [key, value] of attrs) {
          if (rawNames.has(key)) fail();
          rawNames.add(key);
          if (key === 'xmlns' || key.startsWith('xmlns:')) {
            const prefix = key === 'xmlns' ? '' : key.slice(6);
            if (prefix === 'xmlns' || value === XMLNS ||
                (prefix === 'xml') !== (value === XML) || (prefix && !value)) fail();
            ns[prefix] = value;
          }
        }
        const expanded = (key, attribute) => {
          const parts = key.split(':');
          const prefix = parts.length === 2 ? parts[0] : '';
          if (prefix === 'xmlns' || (prefix && !ns[prefix])) fail();
          return [prefix || !attribute ? ns[prefix] : '', parts[parts.length - 1]];
        };
        const [uri, local] = expanded(match[1], false);
        const node = { uri, local, qname: match[1], attrs: new Map(), children: [], ns };
        for (const [key, value] of attrs) {
          if (key === 'xmlns' || key.startsWith('xmlns:')) continue;
          const pair = expanded(key, true).join('|');
          if (node.attrs.has(pair)) fail();
          node.attrs.set(pair, value);
        }
        parent.children.push(node);
        if (stack.length === 1 && holder.children.length > 1) fail();
        if (!match[3]) stack.push(node);
      }
    }
    if (offset !== xml.length || stack.length !== 1 || holder.children.length !== 1) fail();
    return holder.children[0];
  }

  const api = { parseXml };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_DocxXml = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
