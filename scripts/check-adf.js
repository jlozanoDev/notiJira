const assert = require('assert');
const { adfToMarkdown, collectMedia } = require('../adf.js');

const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content) => ({ type: 'paragraph', content });
const li = (...content) => ({ type: 'listItem', content });
const doc = (...content) => ({ type: 'doc', version: 1, content });

// 1. heading + strong
assert.strictEqual(
  adfToMarkdown(doc({ type: 'heading', attrs: { level: 2 }, content: [t('Caso feliz')] }, p(t('Hola '), t('mundo', [{ type: 'strong' }])))),
  '## Caso feliz\n\nHola **mundo**'
);
// 2. bullet list
assert.strictEqual(
  adfToMarkdown(doc({ type: 'bulletList', content: [li(p(t('uno'))), li(p(t('dos')))] })),
  '- uno\n- dos'
);
// 3. code block with language
assert.strictEqual(
  adfToMarkdown(doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [t('const a = 1;')] })),
  '```js\nconst a = 1;\n```'
);
// 4. ordered list
assert.strictEqual(
  adfToMarkdown(doc({ type: 'orderedList', content: [li(p(t('a'))), li(p(t('b')))] })),
  '1. a\n2. b'
);
// 5. link mark
assert.strictEqual(
  adfToMarkdown(doc(p(t('texto', [{ type: 'link', attrs: { href: 'https://ejemplo.com' } }])))),
  '[texto](https://ejemplo.com)'
);
// 6. media with resolver -> local path (angle brackets because of spaces)
assert.strictEqual(
  adfToMarkdown(doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: '42', alt: 'captura' } }] }), {
    resolveMedia: (id, alt) => (id === '42' ? 'copia local/cap.png' : null),
  }),
  '![captura](<copia local/cap.png>)'
);
// 7. media without resolution disappears
assert.strictEqual(
  adfToMarkdown(doc(p(t('a '), { type: 'media', attrs: { id: '9' } }, t(' b')))),
  'a  b'
);
// 8. mention keeps display text
assert.strictEqual(
  adfToMarkdown(doc(p({ type: 'mention', attrs: { text: '@ana', id: 'acc:1' } }))),
  '@ana'
);
// 9. nested list
assert.strictEqual(
  adfToMarkdown(doc({ type: 'bulletList', content: [li(p(t('a')), { type: 'bulletList', content: [li(p(t('b')))] })] })),
  '- a\n\n  - b'
);
// 10. table with pipe escaping
assert.strictEqual(
  adfToMarkdown(doc({
    type: 'table',
    content: [
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('A|1'))] }, { type: 'tableCell', content: [p(t('B'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('C'))] }, { type: 'tableCell', content: [p(t('D'))] }] },
    ],
  })),
  '| A\\|1 | B |\n| --- | --- |\n| C | D |'
);
// 11. marks combined in order
assert.strictEqual(
  adfToMarkdown(doc(p(t('x', [{ type: 'strike' }, { type: 'em' }])))),
  '~~*x*~~'
);
// 12. status + hardBreak
assert.strictEqual(
  adfToMarkdown(doc(p({ type: 'status', attrs: { text: 'Hecho', color: 'green' } }, { type: 'hardBreak' }, t('l2')))),
  '**Hecho**\nl2'
);
// 13. collectMedia gathers ids and secure attachment links
const found = collectMedia(doc(
  p(t('x', [{ type: 'link', attrs: { href: '/secure/attachment/77/doc.pdf' } } ])),
  { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: '42' } }] }
));
assert.deepStrictEqual(found.mediaIds.sort(), ['42']);
assert.deepStrictEqual(found.attachmentIds.sort(), ['77']);

console.log('ADF CHECKS: 13/13 passed');



