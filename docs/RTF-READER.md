# RTF reader decision (#62)

Use our existing bounded tokenizer (#60) and fidelity scanner (#61), with no
parser dependency. They already share the token stream needed for reading and
loss detection. Licence check: these are repository code covered by the root
MIT [LICENSE](../LICENSE); the reader introduces no third-party source, package,
licence or attribution requirement. No external parser was selected or copied.
`TextDecoder` is provided by Node and the browser.

## Supported subset

`readRtf(bytes, name, { limits })` accepts a Uint8Array (including Buffer),
requires one balanced `rtf1` root group, and returns `{ model, meta }`, the open
half of [the adapter contract](../scripts/format-contract.js). Like the sibling
DOCX reader (#53), the provisional model is `{ type: 'document', blocks }`, with
`{ type: 'paragraph', runs: [{ text, b?, i?, u? }] }` blocks. Only enabled marks
are present. Adjacent equally formatted text is coalesced.

- Text and significant spaces, escaped braces and backslashes, `par` paragraphs
  (including empty paragraphs), `line` breaks and `tab` characters. A final
  `par` terminates its paragraph without inventing another one.
- Nested groups restore character formatting and encoding. `b`, `i`, `ul`,
  their zero resets, `ulnone`, and `plain` are supported.
- Signed UTF-16 `u` escapes (including surrogate pairs), group-scoped `uc`
  fallback, hex fallback and escaped fallback characters. A group boundary
  ends fallback; a whole fallback control word counts as one character.
- Hex and raw byte sequences are decoded together using `TextDecoder`, fatal
  on invalid byte sequences. `ansicpg` defaults to Windows-1252; selected and
  default fonts (`f`, `deff`) use `cpg`, then `fcharset`, then document encoding.
  Supported labels include Windows-1250–1258, Windows-874, Shift-JIS, GBK,
  EUC-KR, Big5, Macintosh and UTF-8, subject to runtime TextDecoder support.
  Windows-1252's C1 range is normalized to the WHATWG mapping on runtimes
  that decode it as Latin-1 (including some Node 20 builds).
  Unavailable encodings (including Symbol fonts and unsupported OEM pages)
  throw `RtfEncodingError`; no guessed replacement text is returned.
- Grouped or flat `fonttbl` entries retain `{ id, name, charset?, codepage? }`
  in `meta.fonts`. Font faces are not new run marks in the shared model.
- Nonbreaking spaces/hyphens, optional hyphens, typographic quotes, dashes and
  bullets have text equivalents.

`meta.originalBytes` is an independent copy, and `meta.name` retains the supplied
name. `meta.fidelity` is the existing scanner's report. Font/colour/style tables,
document info, starred destinations and known non-body destinations are kept
out of body text. Unsupported features such as fields, images, objects, tables,
headers/footers and footnotes are not represented faithfully. This reader does
not expand the scanner's coverage: unrecognised non-destination controls are
ignored, and scanner support alone is not proof of complete RTF fidelity.
Lists, headings, styles, layout, font sizes/colours and binary payloads are outside
this subset. It must not be used as permission to overwrite a richer source.

The byte length is checked before copying or tokenizing. Defaults are the
tokenizer's 20 MiB input and 100 nested groups; `limits.maxLength` and
`limits.maxDepth` override these. Both must be nonnegative safe integers.
Skipped destinations still pass through the bounded tokenizer. Limit failures
are `RtfLimitError`, malformed input is `RtfSyntaxError`.

Fixtures are handwritten strings in `scripts/rtf-read.test.js`, with no real
documents. Tests check the open envelope, model, encodings, limits and browser
loading. The full contract kit's serialize/no-edit checks belong to the later
writer/adapter (#63); this issue does not add a pretend serializer.
