'use strict';

// Atlassian Document Format (ADF) -> Markdown converter.
// Used to copy Jira issue content (descriptions, rich-text custom fields,
// comments) as Markdown for pasting into a chat. Supports the node types
// emitted by Jira Cloud's rich text fields; unknown nodes degrade to their
// children so nothing is lost silently.

function rawText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(rawText).join('');
  let out = '';
  if (node.type === 'text') out += node.text || '';
  else if (node.type === 'hardBreak') out += '\n';
  else if (node.type === 'mention') {
    out += (node.attrs && (node.attrs.text || node.attrs.displayName)) || '';
  }
  if (Array.isArray(node.content)) out += node.content.map(rawText).join('');
  return out;
}

function wrapCode(text) {
  const runs = text.match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function wrapMarks(text, marks) {
  let out = text;
  // Reverse order so earlier marks end up as the outer wrapper.
  for (let i = (marks || []).length - 1; i >= 0; i--) {
    const mark = marks[i];
    switch (mark.type) {
      case 'strong':
        out = `**${out}**`;
        break;
      case 'em':
        out = `*${out}*`;
        break;
      case 'strike':
        out = `~~${out}~~`;
        break;
      case 'code':
        out = wrapCode(out);
        break;
      case 'link': {
        const href = (mark.attrs && mark.attrs.href) || '';
        out = href ? `[${out}](${href})` : out;
        break;
      }
      default:
        break; // textColor, underline, subsup, alignment: visual only
    }
  }
  return out;
}

function mediaToMarkdown(attrs, ctx) {
  const id = (attrs && attrs.id) || '';
  if (!id || typeof ctx.resolveMedia !== 'function') return '';
  const path = ctx.resolveMedia(id, (attrs && attrs.alt) || '', attrs);
  if (!path) return '';
  const dest = /[\s()<>]/.test(path) ? `<${path}>` : path;
  return `![${(attrs && attrs.alt) || ''}](${dest})`;
}

function renderInline(nodes, ctx) {
  if (!Array.isArray(nodes)) return '';
  return nodes.map((node) => renderInlineNode(node, ctx)).join('');
}

function renderInlineNode(node, ctx) {
  if (!node) return '';
  if (typeof node === 'string') return node;

  switch (node.type) {
    case 'text':
      return wrapMarks(node.text || '', node.marks);
    case 'hardBreak':
      return '\n';
    case 'mention': {
      const attrs = node.attrs || {};
      if (attrs.text) return attrs.text;
      return attrs.displayName ? `@${attrs.displayName}` : '';
    }
    case 'emoji':
      return (node.attrs && (node.attrs.shortName || node.attrs.text)) || '';
    case 'status':
      return node.attrs && node.attrs.text ? `**${node.attrs.text}**` : '';
    case 'media':
      return mediaToMarkdown(node.attrs, ctx);
    case 'inlineCard':
      return node.attrs && node.attrs.url ? `<${node.attrs.url}>` : '';
    case 'date':
      return formatDateAttr(node.attrs);
    case 'placeholder':
      return node.attrs && node.attrs.text ? `*${node.attrs.text}*` : '';
    default:
      return Array.isArray(node.content) ? renderInline(node.content, ctx) : '';
  }
}

function formatDateAttr(attrs) {
  const ts = attrs && Number(attrs.timestamp);
  if (!ts || Number.isNaN(ts)) return '';
  return new Date(ts).toISOString().slice(0, 10);
}

function prefixLines(body, marker) {
  const indent = ' '.repeat(marker.length);
  return body
    .split('\n')
    .map((line, index) => {
      if (index === 0) return marker + line;
      return line ? indent + line : '';
    })
    .join('\n');
}

function renderList(node, ctx, ordered) {
  const items = (node.content || []).map((item, index) => {
    const blocks = (item.content || []).map((child) => renderBlock(child, ctx));
    const marker = ordered ? `${index + 1}. ` : '- ';
    return prefixLines(blocks.join('\n\n'), marker);
  });
  return items.join('\n');
}

function renderTableCells(row, ctx, withSeparator) {
  const cells = (row.content || []).map((cell) => {
    const blocks = (cell.content || []).map((child) => renderBlock(child, ctx));
    return blocks.join(' ').replace(/\|/g, '\\|');
  });
  const header = `| ${cells.join(' | ')} |`;
  if (!withSeparator) return header;
  return `${header}\n${cells.map(() => '| ---').join(' ')} |`;
}

function renderBlock(node, ctx) {
  if (!node) return '';
  if (typeof node === 'string') return node;

  switch (node.type) {
    case 'doc':
    case 'panel':
    case 'expand':
      return (node.content || []).map((child) => renderBlock(child, ctx)).join('\n\n');
    case 'paragraph':
      return renderInline(node.content, ctx);
    case 'heading': {
      const level = Math.min(6, Math.max(1, (node.attrs && node.attrs.level) || 1));
      return `${'#'.repeat(level)} ${renderInline(node.content, ctx)}`;
    }
    case 'codeBlock': {
      const lang = (node.attrs && node.attrs.language) || '';
      return `\`\`\`${lang}\n${rawText(node.content)}\n\`\`\``;
    }
    case 'blockquote': {
      const body = (node.content || []).map((child) => renderBlock(child, ctx)).join('\n\n');
      return body
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    }
    case 'rule':
      return '---';
    case 'bulletList':
      return renderList(node, ctx, false);
    case 'orderedList':
      return renderList(node, ctx, true);
    case 'taskList':
      return renderList(node, ctx, false);
    case 'taskItem': {
      const done = node.attrs && node.attrs.state === 'DONE';
      const blocks = (node.content || []).map((child) => renderBlock(child, ctx));
      return prefixLines(blocks.join('\n\n'), done ? '- [x] ' : '- [ ] ');
    }
    case 'table': {
      const rows = node.content || [];
      return rows
        .map((row, index) => renderTableCells(row, ctx, index === 0))
        .join('\n');
    }
    case 'mediaSingle':
    case 'mediaGroup':
      return (node.content || []).map((child) => renderBlock(child, ctx)).join('');
    case 'media':
      return mediaToMarkdown(node.attrs, ctx);
    case 'inlineCard':
      return node.attrs && node.attrs.url ? `<${node.attrs.url}>` : '';
    case 'date':
      return formatDateAttr(node.attrs);
    case 'placeholder':
      return node.attrs && node.attrs.text ? `*${node.attrs.text}*` : '';
    default:
      if (Array.isArray(node.content)) {
        return node.content.map((child) => renderBlock(child, ctx)).join('\n\n');
      }
      return renderInlineNode(node, ctx);
  }
}

// options: { resolveMedia(id, alt, attrs) -> local path | null | '' }
function adfToMarkdown(node, options = {}) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const ctx = { resolveMedia: options.resolveMedia };
  return renderBlock(node, ctx);
}

// Collects media attachment ids referenced by the document (inline images and
// files) plus attachment ids referenced through /secure/attachment/ links.
function collectMedia(node, found) {
  const out = found || { mediaIds: [], attachmentIds: [] };
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collectMedia(child, out));
    return out;
  }
  if (node.type === 'media' && node.attrs && node.attrs.id) {
    if (!out.mediaIds.includes(String(node.attrs.id))) {
      out.mediaIds.push(String(node.attrs.id));
    }
  }
  for (const mark of node.marks || []) {
    if (mark.type !== 'link' || !mark.attrs || !mark.attrs.href) continue;
    const match = String(mark.attrs.href).match(/\/secure\/attachment\/(\d+)(?:\/|$)/);
    if (match && !out.attachmentIds.includes(match[1])) {
      out.attachmentIds.push(match[1]);
    }
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => collectMedia(child, out));
  }
  return out;
}

module.exports = { adfToMarkdown, collectMedia, rawText };
