/**
 * 大模型提示词：与离线引擎输出同一份结构化 JSON，便于两条生成路径共用渲染层。
 * 这里只负责「说清楚要什么」，不做任何网络调用。
 * 生成目标由 config 的 prompt.persona / prompt.goal 控制（默认面向日常学习与复习）。
 */

export function buildSystemPrompt(cfg) {
  const persona = cfg?.prompt?.persona || '学习笔记整理助手'
  const goal = cfg?.prompt?.goal || '日常学习与复习'
  return (
    '你是「' + persona + '」，服务于' + goal + '。' +
    '你要把一段学习内容（视频课、教程、讲座、读书、播客、技术分享等，只要有标题和/或文字材料）' +
    '整理成可直接复习的知识笔记：优先基于用户提供的材料提炼，绝不编造材料里没有的具体结论；' +
    '材料不足时明确说明，不要硬凑细节。'
  )
}

export function buildSummaryPrompt(input) {
  const { title, subject, keywords = [], text = '', cfg } = input
  const maxChars = cfg?.maxImportChars || 20000
  const material = String(text || '').trim().slice(0, maxChars)
  const lines = [
    '内容标题：' + title,
    '学科：' + (subject || '未分类'),
    '关键词：' + (keywords.length ? keywords.join('、') : '（无）'),
    '',
    material
      ? '下面是用户提供的学习材料（字幕/讲义/笔记，可能不完整），请基于它整理：\n\n' + material
      : '没有提供文字材料，只能看到标题与关键词。请做通用化整理，并在 overview 里注明「未提供学习文本，以下为通用整理」。',
    '',
    '只返回一个合法 JSON 对象（不要 markdown 代码块、不要解释、不要尾逗号），字段如下：',
    '{"overview":"一句话总结（80 字内）",',
    ' "knowledgePoints":[{"point":"知识点标题","detail":"2~4 句解释/步骤/例题思路"}],',
    ' "keyTerms":[{"term":"概念或公式","explain":"含义与使用条件"}],',
    ' "studyTips":["学习重点/难点/复习建议"],',
    ' "pitfalls":["易错点/易混淆点"],',
    ' "reviewQuestions":["可自测的问题或练习"],',
    ' "mindmap":{"title":"根节点","children":[{"title":"一级节点","children":[{"title":"二级节点"}]}]}}',
    '',
    '要求：knowledgePoints 8~20 条、分 2~3 层；全部中文；mindmap 节点 ≤3 层、每层 ≤12 个；不要输出 JSON 以外的任何内容。',
  ]
  return lines.join('\n')
}

export function buildMessages(input) {
  return {
    system: buildSystemPrompt(input.cfg),
    user: buildSummaryPrompt(input),
  }
}
