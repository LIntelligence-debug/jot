/**
 * 笔记工坊 · 前端控制台
 * 纯原生 JS，无构建步骤；通过 /api/state + /api/stream(SSE) 与本地服务通信。
 */
(function () {
  'use strict'

  var state = null
  var es = null
  var toastTimer = null

  function $(id) { return document.getElementById(id) }
  function el(tag, cls, text) {
    var n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }
  function pad2(n) { return String(n).padStart(2, '0') }
  function fmtTime(ts) {
    if (!ts) return '--'
    var d = new Date(ts)
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
  }
  function fmtDateTime(ts) {
    if (!ts) return '--'
    var d = new Date(ts)
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }

  function toast(message, type) {
    var box = $('toast')
    box.textContent = message
    box.className = 'toast ' + (type || 'ok')
    box.classList.remove('hidden')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { box.classList.add('hidden') }, 4200)
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.text().then(function (text) {
        var data
        try { data = text ? JSON.parse(text) : {} } catch (e) { data = { text: text } }
        if (!res.ok || data.ok === false) {
          var err = new Error(data.error || ('请求失败（HTTP ' + res.status + '）'))
          err.status = res.status
          throw err
        }
        return data
      })
    })
  }

  var DECISION_LABEL = {
    idle: '空闲',
    paused: '已暂停',
    'watch-unsupported': '系统不支持自动检测',
    'window-error': '读取窗口失败',
    'non-video': '非播放器窗口',
    'ignored-window': '标题被忽略',
    seen: '已整理过',
    waiting: '等待稳定',
    detected: '已识别',
    processed: '已生成',
    error: '出错',
  }

  var MODE_LABEL = {
    offline: '离线模板引擎',
    openai: 'OpenAI 兼容接口',
    anthropic: 'Anthropic 兼容接口',
  }

  function generationLabel(obj) {
    if (!obj) return '--'
    if (obj.generatedBy === 'llm') return '大模型生成'
    if (obj.generatedBy === 'offline-fallback') return '离线引擎（模型失败回退）'
    return '离线模板引擎'
  }

  function render(snap) {
    state = snap
    var enabled = state.enabled === true
    var supported = state.watchSupported !== false

    var pill = $('statusPill')
    var text = $('statusText')
    if (state.running) {
      pill.className = 'pill busy'
      text.textContent = '正在生成…'
    } else if (!enabled) {
      pill.className = 'pill paused'
      text.textContent = '已暂停'
    } else if (state.decision === 'error') {
      pill.className = 'pill error'
      text.textContent = '出错'
    } else {
      pill.className = 'pill running'
      text.textContent = '运行中'
    }

    $('enabledToggle').checked = enabled
    $('enabledToggle').disabled = !supported
    $('watchBadge').textContent = supported ? (state.platform || 'Windows') : '不支持自动检测'
    $('watchHint').classList.toggle('hidden', supported)
    $('intervalInput').value = Math.round((state.pollIntervalMs || 15000) / 1000)

    var fg = state.foreground || null
    $('fgTitle').textContent = fg && fg.raw ? fg.raw : '等待浏览器 / 播放器窗口…'
    $('fgClean').textContent = fg && fg.cleaned ? '识别标题：' + fg.cleaned : 'Windows 下切到学习页面会自动识别'
    $('procBadge').textContent = fg && fg.proc ? fg.proc : '--'
    $('decision').textContent = DECISION_LABEL[state.decision] || state.decision || '--'
    $('stableCount').textContent = (state.pending ? state.pending.count : 0) + ' / ' + (state.stablePolls || 2)
    $('lastTick').textContent = fg && fg.at ? fmtTime(fg.at) : '--'

    $('statSubjects').textContent = String(state.subjectCount || 0)
    $('statVideos').textContent = String(state.videoCount || 0)
    var list = $('subjectList')
    list.innerHTML = ''
    if (!state.subjects || state.subjects.length === 0) {
      list.appendChild(el('div', 'muted', '还没有任何学科'))
    } else {
      state.subjects.forEach(function (s) {
        var row = el('div', 'subject-item')
        row.appendChild(el('span', null, s.name))
        row.appendChild(el('span', null, s.videos + ' 集'))
        list.appendChild(row)
      })
    }

    var mode = (state.llm && state.llm.mode) || 'offline'
    $('llmMode').textContent = MODE_LABEL[mode] || mode
    $('llmModel').textContent = mode === 'offline' ? '—' : ((state.llm && state.llm.model) || '--')
    if (mode === 'offline') {
      $('llmAuth').textContent = '无需联网'
    } else {
      $('llmAuth').textContent = state.llm && state.llm.hasAuth
        ? '已配置（' + (state.llm.apiKeyEnv || 'STUDY_LLM_API_KEY') + '）'
        : '未配置（将回退离线）'
    }

    var banner = $('modeBanner')
    if (mode === 'offline') {
      banner.innerHTML = ''
      banner.appendChild(document.createTextNode('离线模式：不联网，笔记由本地模板引擎生成。需要更高质量时，可在「设置」里接入大模型 API。'))
      banner.className = 'banner'
    } else {
      banner.innerHTML = ''
      banner.appendChild(document.createTextNode('已接入 ' + (MODE_LABEL[mode] || mode) + ' · ' + (state.llm.model || '') + '：模型调用失败会自动回退离线引擎，笔记不会丢。'))
      banner.className = 'banner'
    }

    renderLatest(state.latest)
    renderHistory(state.recent || [])
    renderLogs(state.logs || [])
    renderStage(state.stage)
    updateCountdown()
  }

  function renderLatest(latest) {
    var meta = $('summaryMeta')
    var body = $('summaryBody')
    meta.innerHTML = ''
    body.innerHTML = ''
    if (!latest) {
      body.className = 'summary-body empty'
      body.textContent = '还没有生成笔记。点「导入文本」粘贴学习材料（字幕/讲义/笔记），离线也能生成笔记。'
      return
    }
    var v = latest.video || latest
    body.className = 'summary-body'
    meta.appendChild(el('span', 'tag', latest.subject || v.subject || '未分类'))
    meta.appendChild(el('span', 'tag', generationLabel(v)))
    meta.appendChild(el('span', 'muted', fmtDateTime(v.updatedAt || v.createdAt)))
    var title = el('div', 'summary-title', v.title)
    meta.appendChild(title)
    var s = v.summary || {}
    if (s.overview) {
      var ov = el('p', 'summary-overview', s.overview)
      body.appendChild(ov)
    }
    var points = (s.knowledgePoints || []).slice(0, 8)
    if (points.length) {
      body.appendChild(el('h3', null, '核心知识点'))
      var ul = el('ul')
      points.forEach(function (p) {
        var li = el('li')
        var b = el('b', null, p.point)
        li.appendChild(b)
        if (p.detail) li.appendChild(document.createTextNode('：' + p.detail))
        ul.appendChild(li)
      })
      body.appendChild(ul)
    }
    var actions = el('div', 'summary-actions')
    if (v.noteDocx) {
      var openBtn = el('button', 'btn small', '打开 Word')
      openBtn.addEventListener('click', function () { openPath(v.noteDocx) })
      actions.appendChild(openBtn)
    }
    var mdBtn = el('button', 'btn ghost small', '预览 Markdown')
    mdBtn.addEventListener('click', function () { showMarkdown(v.title) })
    actions.appendChild(mdBtn)
    body.appendChild(actions)
  }

  function renderHistory(rows) {
    var box = $('historyList')
    $('historyCount').textContent = String(rows.length)
    box.innerHTML = ''
    if (!rows.length) {
      box.appendChild(el('div', 'muted', '暂无记录'))
      return
    }
    rows.forEach(function (r) {
      var item = el('div', 'history-item')
      var main = el('div', 'h-main')
      main.appendChild(el('div', 'h-title', r.title))
      var meta = el('div', 'h-meta')
      meta.textContent = (r.subject || '未分类') + ' · ' + fmtDateTime(r.at) + ' · ' + generationLabel(r)
      main.appendChild(meta)
      item.appendChild(el('span', 'h-sub', r.subject || '未分类'))
      item.appendChild(main)
      item.addEventListener('click', function () {
        showMarkdown(r.title)
      })
      box.appendChild(item)
    })
  }

  function renderLogs(rows) {
    var box = $('logList')
    box.innerHTML = ''
    rows.slice().reverse().forEach(function (row) {
      var line = el('div', 'log-row ' + (row.level || 'info'))
      line.appendChild(el('span', 'l-time', fmtTime(row.at)))
      line.appendChild(el('span', 'l-level', String(row.level || 'info').toUpperCase()))
      line.appendChild(el('span', 'l-msg', row.message))
      box.appendChild(line)
    })
  }

  function renderStage(stage) {
    var badge = $('stageBadge')
    var title = $('stageTitle')
    var msg = $('stageMessage')
    var steps = $('stepper').querySelectorAll('li')
    if (!stage || stage.stage === 'idle' || stage.stage === 'start') {
      badge.textContent = '空闲'
      if (stage && stage.stage === 'start') {
        badge.textContent = '开始'
        title.textContent = stage.title || '开始处理…'
        msg.textContent = stage.message || ''
      }
      steps.forEach(function (s) { s.className = '' })
      return
    }
    var order = ['classify', 'summarize', 'write', 'done']
    var idx = order.indexOf(stage.stage)
    badge.textContent = stage.stage === 'done' ? '完成' : '处理中'
    title.textContent = (stage.title ? stage.title + ' · ' : '') + (stage.message || '')
    msg.textContent = stage.subject ? '学科：' + stage.subject : ''
    steps.forEach(function (s) {
      var k = order.indexOf(s.getAttribute('data-stage'))
      s.className = k < idx ? 'done' : (k === idx ? 'active' : '')
    })
  }

  function updateCountdown() {
    if (!state || !state.enabled || !state.nextTickAt) {
      $('countdown').textContent = '--'
      return
    }
    var left = Math.max(0, Math.round((state.nextTickAt - Date.now()) / 1000))
    $('countdown').textContent = left + 's'
  }

  function refresh() {
    return api('GET', '/api/state').then(function (data) {
      state = data
      render(data)
    }).catch(function (error) {
      toast('无法连接本地服务：' + error.message, 'err')
    })
  }

  function openPath(path) {
    return api('POST', '/api/open', { path: path }).catch(function (error) {
      toast(error.message, 'err')
    })
  }

  function showMarkdown(title) {
    api('POST', '/api/notes/markdown', { title: title }).then(function (data) {
      $('mdTitle').textContent = title
      $('mdBody').textContent = data.markdown || ''
      $('mdModal').classList.remove('hidden')
    }).catch(function (error) {
      toast(error.message, 'err')
    })
  }

  function connect() {
    if (es) es.close()
    es = new EventSource('/api/stream')
    es.addEventListener('hello', function (e) {
      state = JSON.parse(e.data)
      render(state)
    })
    es.addEventListener('state', function (e) {
      state = JSON.parse(e.data)
      render(state)
    })
    es.addEventListener('stage', function (e) {
      var stage = JSON.parse(e.data)
      if (state) state.stage = stage
      renderStage(stage)
    })
    es.addEventListener('log', function (e) {
      if (!state) return
      state.logs = (state.logs || []).concat([JSON.parse(e.data)]).slice(-200)
      renderLogs(state.logs)
    })
    es.addEventListener('tick', function (e) {
      var data = JSON.parse(e.data)
      if (!state) return
      state.decision = data.decision
      state.pending = data.pendingCount ? { count: data.pendingCount } : null
      state.nextTickAt = data.nextTickAt
      $('decision').textContent = DECISION_LABEL[data.decision] || data.decision
      $('stableCount').textContent = (state.pending ? state.pending.count : 0) + ' / ' + (state.stablePolls || 2)
      updateCountdown()
    })
    es.addEventListener('foreground', function (e) {
      var fg = JSON.parse(e.data)
      if (!state) return
      state.foreground = fg
      $('fgTitle').textContent = fg.raw || '--'
      $('fgClean').textContent = fg.cleaned ? '识别标题：' + fg.cleaned : '--'
      $('procBadge').textContent = fg.proc || '--'
      $('lastTick').textContent = fmtTime(fg.at)
    })
    es.addEventListener('result', function (e) {
      var result = JSON.parse(e.data)
      toast('笔记已生成：' + (result.title || ''), 'ok')
      refresh()
    })
    es.onerror = function () {
      $('statusPill').className = 'pill error'
      $('statusText').textContent = '连接断开'
    }
  }

  function bind() {
    $('enabledToggle').addEventListener('change', function (e) {
      var on = e.target.checked
      api('POST', '/api/config', { enabled: on }).then(function (data) {
        state = data.state
        render(state)
        toast(on ? '自动检测已开启' : '自动检测已暂停', 'ok')
      }).catch(function (error) {
        e.target.checked = !on
        toast(error.message, 'err')
      })
    })

    $('btnApplyInterval').addEventListener('click', function () {
      var sec = Number($('intervalInput').value)
      if (!Number.isFinite(sec) || sec < 3 || sec > 300) { toast('间隔需在 3~300 秒之间', 'err'); return }
      api('POST', '/api/config', { pollIntervalMs: Math.round(sec * 1000) }).then(function (data) {
        state = data.state
        render(state)
        toast('间隔已更新为 ' + sec + ' 秒', 'ok')
      }).catch(function (error) { toast(error.message, 'err') })
    })

    var presets = document.querySelectorAll('.presets button')
    for (var i = 0; i < presets.length; i++) {
      presets[i].addEventListener('click', function (e) {
        $('intervalInput').value = e.target.getAttribute('data-interval')
        $('btnApplyInterval').click()
      })
    }

    $('btnPoll').addEventListener('click', function () {
      api('POST', '/api/poll', {}).then(function (data) {
        state = data.state
        render(state)
        toast('已单步检测一次：' + (DECISION_LABEL[state.decision] || state.decision), 'ok')
      }).catch(function (error) { toast(error.message, 'err') })
    })

    $('btnScan').addEventListener('click', function () {
      if (state && state.watchSupported === false) {
        openImportModal('')
        return
      }
      api('POST', '/api/scan', {}).then(function (data) {
        toast('已开始整理：' + (data.result && data.result.title ? data.result.title : ''), 'ok')
        refresh()
      }).catch(function (error) {
        toast(error.message, 'err')
        openImportModal('')
      })
    })

    $('btnImport').addEventListener('click', function () { openImportModal('') })
    $('btnRebuild').addEventListener('click', function () {
      api('POST', '/api/rebuild', {}).then(function (data) {
        var failed = (data.outcome || []).filter(function (o) { return !o.ok })
        toast(failed.length ? ('重建完成，失败 ' + failed.length + ' 项') : '全部 Word 已重建', failed.length ? 'warn' : 'ok')
        refresh()
      }).catch(function (error) { toast(error.message, 'err') })
    })
    $('btnOpenDir').addEventListener('click', function () {
      if (state) openPath(state.outputDir)
    })
    $('btnRefresh').addEventListener('click', refresh)
    $('btnOpenLatest').addEventListener('click', function () {
      if (!state || !state.latest) { toast('还没有笔记', 'err'); return }
      var v = state.latest.video || state.latest
      if (v.noteDocx) openPath(v.noteDocx)
      else showMarkdown(v.title)
    })
    $('btnClearLogs').addEventListener('click', function () {
      if (!state) return
      state.logs = []
      renderLogs([])
    })

    $('btnSettings').addEventListener('click', openSettings)
    $('btnCloseSettings').addEventListener('click', closeSettings)
    $('btnCancelSettings').addEventListener('click', closeSettings)
    $('btnSaveSettings').addEventListener('click', saveSettings)
    $('btnLoadModels').addEventListener('click', loadModels)
    $('btnTestLlm').addEventListener('click', function () {
      toast('正在测试连接…', 'ok')
      api('POST', '/api/llm/test', {}).then(function (data) {
        toast(data.message || ('连接成功（' + (data.ms || 0) + 'ms）'), 'ok')
      }).catch(function (error) { toast(error.message, 'err') })
    })
    $('btnShutdown').addEventListener('click', function () {
      if (!window.confirm('确定退出本地服务？退出后需要重新启动学习助手。')) return
      api('POST', '/api/shutdown', {}).then(function () {
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">本地服务已退出，可以关闭此页面。</div>'
      }).catch(function () {
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif">本地服务已退出，可以关闭此页面。</div>'
      })
    })

    $('btnCloseImport').addEventListener('click', function () { $('importModal').classList.add('hidden') })
    $('btnCancelImport').addEventListener('click', function () { $('importModal').classList.add('hidden') })
    $('btnStartImport').addEventListener('click', submitImport)
    $('btnCloseMd').addEventListener('click', function () { $('mdModal').classList.add('hidden') })

    setInterval(updateCountdown, 1000)
  }

  function openImportModal(defaultTitle) {
    $('importTitle').value = defaultTitle || ''
    $('importText').value = ''
    $('importModal').classList.remove('hidden')
    setTimeout(function () { $('importTitle').focus() }, 30)
  }

  function submitImport() {
    var title = $('importTitle').value.trim()
    var text = $('importText').value.trim()
    if (!title) { toast('请填写内容标题', 'err'); return }
    var task = text
      ? api('POST', '/api/import', { title: title, text: text })
      : api('POST', '/api/scan', { title: title })
    task.then(function () {
      $('importModal').classList.add('hidden')
      toast('已开始整理：' + title, 'ok')
      refresh()
    }).catch(function (error) { toast(error.message, 'err') })
  }

  function openSettings() {
    if (!state || !state.llm) return
    $('setMode').value = state.llm.mode || 'offline'
    $('setBaseURL').value = state.llm.baseURL || ''
    $('setModel').value = state.llm.model || ''
    $('setApiKeyEnv').value = state.llm.apiKeyEnv || 'STUDY_LLM_API_KEY'
    $('setOutputDir').textContent = state.outputDir || ''
    $('modal').classList.remove('hidden')
  }

  function closeSettings() {
    $('modal').classList.add('hidden')
  }

  function saveSettings() {
    var patch = {
      llmMode: $('setMode').value,
      llmBaseURL: $('setBaseURL').value.trim(),
      llmModel: $('setModel').value.trim(),
      llmApiKeyEnv: $('setApiKeyEnv').value.trim() || 'STUDY_LLM_API_KEY',
    }
    api('POST', '/api/config', patch).then(function (data) {
      state = data.state
      render(state)
      closeSettings()
      toast('设置已保存', 'ok')
    }).catch(function (error) { toast(error.message, 'err') })
  }

  function loadModels() {
    api('GET', '/api/llm/models').then(function (data) {
      var models = data.models || []
      if (!models.length) { toast('没有拉取到模型列表', 'warn'); return }
      toast('可用模型：' + models.slice(0, 6).join('、') + (models.length > 6 ? ' …' : ''), 'ok')
    }).catch(function (error) { toast(error.message, 'err') })
  }

  connect()
  bind()
  refresh()
  setInterval(function () {
    if (!es || es.readyState === 2) connect()
  }, 5000)
})()
