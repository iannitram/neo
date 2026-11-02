(function (root) {
  'use strict';
  
  function minimalMarkdown() {
    return new Uint8Array(0);
  }
  
  function minimalDocxParts() {
    const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return {
      '[Content_Types].xml': DECL + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels': DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/document.xml': DECL + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/><w:sectPr/></w:body></w:document>',
      'word/_rels/document.xml.rels': DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    };
  }
  
  const api = {
    minimalMarkdown,
    minimalDocxParts
  };
  
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoCraft_Minimal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);