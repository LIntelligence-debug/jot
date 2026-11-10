// DOCX 子系统的单元测试（node:test + node:assert/strict，零第三方依赖）。
//
// 运行方式：
//   node --test tests/docx.test.mjs
//
// 说明：在某些受限沙箱里 Node 默认的 test isolation 会为每个测试文件启动子进程，
// 可能因权限被拒（spawn EPERM）；此时可用 --experimental-test-isolation=none 进程内运行。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createZip, readZip } from '../src/core/docx/zip.mjs';
import { markdownToDocx, writeDocx } from '../src/core/docx/writer.mjs';

// 一个 docx 包必须包含的 OOXML 部件
const REQUIRED_DOCX_PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
  'word/styles.xml',
  'word/_rels/document.xml.rels',
  'word/numbering.xml',
  'docProps/core.xml',
  'docProps/app.xml',
];

// 覆盖：H1/H2/H3、**加粗**、`行内代码`、三级无序列表、有序列表、引用、
// mermaid mindmap、普通代码块、水平分隔线（应跳过）、第二个有序列表。
const SAMPLE_MARKDOWN = [
  '# 英语语法：第一章 时态',
  '',
  '## 1.1 核心词汇',
  '',
  '本章重点掌握 **高频词汇** 与 `固定搭配`，并注意大小写。',
  '',
  '### 1.1.1 记忆方法',
  '',
  '- 第一项',
  '  - 第二级',
  '    - 第三级',
  '- 另一项',
  '',
  '1. 步骤一',
  '2. 步骤二',
  '',
  '> 引用：记忆曲线需要反复复习。',
  '',
  '```mermaid',
  'mindmap',
  '  root((英语复习))',
  '    词汇',
  '      高频词',
  '      固定搭配',
  '    语法',
  '      时态',
  '```',
  '',
  '```js',
  'const a = 1 < 2 && "ok";',
  'console.log(a);',
  '```',
  '',
  '---',
  '',
  '1. 复习词汇',
  '2. 做练习题',
  '',
  '## 1.2 学习要求',
  '',
  '- 词汇量 3500',
  '',
].join('\n');

/**
 * 判断 Buffer 是否以 ZIP 本地文件头 PK\x03\x04 开头。
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function startsWithLocalFileHeader(buffer) {
  return (
    buffer.length >= 4
    && buffer[0] === 0x50
    && buffer[1] === 0x4b
    && buffer[2] === 0x03
    && buffer[3] === 0x04
  );
}

/**
 * 生成 docx 并返回解析后的部件 Map。
 * @param {string} markdown
 * @returns {Map<string, Buffer>}
 */
function docxParts(markdown) {
  return readZip(markdownToDocx(markdown));
}

/**
 * 读取指定部件的 UTF-8 文本。
 * @param {Map<string, Buffer>} parts
 * @param {string} name
 * @returns {string}
 */
function partText(parts, name) {
  const data = parts.get(name);
  assert.ok(data, `docx 缺少部件：${name}`);
  return data.toString('utf8');
}

// ---------------------------------------------------------------------------
// ZIP 层
// ---------------------------------------------------------------------------

test('createZip / readZip：读写回环（UTF-8 文件名、deflate 与 store）', () => {
  const binary = Buffer.from([0, 1, 2, 3, 250, 251, 252, 253]);
  const zip = createZip(
    [
      { name: 'word/document.xml', data: '<w:document>中文内容</w:document>' },
      { name: '中文目录/笔记.bin', data: binary, deflate: false },
      { name: 'big.txt', data: 'A'.repeat(5000) },
    ],
    { mtime: new Date('2024-01-02T03:04:06') },
  );

  assert.ok(Buffer.isBuffer(zip));
  assert.ok(startsWithLocalFileHeader(zip), 'ZIP 应以 PK\\x03\\x04 开头');

  const entries = readZip(zip);
  assert.ok(entries instanceof Map);
  assert.deepEqual([...entries.keys()], ['word/document.xml', '中文目录/笔记.bin', 'big.txt']);
  assert.equal(entries.get('word/document.xml').toString('utf8'), '<w:document>中文内容</w:document>');
  assert.deepEqual(entries.get('中文目录/笔记.bin'), binary);
  assert.equal(entries.get('big.txt').toString('utf8'), 'A'.repeat(5000));
});

test('createZip：默认压缩有效，deflate:false 时走 store', () => {
  const raw = 'A'.repeat(5000);
  const compressed = createZip([{ name: 'a.txt', data: raw }]);
  const stored = createZip([{ name: 'a.txt', data: raw, deflate: false }]);

  assert.ok(compressed.length < raw.length, '重复内容应被压缩');
  assert.ok(stored.length > raw.length, 'store 模式的体积应大于原始内容');
  assert.equal(readZip(compressed).get('a.txt').toString('utf8'), raw);
  assert.equal(readZip(stored).get('a.txt').toString('utf8'), raw);
});

test('createZip / readZip：空包与非法输入', () => {
  assert.equal(readZip(createZip([])).size, 0);

  assert.throws(
    () => createZip([{ name: 'same.txt', data: '1' }, { name: 'same.txt', data: '2' }]),
    /条目名重复/,
  );
  assert.throws(() => createZip([{ name: '', data: 'x' }]), /name 不能为空/);
  assert.throws(() => createZip('not-an-array'), /entries 必须是数组/);

  assert.throws(() => readZip(Buffer.from('这不是一个 ZIP 文件')), /readZip/);

  const zip = createZip([{ name: 'a.txt', data: 'hello' }]);
  assert.throws(() => readZip(zip.subarray(0, zip.length - 6)), /readZip/);
});

// ---------------------------------------------------------------------------
// DOCX 包结构
// ---------------------------------------------------------------------------

test('docx：Buffer 以 PK\\x03\\x04 开头，且包含全部必需 OOXML 部件', () => {
  const buffer = markdownToDocx(SAMPLE_MARKDOWN);
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(startsWithLocalFileHeader(buffer), 'docx 应以 PK\\x03\\x04 开头');

  const parts = readZip(buffer);
  for (const name of REQUIRED_DOCX_PARTS) {
    assert.ok(parts.has(name), `docx 缺少必需部件：${name}`);
  }
  assert.equal(parts.size, REQUIRED_DOCX_PARTS.length);

  // 所有部件都是 UTF-8 XML 文本
  for (const [name, data] of parts) {
    const text = data.toString('utf8');
    assert.ok(text.startsWith('<?xml'), `${name} 缺少 XML 声明`);
    assert.ok(text.includes('</'), `${name} 不是完整的 XML`);
  }

  const contentTypes = partText(parts, '[Content_Types].xml');
  for (const partName of [
    '/word/document.xml',
    '/word/styles.xml',
    '/word/numbering.xml',
    '/docProps/core.xml',
    '/docProps/app.xml',
  ]) {
    assert.ok(contentTypes.includes(partName), `[Content_Types].xml 缺少 ${partName}`);
  }

  const packageRels = partText(parts, '_rels/.rels');
  assert.ok(packageRels.includes('word/document.xml'));
  assert.ok(packageRels.includes('docProps/core.xml'));
  assert.ok(packageRels.includes('docProps/app.xml'));

  const documentRels = partText(parts, 'word/_rels/document.xml.rels');
  assert.ok(documentRels.includes('Target="styles.xml"'));
  assert.ok(documentRels.includes('Target="numbering.xml"'));
});

test('docx：styles.xml 使用中文字体宋体，并定义标题/列表/引用/代码/导图样式', () => {
  const parts = docxParts(SAMPLE_MARKDOWN);
  const styles = partText(parts, 'word/styles.xml');

  assert.ok(styles.includes('w:eastAsia="宋体"'), '正文/标题应设置 eastAsia=宋体');
  assert.ok(styles.includes('w:ascii="Calibri"'), '西文应使用 Calibri');
  assert.ok(styles.includes('w:ascii="Consolas"'), '代码应使用 Consolas');
  assert.ok(styles.includes('<w:sz w:val="22"/>'), '正文应为 11pt（22 半磅）');

  for (const styleId of ['Normal', 'Heading1', 'Heading2', 'Heading3', 'ListParagraph', 'Quote', 'CodeBlock', 'MindmapRoot']) {
    assert.ok(styles.includes(`w:styleId="${styleId}"`), `styles.xml 缺少样式 ${styleId}`);
  }
});

// ---------------------------------------------------------------------------
// document.xml 内容
// ---------------------------------------------------------------------------

test('document.xml：H1/H2/H3 标题与中文文本正确', () => {
  const parts = docxParts(SAMPLE_MARKDOWN);
  const xml = partText(parts, 'word/document.xml');

  assert.ok(xml.includes('<w:pStyle w:val="Heading1"/>'));
  assert.ok(xml.includes('<w:pStyle w:val="Heading2"/>'));
  assert.ok(xml.includes('<w:pStyle w:val="Heading3"/>'));
  assert.ok(xml.includes('<w:t>英语语法：第一章 时态</w:t>'));
  assert.ok(xml.includes('<w:t>1.1 核心词汇</w:t>'));
  assert.ok(xml.includes('<w:t>1.1.1 记忆方法</w:t>'));

  // H4 及以上统一降级为 H3，不产生非法样式
  const nested = partText(readZip(markdownToDocx('# 一级\n\n#### 四级标题\n')), 'word/document.xml');
  assert.ok(nested.includes('<w:pStyle w:val="Heading3"/>'));
  assert.ok(nested.includes('<w:t>四级标题</w:t>'));
});

test('document.xml：**加粗** 生成 <w:b/> run，行内代码生成等宽 run', () => {
  const parts = docxParts(SAMPLE_MARKDOWN);
  const xml = partText(parts, 'word/document.xml');

  assert.ok(xml.includes('<w:b/>'), '应存在加粗 run 属性');
  assert.ok(
    /<w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t>高频词汇<\/w:t><\/w:r>/.test(xml),
    '**高频词汇** 应生成加粗 run',
  );
  assert.ok(
    /<w:r><w:rPr><w:rFonts w:ascii="Consolas"[^>]*\/><w:sz w:val="20"\/>/.test(xml),
    '`固定搭配` 应生成等宽字体 run',
  );
  assert.ok(xml.includes('<w:t>固定搭配</w:t>'));
});

test('document.xml：无序列表支持三级缩进，有序列表有独立编号', () => {
  const parts = docxParts(SAMPLE_MARKDOWN);
  const xml = partText(parts, 'word/document.xml');
  const numbering = partText(parts, 'word/numbering.xml');

  assert.ok(xml.includes('<w:t>第一项</w:t>'));
  assert.ok(xml.includes('<w:t>第二级</w:t>'));
  assert.ok(xml.includes('<w:t>第三级</w:t>'));

  assert.ok(xml.includes('<w:ilvl w:val="0"/>'));
  assert.ok(xml.includes('<w:ilvl w:val="1"/>'));
  assert.ok(xml.includes('<w:ilvl w:val="2"/>'), '三级列表应使用 ilvl=2');
  assert.ok(xml.includes('<w:numId w:val="1"/>'), '无序列表应使用项目符号编号 numId=1');

  // 两个有序列表分别使用独立 numId（2、3），保证各自从 1 开始
  assert.ok(xml.includes('<w:numId w:val="2"/>'));
  assert.ok(xml.includes('<w:numId w:val="3"/>'));
  assert.equal((numbering.match(/<w:startOverride w:val="1"\/>/g) ?? []).length, 2);

  assert.ok(numbering.includes('<w:numFmt w:val="bullet"/>'));
  assert.ok(numbering.includes('<w:numFmt w:val="decimal"/>'));
  assert.ok(numbering.includes('w:lvlText w:val="%1."'));
});

test('document.xml：引用与代码块（Consolas 9pt、逐行成段、XML 已转义）', () => {
  const parts = docxParts(SAMPLE_MARKDOWN);
  const xml = partText(parts, 'word/document.xml');

  assert.ok(xml.includes('<w:pStyle w:val="Quote"/>'));
  assert.ok(xml.includes('<w:t>引用：记忆曲线需要反复复习。</w:t>'));
  assert.ok(/<w:r><w:rPr><w:i\/><w:iCs\/><w:color w:val="595959"\/><\/w:rPr><w:t>引用/.test(xml));

  assert.ok(xml.includes('<w:pStyle w:val="CodeBlock"/>'));
  assert.ok(xml.includes('const a = 1 &lt; 2 &amp;&amp; &quot;ok&quot;;'));
  assert.ok(xml.includes('<w:t>console.log(a);</w:t>'));

  // 水平分隔线 --- 应被跳过，不产生可见文本
  assert.equal(xml.includes('<w:t>---</w:t>'), false);
});

test('mermaid mindmap：转换为 Word 原生分级大纲并去掉 (( )) 等修饰', () => {
  const parts = docxParts(SAMPLE_MARKDOWN);
  const xml = partText(parts, 'word/document.xml');

  // 根节点：MindmapRoot 样式 + 加粗 + outlineLvl 0
  assert.ok(
    /<w:pStyle w:val="MindmapRoot"\/><w:keepNext\/><w:outlineLvl w:val="0"\/><\/w:pPr><w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t>英语复习<\/w:t><\/w:r>/.test(xml),
    '思维导图根节点应加粗并使用大纲级别 0',
  );

  // 一级子节点：ilvl=0，编号 numId=900
  assert.ok(
    /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="900"\/><\/w:numPr><w:outlineLvl w:val="1"\/><\/w:pPr><w:r><w:t>词汇<\/w:t><\/w:r>/.test(xml),
    '思维导图一级节点应使用 ilvl=0 的列表缩进',
  );
  // 二级子节点：ilvl=1，outlineLvl=2
  assert.ok(
    /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="900"\/><\/w:numPr><w:outlineLvl w:val="2"\/><\/w:pPr><w:r><w:t>高频词<\/w:t><\/w:r>/.test(xml),
    '思维导图二级节点应使用 ilvl=1 的列表缩进',
  );
  assert.ok(xml.includes('<w:t>时态</w:t>'));

  // 不能把 mermaid 源码原样贴进文档
  assert.equal(xml.includes('mindmap'), false);
  assert.equal(xml.includes('root((英语复习))'), false);
  assert.equal(xml.includes('((英语复习))'), false);
});

// ---------------------------------------------------------------------------
// 健壮性与转义
// ---------------------------------------------------------------------------

test('XML 特殊字符 < > & " \' 全部转义，非法控制字符被丢弃', () => {
  const markdown = '# A & B < C\n\n正文 "引号" & \'单引号\' <tag> 结束\u0001\n';
  const parts = docxParts(markdown);
  const xml = partText(parts, 'word/document.xml');

  assert.ok(xml.includes('A &amp; B &lt; C'));
  assert.ok(xml.includes('&quot;引号&quot;'));
  assert.ok(xml.includes('&apos;单引号&apos;'));
  assert.ok(xml.includes('&lt;tag&gt;'));
  assert.equal(xml.includes('<tag>'), false, '原始 <tag> 不应出现在 XML 中');
  assert.equal(xml.includes('\u0001'), false, 'XML 1.0 非法控制字符应被丢弃');

  // docProps 标题同样需要转义
  const core = partText(parts, 'docProps/core.xml');
  assert.ok(core.includes('A &amp; B &lt; C'));
});

test('空 Markdown / 纯空白 / null 均能生成结构合法的 docx', () => {
  for (const input of ['', '   ', '\n\n\t\n', null, undefined]) {
    const buffer = markdownToDocx(input);
    assert.ok(startsWithLocalFileHeader(buffer));

    const parts = readZip(buffer);
    for (const name of REQUIRED_DOCX_PARTS) {
      assert.ok(parts.has(name), `空文档缺少部件：${name}`);
    }
    const xml = partText(parts, 'word/document.xml');
    assert.ok(xml.includes('<w:body>'));
    assert.ok(xml.includes('<w:sectPr>'));
    assert.ok(xml.includes('<w:p/>'), '空文档至少应包含一个空段落');

    const core = partText(parts, 'docProps/core.xml');
    assert.ok(core.includes('<dc:title>学习笔记</dc:title>'), '空文档应使用默认标题');
  }
});

test('docx 标题取自第一个 H1，并写入 docProps/core.xml', () => {
  const parts = docxParts('# 我的**课程**笔记\n\n正文\n');
  const core = partText(parts, 'docProps/core.xml');
  assert.ok(core.includes('<dc:title>我的课程笔记</dc:title>'));
  assert.ok(core.includes('<dc:creator>jot</dc:creator>'));
});

// ---------------------------------------------------------------------------
// 文件写出
// ---------------------------------------------------------------------------

test('writeDocx：自动创建父目录并写出可被 readZip 解析的 docx', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'osa-docx-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const target = join(dir, 'nested', '子目录', '笔记.docx');
  await writeDocx(SAMPLE_MARKDOWN, target);

  const buffer = await readFile(target);
  assert.ok(startsWithLocalFileHeader(buffer));
  const parts = readZip(buffer);
  for (const name of REQUIRED_DOCX_PARTS) {
    assert.ok(parts.has(name));
  }
  assert.ok(partText(parts, 'word/document.xml').includes('英语语法：第一章 时态'));

  await assert.rejects(writeDocx(SAMPLE_MARKDOWN, ''), /filePath/);
});
