import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from './model.mjs';
import {csvCell,reportMarkdown} from './report.mjs';

test('Markdown 保留完整通话记录、空行和原有 Markdown 字符',()=>{
  const notes='第一行\n\n  第二行\n```\n# 第三行\n'+'后续问题'.repeat(100);
  const report=reportMarkdown([{...defaults,company:'A|B',notes}], 'target');
  assert.ok(report.includes('````\n'+notes+'\n````'));
  assert.ok(report.includes('A\\|B'));
  assert.ok(report.includes('| 月 Base | — |'));
});

test('CSV 将公式形状的文本保存为文本，保留引号和数字',()=>{
  assert.equal(csvCell('  ＝1+2'),'"\'  ＝1+2"');
  assert.equal(csvCell('\n@name'),'"\'\n@name"');
  assert.equal(csvCell('A,"B"'),'"A,""B"""');
  assert.equal(csvCell(-50),'-50');
});
