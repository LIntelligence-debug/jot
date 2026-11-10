// 零第三方依赖的 Markdown → DOCX（OOXML）写出器。
//
// 设计要点：
//   - 只依赖 Node 内置模块（node:fs/promises、node:path、node:zlib 由 zip.mjs 使用）。
//   - 生成一个最小但完整的 WordprocessingML 包：内容类型、关系、文档主体、
//     样式、编号（列表）、以及 docProps（标题/作者等元数据）。
//   - 中文字体统一设置 eastAsia="宋体"，西文/数字用 Calibri，代码用 Consolas，
//     确保 Word / WPS 打开后中文不回退成方框。
//   - mermaid mindmap 代码块会转成 Word 原生分级大纲（根节点加粗 + 分级缩进 +
//     大纲级别），而不是原样贴源码。
//
// 对外 API：
//   markdownToDocx(markdown, options?) -> Buffer
//   writeDocx(markdown, filePath, options?) -> Promise<void>

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createZip } from './zip.mjs';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

// 字体：正文西文 Calibri、中文宋体、代码 Consolas
const FONT_LATIN = 'Calibri';
const FONT_CJK = '宋体';
const FONT_MONO = 'Consolas';

const DEFAULT_TITLE = '学习笔记';
const DEFAULT_AUTHOR = 'jot';

// 列表最多支持 3 级（0/1/2），与 Markdown 缩进 2 空格一级对应
const MAX_LIST_LEVEL = 3;
const MAX_LIST_ILVL = MAX_LIST_LEVEL - 1;
// 思维导图最多 9 级大纲（Word 的 ilvl 上限为 0-8）
const MAX_MINDMAP_DEPTH = 9;

// numbering.xml 里的 ID 分配
const BULLET_ABSTRACT_ID = 0;
const ORDERED_ABSTRACT_ID = 1;
const MINDMAP_ABSTRACT_ID = 2;
const BULLET_NUM_ID = 1;
const FIRST_ORDERED_NUM_ID = 2;
const MINDMAP_NUM_ID = 900;

const SECT_PR =
  '<w:sectPr>'
  + '<w:pgSz w:w="11906" w:h="16838"/>'
  + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>'
  + '<w:cols w:space="425"/>'
  + '<w:docGrid w:type="lines" w:linePitch="312"/>'
  + '</w:sectPr>';

// ---------------------------------------------------------------------------
// XML 基础工具
// ---------------------------------------------------------------------------

/**
 * 转义 XML 文本：& < > " '，并丢弃 XML 1.0 不允许的控制字符。
 * @param {unknown} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成 <w:t> 文本节点；首尾有空白时加 xml:space="preserve"。
 * @param {string} text
 * @returns {string}
 */
function textNodeXml(text) {
  const value = String(text ?? '');
  const escaped = escapeXml(value);
  if (escaped === '') return '<w:t xml:space="preserve"></w:t>';
  const needsPreserve = /^\s|\s$/.test(value);
  return needsPreserve ? `<w:t xml:space="preserve">${escaped}</w:t>` : `<w:t>${escaped}</w:t>`;
}

/**
 * 生成 <w:rPr>。子元素顺序遵循 OOXML schema（rFonts → b → i → color → sz → shd）。
 * @param {{ bold?: boolean, italic?: boolean, color?: string|null, code?: boolean }} [options]
 * @returns {string}
 */
function runPropsXml({ bold = false, italic = false, color = null, code = false } = {}) {
  const props = [];
  if (code) {
    props.push(
      `<w:rFonts w:ascii="${FONT_MONO}" w:hAnsi="${FONT_MONO}" w:eastAsia="${FONT_CJK}" w:cs="${FONT_MONO}"/>`,
    );
  }
  if (bold) props.push('<w:b/><w:bCs/>');
  if (italic) props.push('<w:i/><w:iCs/>');
  if (color) props.push(`<w:color w:val="${color}"/>`);
  if (code) {
    props.push('<w:sz w:val="20"/><w:szCs w:val="20"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
  }
  return props.length > 0 ? `<w:rPr>${props.join('')}</w:rPr>` : '';
}

/**
 * 生成单个 run。
 * @param {string} text
 * @param {{ bold?: boolean, italic?: boolean, color?: string|null, code?: boolean }} [options]
 * @returns {string}
 */
function runXml(text, options = {}) {
  return `<w:r>${runPropsXml(options)}${textNodeXml(text)}</w:r>`;
}

/**
 * 生成段落。properties 必须是已按 schema 顺序拼好的 <w:pPr> 子元素字符串。
 * @param {string} properties
 * @param {string} runs
 * @returns {string}
 */
function paragraphXml(properties, runs) {
  const pPr = properties ? `<w:pPr>${properties}</w:pPr>` : '';
  return `<w:p>${pPr}${runs}</w:p>`;
}

// ---------------------------------------------------------------------------
// 行内 Markdown 解析：**加粗**、__加粗__、`行内代码`
// ---------------------------------------------------------------------------

const INLINE_RE = /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|`([^`\n]+?)`/g;

/**
 * 把一行 Markdown 文本转成若干 run。
 * @param {string} text
 * @param {{ bold?: boolean, italic?: boolean, color?: string|null, code?: boolean }} [base]
 * @returns {string}
 */
function inlineRunsXml(text, base = {}) {
  const value = String(text ?? '');
  const runs = [];
  let lastIndex = 0;
  INLINE_RE.lastIndex = 0;
  let match = INLINE_RE.exec(value);
  while (match !== null) {
    if (match.index > lastIndex) {
      runs.push(runXml(value.slice(lastIndex, match.index), base));
    }
    if (match[1] !== undefined) {
      runs.push(runXml(match[1], { ...base, bold: true }));
    } else if (match[2] !== undefined) {
      runs.push(runXml(match[2], { ...base, bold: true }));
    } else {
      runs.push(runXml(match[3], { ...base, code: true }));
    }
    lastIndex = INLINE_RE.lastIndex;
    match = INLINE_RE.exec(value);
  }
  if (lastIndex < value.length || runs.length === 0) {
    runs.push(runXml(value.slice(lastIndex), base));
  }
  return runs.join('');
}

/**
 * 去掉行内 Markdown 标记，用于生成纯文本（如 docProps 标题）。
 * @param {string} text
 * @returns {string}
 */
function stripInlineMarkup(text) {
  return String(text ?? '')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .trim();
}

// ---------------------------------------------------------------------------
// Markdown 行解析
// ---------------------------------------------------------------------------

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const HR_RE = /^([-*_])(?:\s*\1){2,}\s*$/;
const CJK_END_RE = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]$/;
const CJK_START_RE = /^[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * 计算行首缩进宽度（空格计 1，制表符计 2）。
 * @param {string} line
 * @returns {number}
 */
function indentWidth(line) {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 2;
    else break;
  }
  return width;
}

/**
 * 一行是否开启新的块级元素（用于普通段落累积时提前截断）。
 * @param {string} line
 * @returns {boolean}
 */
function isBlockStart(line) {
  const trimmed = line.trim();
  if (trimmed === '') return true;
  return (
    FENCE_RE.test(line)
    || HEADING_RE.test(trimmed)
    || QUOTE_RE.test(line)
    || BULLET_RE.test(line)
    || ORDERED_RE.test(line)
    || HR_RE.test(trimmed)
  );
}

/**
 * 拼接段落内的软换行：中文边界直接相连，西文之间补一个空格。
 * @param {string} left
 * @param {string} right
 * @returns {string}
 */
function joinText(left, right) {
  if (!left) return right;
  if (!right) return left;
  if (CJK_END_RE.test(left) || CJK_START_RE.test(right)) return left + right;
  return `${left} ${right}`;
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
function joinLines(lines) {
  return lines.reduce((acc, line) => joinText(acc, line), '');
}

/**
 * 清理 mindmap 节点文本：去掉 (( ))、[ ]、{{ }} 等形状修饰、节点 id、行内代码与强调符号。
 * @param {string} raw
 * @returns {string}
 */
function cleanMindmapLabel(raw) {
  let label = String(raw).trim();
  if (!label) return '';
  // mermaid 指令：::icon(...) 等
  label = label.replace(/::icon\([^)]*\)\s*$/u, '').trim();
  // 行内代码 `xxx` → xxx
  label = label.replace(/`([^`]*)`/g, '$1');
  // 节点 id 前缀，如 A[文本] / node1((文本))
  label = label.replace(/^[A-Za-z_][\w-]*(?=\s*[([{])/u, '');
  // 反复剥离成对的形状括号
  const wrappers = [
    ['((', '))'],
    ['{{', '}}'],
    ['[[', ']]'],
    ['[(', ')]'],
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ];
  let changed = true;
  while (changed) {
    changed = false;
    label = label.trim();
    for (const [open, close] of wrappers) {
      if (label.length >= open.length + close.length && label.startsWith(open) && label.endsWith(close)) {
        label = label.slice(open.length, label.length - close.length).trim();
        changed = true;
        break;
      }
    }
  }
  // 首尾强调符号
  label = label.replace(/^\*\*([\s\S]*)\*\*$/u, '$1').replace(/^__([\s\S]*)__$/u, '$1').trim();
  return label;
}

/**
 * 判断 mermaid 源码是不是 mindmap 图。
 * @param {string[]} lines
 * @returns {boolean}
 */
function isMindmapSource(lines) {
  const first = lines.find((line) => line.trim() && !line.trim().startsWith('%%'));
  return Boolean(first && /^mindmap\b/i.test(first.trim()));
}

/**
 * 解析 mermaid mindmap 源码为扁平节点列表（depth 从 0 开始，0 为根节点）。
 * @param {string[]} lines
 * @returns {Array<{ depth: number, label: string }>}
 */
function parseMindmap(lines) {
  /** @type {Array<{ depth: number, label: string }>} */
  const nodes = [];
  /** @type {number[]} */
  const indentStack = [];

  for (const raw of lines) {
    const line = String(raw).replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^mindmap\b/i.test(trimmed)) continue;
    if (trimmed.startsWith('%%') || trimmed.startsWith('::')) continue;
    if (/^(classDef|class|style|linkStyle|click|direction|accTitle|accDescr)\b/.test(trimmed)) continue;

    const label = cleanMindmapLabel(trimmed);
    if (!label) continue;

    const indent = indentWidth(line);
    while (indentStack.length > 0 && indentStack[indentStack.length - 1] >= indent) {
      indentStack.pop();
    }
    nodes.push({ depth: indentStack.length, label });
    indentStack.push(indent);
  }

  if (nodes.length === 0) return [];

  // 若源码整体有额外缩进，把最小深度归一到 0
  const minDepth = nodes.reduce((min, node) => Math.min(min, node.depth), Infinity);
  return nodes.map((node) => ({
    depth: Math.min(MAX_MINDMAP_DEPTH, node.depth - minDepth),
    label: node.label,
  }));
}

/**
 * 把 Markdown 文本解析为块列表。
 *
 * 块类型：
 *   { type: 'heading', level, text }
 *   { type: 'paragraph', text }
 *   { type: 'quote', text }
 *   { type: 'code', lang, lines }
 *   { type: 'mindmap', nodes }
 *   { type: 'listItem', ordered, level, text, groupStart }
 *
 * @param {unknown} markdown
 * @returns {Array<Record<string, any>>}
 */
function parseMarkdown(markdown) {
  const lines = String(markdown ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');

  /** @type {Array<Record<string, any>>} */
  const blocks = [];
  let cursor = 0;
  let listGroupActive = false;

  while (cursor < lines.length) {
    const line = lines[cursor];
    const trimmed = line.trim();

    // 空行：结束当前段落/列表分组
    if (trimmed === '') {
      listGroupActive = false;
      cursor += 1;
      continue;
    }

    // 代码围栏
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const markerChar = fence[1][0];
      const info = fence[2].trim();
      const lang = info.split(/[\s,{]/)[0].toLowerCase();
      const closeRe = markerChar === '`' ? /^\s*`{3,}\s*$/ : /^\s*~{3,}\s*$/;
      const content = [];
      cursor += 1;
      while (cursor < lines.length && !closeRe.test(lines[cursor])) {
        content.push(lines[cursor].replace(/\s+$/, ''));
        cursor += 1;
      }
      if (cursor < lines.length) cursor += 1; // 跳过结束围栏

      if (lang === 'mermaid' && isMindmapSource(content)) {
        const nodes = parseMindmap(content);
        if (nodes.length > 0) {
          blocks.push({ type: 'mindmap', nodes });
          listGroupActive = false;
          continue;
        }
      }
      blocks.push({ type: 'code', lang, lines: content });
      listGroupActive = false;
      continue;
    }

    // 水平分隔线：直接跳过
    if (HR_RE.test(trimmed)) {
      listGroupActive = false;
      cursor += 1;
      continue;
    }

    // 标题 H1-H6（H4 及以上统一映射为 H3）
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(3, heading[1].length),
        text: heading[2].trim(),
      });
      listGroupActive = false;
      cursor += 1;
      continue;
    }

    // 引用
    if (QUOTE_RE.test(line)) {
      const quoteLines = [];
      while (cursor < lines.length && QUOTE_RE.test(lines[cursor])) {
        quoteLines.push(lines[cursor].replace(QUOTE_RE, '').trim());
        cursor += 1;
      }
      const text = joinLines(quoteLines.filter(Boolean));
      if (text) blocks.push({ type: 'quote', text });
      listGroupActive = false;
      continue;
    }

    // 有序列表（先于无序判断，避免 `1.` 被误判）
    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      const level = Math.min(MAX_LIST_ILVL, Math.floor(indentWidth(ordered[1]) / 2));
      blocks.push({
        type: 'listItem',
        ordered: true,
        level,
        text: ordered[3].trim(),
        groupStart: !listGroupActive,
      });
      listGroupActive = true;
      cursor += 1;
      continue;
    }

    // 无序列表（- / * / +），缩进 2 空格一级
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      const level = Math.min(MAX_LIST_ILVL, Math.floor(indentWidth(bullet[1]) / 2));
      blocks.push({
        type: 'listItem',
        ordered: false,
        level,
        text: bullet[2].trim(),
        groupStart: !listGroupActive,
      });
      listGroupActive = true;
      cursor += 1;
      continue;
    }

    // 普通段落：累积到空行或下一个块级元素
    const paragraphLines = [];
    while (cursor < lines.length) {
      const current = lines[cursor];
      if (isBlockStart(current)) break;
      paragraphLines.push(current.trim());
      cursor += 1;
    }
    if (paragraphLines.length === 0) {
      cursor += 1; // 兜底，避免死循环
      continue;
    }
    const text = joinLines(paragraphLines.filter(Boolean));
    if (text) blocks.push({ type: 'paragraph', text });
    listGroupActive = false;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 块 → WordprocessingML
// ---------------------------------------------------------------------------

/**
 * @param {{ level: number, text: string }} block
 * @returns {string}
 */
function headingParagraphXml(block) {
  const properties = `<w:pStyle w:val="Heading${block.level}"/><w:keepNext/><w:keepLines/>`;
  return paragraphXml(properties, inlineRunsXml(block.text));
}

/**
 * @param {{ text: string }} block
 * @returns {string}
 */
function bodyParagraphXml(block) {
  return paragraphXml('', inlineRunsXml(block.text));
}

/**
 * @param {{ text: string }} block
 * @returns {string}
 */
function quoteParagraphXml(block) {
  return paragraphXml(
    '<w:pStyle w:val="Quote"/>',
    inlineRunsXml(block.text, { italic: true, color: '595959' }),
  );
}

/**
 * 代码块逐行转段落（保留缩进，Consolas 9pt，浅灰底）。
 * @param {{ lines: string[] }} block
 * @returns {string[]}
 */
function codeParagraphsXml(block) {
  if (block.lines.length === 0) {
    return [paragraphXml('<w:pStyle w:val="CodeBlock"/>', runXml('', { code: true }))];
  }
  return block.lines.map((line) => {
    const expanded = line.replace(/\t/g, '  ');
    const content = expanded === '' ? ' ' : expanded;
    return paragraphXml('<w:pStyle w:val="CodeBlock"/>', runXml(content, { code: true }));
  });
}

/**
 * 列表项段落。
 * @param {{ level: number, text: string }} block
 * @param {number} numId
 * @returns {string}
 */
function listItemParagraphXml(block, numId) {
  const ilvl = Math.min(MAX_LIST_ILVL, Math.max(0, block.level));
  const properties =
    '<w:pStyle w:val="ListParagraph"/>'
    + `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;
  return paragraphXml(properties, inlineRunsXml(block.text));
}

/**
 * 思维导图节点 → Word 分级大纲段落。
 * 根节点加粗走 MindmapRoot 样式；子节点用编号（多级项目符号）实现缩进，
 * 并写入 outlineLvl，使 Word 导航窗格能显示层级。
 * @param {{ nodes: Array<{ depth: number, label: string }> }} block
 * @returns {string[]}
 */
function mindmapParagraphsXml(block) {
  return block.nodes.map((node) => {
    const depth = Math.max(0, Math.min(MAX_MINDMAP_DEPTH, node.depth));
    if (depth === 0) {
      const properties = '<w:pStyle w:val="MindmapRoot"/><w:keepNext/><w:outlineLvl w:val="0"/>';
      return paragraphXml(properties, runXml(node.label, { bold: true }));
    }
    const ilvl = Math.min(MAX_MINDMAP_DEPTH - 1, depth - 1); // mindmap 编号定义到 8 级
    const outlineLvl = Math.min(MAX_MINDMAP_DEPTH - 1, depth);
    const properties =
      '<w:pStyle w:val="ListParagraph"/>'
      + `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${MINDMAP_NUM_ID}"/></w:numPr>`
      + `<w:outlineLvl w:val="${outlineLvl}"/>`;
    return paragraphXml(properties, inlineRunsXml(node.label));
  });
}

/**
 * 渲染块列表，返回文档主体段落 XML 与有序列表 numId 列表。
 * @param {Array<Record<string, any>>} blocks
 * @returns {{ paragraphs: string[], orderedNumIds: number[] }}
 */
function renderBlocks(blocks) {
  /** @type {string[]} */
  const paragraphs = [];
  /** @type {number[]} */
  const orderedNumIds = [];
  let currentOrderedNumId = null;

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        paragraphs.push(headingParagraphXml(block));
        currentOrderedNumId = null;
        break;
      case 'paragraph':
        paragraphs.push(bodyParagraphXml(block));
        currentOrderedNumId = null;
        break;
      case 'quote':
        paragraphs.push(quoteParagraphXml(block));
        currentOrderedNumId = null;
        break;
      case 'code':
        paragraphs.push(...codeParagraphsXml(block));
        currentOrderedNumId = null;
        break;
      case 'mindmap':
        paragraphs.push(...mindmapParagraphsXml(block));
        currentOrderedNumId = null;
        break;
      case 'listItem': {
        let numId;
        if (block.ordered) {
          if (block.groupStart || currentOrderedNumId === null) {
            numId = FIRST_ORDERED_NUM_ID + orderedNumIds.length;
            if (numId >= MINDMAP_NUM_ID) {
              throw new Error('markdownToDocx: 有序列表数量超出编号可用范围');
            }
            orderedNumIds.push(numId);
          } else {
            numId = currentOrderedNumId;
          }
          currentOrderedNumId = numId;
        } else {
          numId = BULLET_NUM_ID;
          currentOrderedNumId = null;
        }
        paragraphs.push(listItemParagraphXml(block, numId));
        break;
      }
      default:
        break;
    }
  }

  return { paragraphs, orderedNumIds };
}

/**
 * 取第一个 H1 文本作为文档标题。
 * @param {Array<Record<string, any>>} blocks
 * @returns {string|null}
 */
function extractTitle(blocks) {
  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 1) {
      const text = stripInlineMarkup(block.text);
      if (text) return text;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 固定 OOXML 部件
// ---------------------------------------------------------------------------

/**
 * @returns {string}
 */
function contentTypesXml() {
  return (
    XML_DECL
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>'
  );
}

/**
 * @returns {string}
 */
function packageRelsXml() {
  return (
    XML_DECL
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/>`
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + `<Relationship Id="rId3" Type="${R_NS}/extended-properties" Target="docProps/app.xml"/>`
    + '</Relationships>'
  );
}

/**
 * @returns {string}
 */
function documentRelsXml() {
  return (
    XML_DECL
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId2" Type="${R_NS}/numbering" Target="numbering.xml"/>`
    + '</Relationships>'
  );
}

/**
 * @param {Date} date
 * @returns {string} W3CDTF 时间戳
 */
function toW3cdtf(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * @param {string} title
 * @returns {string}
 */
function coreXml(title) {
  const timestamp = toW3cdtf(new Date());
  return (
    XML_DECL
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:dcmitype="http://purl.org/dc/dcmitype/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>`
    + `<dc:creator>${DEFAULT_AUTHOR}</dc:creator>`
    + `<cp:lastModifiedBy>${DEFAULT_AUTHOR}</cp:lastModifiedBy>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>`
    + '<dc:subject>课程学习笔记</dc:subject>'
    + `<dc:title>${escapeXml(title)}</dc:title>`
    + '</cp:coreProperties>'
  );
}

/**
 * @returns {string}
 */
function appXml() {
  return (
    XML_DECL
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"'
    + ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + `<Application>${DEFAULT_AUTHOR}</Application>`
    + '<DocSecurity>0</DocSecurity>'
    + '<ScaleCrop>false</ScaleCrop>'
    + '<Company></Company>'
    + '<LinksUpToDate>false</LinksUpToDate>'
    + '<SharedDoc>false</SharedDoc>'
    + '<HyperlinksChanged>false</HyperlinksChanged>'
    + '<AppVersion>1.0</AppVersion>'
    + '</Properties>'
  );
}

/**
 * @returns {string}
 */
function stylesXml() {
  return (
    XML_DECL
    + `<w:styles xmlns:w="${W_NS}">`
    + '<w:docDefaults>'
    + '<w:rPrDefault>'
    + '<w:rPr>'
    + `<w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}" w:cs="${FONT_LATIN}"/>`
    + '<w:kern w:val="2"/>'
    + '<w:sz w:val="22"/><w:szCs w:val="22"/>'
    + '<w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>'
    + '</w:rPr>'
    + '</w:rPrDefault>'
    + '<w:pPrDefault>'
    + '<w:pPr><w:widowControl w:val="1"/><w:spacing w:after="120" w:line="312" w:lineRule="auto"/></w:pPr>'
    + '</w:pPrDefault>'
    + '</w:docDefaults>'
    // 正文
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
    + '<w:name w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:jc w:val="both"/></w:pPr>'
    + '</w:style>'
    // 标题 1
    + '<w:style w:type="paragraph" w:styleId="Heading1">'
    + '<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:keepNext w:val="1"/><w:keepLines w:val="1"/>'
    + '<w:spacing w:before="360" w:after="180"/><w:outlineLvl w:val="0"/></w:pPr>'
    + '<w:rPr>'
    + `<w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}"/>`
    + '<w:b/><w:bCs/><w:color w:val="1F3864"/>'
    + '<w:sz w:val="40"/><w:szCs w:val="40"/>'
    + '</w:rPr>'
    + '</w:style>'
    // 标题 2
    + '<w:style w:type="paragraph" w:styleId="Heading2">'
    + '<w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:keepNext w:val="1"/><w:keepLines w:val="1"/>'
    + '<w:spacing w:before="280" w:after="140"/><w:outlineLvl w:val="1"/></w:pPr>'
    + '<w:rPr>'
    + `<w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}"/>`
    + '<w:b/><w:bCs/><w:color w:val="2E5496"/>'
    + '<w:sz w:val="32"/><w:szCs w:val="32"/>'
    + '</w:rPr>'
    + '</w:style>'
    // 标题 3
    + '<w:style w:type="paragraph" w:styleId="Heading3">'
    + '<w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:keepNext w:val="1"/><w:keepLines w:val="1"/>'
    + '<w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr>'
    + '<w:rPr>'
    + `<w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}"/>`
    + '<w:b/><w:bCs/><w:color w:val="3B6CB7"/>'
    + '<w:sz w:val="28"/><w:szCs w:val="28"/>'
    + '</w:rPr>'
    + '</w:style>'
    // 列表段落
    + '<w:style w:type="paragraph" w:styleId="ListParagraph">'
    + '<w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:after="60"/><w:contextualSpacing w:val="1"/></w:pPr>'
    + '</w:style>'
    // 引用
    + '<w:style w:type="paragraph" w:styleId="Quote">'
    + '<w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>'
    + '<w:pPr>'
    + '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr>'
    + '<w:spacing w:before="120" w:after="160"/>'
    + '<w:ind w:left="720" w:right="360"/>'
    + '</w:pPr>'
    + '<w:rPr><w:i/><w:iCs/><w:color w:val="595959"/></w:rPr>'
    + '</w:style>'
    // 代码块
    + '<w:style w:type="paragraph" w:styleId="CodeBlock">'
    + '<w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>'
    + '<w:pPr>'
    + '<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>'
    + '<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>'
    + '<w:ind w:left="360" w:right="360"/>'
    + '</w:pPr>'
    + '<w:rPr>'
    + `<w:rFonts w:ascii="${FONT_MONO}" w:hAnsi="${FONT_MONO}" w:eastAsia="${FONT_CJK}" w:cs="${FONT_MONO}"/>`
    + '<w:color w:val="24292F"/><w:sz w:val="18"/><w:szCs w:val="18"/>'
    + '</w:rPr>'
    + '</w:style>'
    // 思维导图根节点
    + '<w:style w:type="paragraph" w:styleId="MindmapRoot">'
    + '<w:name w:val="Mindmap Root"/><w:basedOn w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:keepNext w:val="1"/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>'
    + '<w:rPr>'
    + `<w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}"/>`
    + '<w:b/><w:bCs/><w:color w:val="1F3864"/>'
    + '<w:sz w:val="28"/><w:szCs w:val="28"/>'
    + '</w:rPr>'
    + '</w:style>'
    + '</w:styles>'
  );
}

/**
 * 编号定义：0 = 无序列表，1 = 有序列表，2 = 思维导图大纲（最多 9 级）。
 * @returns {string[]}
 */
function abstractNumsXml() {
  const bulletLevels = [
    { char: '•', left: 720, hanging: 360 },
    { char: '◦', left: 1440, hanging: 360 },
    { char: '▪', left: 2160, hanging: 360 },
  ];
  const orderedLevels = [
    { format: 'decimal', text: '%1.', left: 720, hanging: 360 },
    { format: 'lowerLetter', text: '%2)', left: 1440, hanging: 360 },
    { format: 'lowerRoman', text: '%3.', left: 2160, hanging: 360 },
  ];
  const mindmapChars = ['•', '◦', '▪'];

  const bulletLevelsXml = bulletLevels
    .map(
      (level, index) =>
        `<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>`
        + `<w:lvlText w:val="${level.char}"/><w:lvlJc w:val="left"/>`
        + `<w:pPr><w:ind w:left="${level.left}" w:hanging="${level.hanging}"/></w:pPr>`
        + `<w:rPr><w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}"/></w:rPr></w:lvl>`,
    )
    .join('');

  const orderedLevelsXml = orderedLevels
    .map(
      (level, index) =>
        `<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="${level.format}"/>`
        + `<w:lvlText w:val="${level.text}"/><w:lvlJc w:val="left"/>`
        + `<w:pPr><w:ind w:left="${level.left}" w:hanging="${level.hanging}"/></w:pPr>`
        + `<w:rPr><w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}"/></w:rPr></w:lvl>`,
    )
    .join('');

  const mindmapLevels = [];
  for (let level = 0; level < MAX_MINDMAP_DEPTH; level += 1) {
    const char = mindmapChars[level % mindmapChars.length];
    const left = 360 * (level + 1);
    mindmapLevels.push(
      `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="bullet"/>`
      + `<w:lvlText w:val="${char}"/><w:lvlJc w:val="left"/>`
      + `<w:pPr><w:ind w:left="${left}" w:hanging="240"/></w:pPr>`
      + `<w:rPr><w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CJK}"/></w:rPr></w:lvl>`,
    );
  }

  return [
    `<w:abstractNum w:abstractNumId="${BULLET_ABSTRACT_ID}"><w:multiLevelType w:val="hybridMultilevel"/>${bulletLevelsXml}</w:abstractNum>`,
    `<w:abstractNum w:abstractNumId="${ORDERED_ABSTRACT_ID}"><w:multiLevelType w:val="hybridMultilevel"/>${orderedLevelsXml}</w:abstractNum>`,
    `<w:abstractNum w:abstractNumId="${MINDMAP_ABSTRACT_ID}"><w:multiLevelType w:val="hybridMultilevel"/>${mindmapLevels.join('')}</w:abstractNum>`,
  ];
}

/**
 * @param {number[]} orderedNumIds
 * @returns {string}
 */
function numberingXml(orderedNumIds) {
  const nums = [
    `<w:num w:numId="${BULLET_NUM_ID}"><w:abstractNumId w:val="${BULLET_ABSTRACT_ID}"/></w:num>`,
  ];
  for (const numId of orderedNumIds) {
    // 每个有序列表单独一个 numId，并重置起始值，避免跨列表连续编号
    nums.push(
      `<w:num w:numId="${numId}"><w:abstractNumId w:val="${ORDERED_ABSTRACT_ID}"/>`
      + '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>',
    );
  }
  nums.push(
    `<w:num w:numId="${MINDMAP_NUM_ID}"><w:abstractNumId w:val="${MINDMAP_ABSTRACT_ID}"/></w:num>`,
  );

  return `${XML_DECL}<w:numbering xmlns:w="${W_NS}">${abstractNumsXml().join('')}${nums.join('')}</w:numbering>`;
}

/**
 * @param {string} bodyXml
 * @returns {string}
 */
function documentXml(bodyXml) {
  return (
    XML_DECL
    + `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}">`
    + `<w:body>${bodyXml}${SECT_PR}</w:body>`
    + '</w:document>'
  );
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 把 Markdown 转成 .docx 的二进制内容（Buffer）。
 *
 * @param {unknown} markdown Markdown 文本
 * @param {{ title?: string, mtime?: Date }} [options]
 *   title：覆盖 docProps 标题；mtime：ZIP 内时间戳（默认当前时间）。
 * @returns {Buffer}
 */
export function markdownToDocx(markdown, options = {}) {
  const blocks = parseMarkdown(markdown);
  const { paragraphs, orderedNumIds } = renderBlocks(blocks);
  const bodyXml = paragraphs.length > 0 ? paragraphs.join('') : '<w:p/>';
  const title =
    typeof options?.title === 'string' && options.title.trim()
      ? options.title.trim()
      : extractTitle(blocks) ?? DEFAULT_TITLE;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypesXml() },
    { name: '_rels/.rels', data: packageRelsXml() },
    { name: 'word/document.xml', data: documentXml(bodyXml) },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/_rels/document.xml.rels', data: documentRelsXml() },
    { name: 'word/numbering.xml', data: numberingXml(orderedNumIds) },
    { name: 'docProps/core.xml', data: coreXml(title) },
    { name: 'docProps/app.xml', data: appXml() },
  ];

  return createZip(entries, { mtime: options?.mtime });
}

/**
 * 生成 .docx 并写入磁盘（自动创建父目录）。
 *
 * @param {unknown} markdown Markdown 文本
 * @param {string} filePath 目标文件路径（.docx）
 * @param {{ title?: string, mtime?: Date }} [options]
 * @returns {Promise<void>}
 */
export async function writeDocx(markdown, filePath, options = {}) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new TypeError('writeDocx: filePath 必须是非空字符串');
  }
  const buffer = markdownToDocx(markdown, options);
  const directory = dirname(filePath);
  if (directory && directory !== '.') {
    await mkdir(directory, { recursive: true });
  }
  await writeFile(filePath, buffer);
}
