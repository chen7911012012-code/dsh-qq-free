/**
 * 远程控制台页面（手机/外网）。所有请求都带 Bearer token。
 * 只使用浏览器原生 API，不依赖任何构建工具。
 */
export const REMOTE_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>QQ 自由发言控制台</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
    background: #101319; color: #e8ecf4; padding: 14px 12px 50px; }
  .wrap { max-width: 620px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 18px; margin: 0; }
  .sub { color: #8a93a6; font-size: 12px; margin: 4px 0 0; }
  .card { background: #171c25; border: 1px solid #262d3a; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 9px; }
  label { font-size: 12px; color: #9aa4b8; display: flex; flex-direction: column; gap: 5px; }
  input, select, textarea, button { font: inherit; }
  input, select, textarea { width: 100%; background: #0f131a; color: #e8ecf4; border: 1px solid #2c3544; border-radius: 9px; padding: 8px 9px; outline: none; }
  textarea { min-height: 70px; resize: vertical; }
  input:focus, select:focus, textarea:focus { border-color: #4d6bfe; }
  button { border: 0; border-radius: 9px; padding: 9px 12px; background: #4d6bfe; color: #fff; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; }
  button.ghost { background: #232b3a; color: #cdd6e6; font-weight: 500; }
  button.danger { background: #b33232; }
  button.sm { padding: 5px 9px; font-size: 12px; }
  .row { display: flex; gap: 7px; flex-wrap: wrap; align-items: center; }
  .row > * { flex: 1 1 130px; min-width: 0; }
  .row > button, .row > .badge { flex: 0 0 auto; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; border: 1px solid #2c3544; color: #9aa4b8; }
  .badge.on { color: #4ade80; border-color: #2f6b46; }
  .muted { color: #8a93a6; font-size: 12px; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 11px; color: #8a93a6; word-break: break-all; }
  .notice { font-size: 13px; padding: 8px 10px; border-radius: 9px; border: 1px solid #2c3544; color: #cdd6e6; }
  .notice.err { color: #fca5a5; border-color: #7f2d2d; }
  .notice.ok { color: #86efac; border-color: #2f6b46; }
  .hidden { display: none !important; }
  .tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .tab { flex: 0 0 auto; background: #171c25; border: 1px solid #262d3a; color: #9aa4b8; font-weight: 500; padding: 7px 12px; }
  .tab.on { background: #26324a; color: #fff; border-color: #3d527d; }
  .pane { display: flex; flex-direction: column; gap: 12px; }
  .list { display: flex; flex-direction: column; gap: 7px; max-height: 300px; overflow: auto; }
  .item { border: 1px solid #262d3a; border-radius: 9px; padding: 8px 9px; display: flex; gap: 7px; align-items: flex-start; }
  .item-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .item-actions { flex: 0 0 auto; display: flex; gap: 5px; flex-wrap: wrap; }
  .q { font-size: 13px; color: #dfe6f3; }
  .a { font-size: 13px; color: #a9b6cc; white-space: pre-wrap; }
  .empty { color: #8a93a6; font-size: 12px; margin: 2px 0; }
</style>
</head>
<body>
<div class="wrap">
  <div>
    <h1>QQ 自由发言控制台</h1>
    <p class="sub">发送 · 自动发言 · 问答 · 管理 · 设置（手机可用）</p>
  </div>

  <div class="card" id="loginCard">
    <label>访问 token
      <input id="tokenInput" type="password" placeholder="在 DSH 面板「远程发言网页」里复制" autocomplete="off">
    </label>
    <button id="loginBtn">进入</button>
    <div class="notice hidden" id="loginNotice"></div>
  </div>

  <div id="app" class="hidden" style="display:flex;flex-direction:column;gap:12px">
    <div class="card">
      <div class="row">
        <span class="badge" id="statusBadge">连接中…</span>
        <button class="ghost" id="refreshBtn">刷新</button>
        <button class="ghost" id="logoutBtn">退出</button>
      </div>
      <div class="muted" id="statusText"></div>
    </div>

    <div class="tabs">
      <button class="tab on" data-tab="send">发送</button>
      <button class="tab" data-tab="auto">自动</button>
      <button class="tab" data-tab="qa">问答</button>
      <button class="tab" data-tab="manage">管理</button>
      <button class="tab" data-tab="settings">设置</button>
    </div>

    <div class="pane" id="pane-send">
      <div class="card">
        <label>发送目标
          <select id="target"></select>
        </label>
        <label>@ 群成员（仅单选群聊时有效）
          <select id="mention"><option value="">不 @ 成员</option></select>
        </label>
        <textarea id="text" placeholder="想让它说什么？"></textarea>
        <div class="row">
          <button id="sendBtn">发送到 QQ</button>
          <button class="ghost" id="genBtn">让 DeepSeek 写一句</button>
        </div>
        <div class="notice hidden" id="sendNotice"></div>
      </div>

      <div class="card">
        <label>从本地选择图片 / 表情包 / 视频 / 语音 / 文件（≤5MB）
          <input id="mediaFile" type="file" accept="image/*,video/*,audio/*,*/*">
        </label>
        <div class="muted" id="mediaHint">未选择文件</div>
        <label>说明文字（可选）
          <input id="mediaCaption" placeholder="会单独发一条">
        </label>
        <button id="mediaBtn">发送媒体</button>
      </div>

      <div class="card">
        <strong style="font-size:14px">最近发送</strong>
        <div class="list" id="log"></div>
      </div>
    </div>

    <div class="pane hidden" id="pane-auto">
      <div class="card">
        <label class="row"><input type="checkbox" id="autoEnabled" style="flex:0 0 auto"> <span>启用自动发言</span></label>
        <label>目标（可选板块）
          <select id="autoTarget"></select>
        </label>
        <label>间隔（分钟）
          <input id="autoInterval" type="number" min="1" max="1440">
        </label>
        <label>话题（可选）
          <textarea id="autoTopics" placeholder="想让它围绕什么聊"></textarea>
        </label>
        <div class="row">
          <button id="autoSave">保存自动发言</button>
          <button class="ghost" id="autoNow">现在就来一句</button>
        </div>
        <div class="notice hidden" id="autoNotice"></div>
      </div>
    </div>

    <div class="pane hidden" id="pane-qa">
      <div class="card">
        <strong style="font-size:14px">问答库</strong>
        <div class="list" id="qaList"></div>
        <div class="row" style="margin-top:6px">
          <button class="sm ghost" id="qaRefresh">刷新</button>
        </div>
      </div>
      <div class="card">
        <label>问题<input id="qaQuestion" placeholder="群友会怎么问"></label>
        <label>答案<textarea id="qaAnswer" placeholder="命中后直接回复的内容"></textarea></label>
        <label>关键词（可选，逗号分隔）<input id="qaKeywords"></label>
        <button id="qaAdd">添加问答</button>
        <div class="notice hidden" id="qaNotice"></div>
      </div>
    </div>

    <div class="pane hidden" id="pane-manage">
      <div class="card">
        <div class="row">
          <label>操作人<input id="operatorName" value="管理员"></label>
          <button class="sm ghost" id="joinsRefresh">刷新入群申请</button>
        </div>
        <div class="list" id="joinList"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">今日运势记录（全部同步）</strong>
        <div class="list" id="fortuneList"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">群成员操作</strong>
        <label>成员 openid<input id="memberOpenid" placeholder="member_openid"></label>
        <label>禁言分钟<input id="muteMinutes" type="number" min="1" max="43200" value="10"></label>
        <div class="row">
          <button id="muteBtn">禁言</button>
          <button class="ghost" id="unmuteBtn">解除禁言</button>
          <button class="danger" id="kickBtn">踢出</button>
        </div>
        <div class="notice hidden" id="memberNotice"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">屏蔽成员</strong>
        <label>群聊
          <select id="blockGroup"></select>
        </label>
        <label>成员 openid<input id="blockMember" placeholder="member_openid"></label>
        <label>备注（可选）<input id="blockName"></label>
        <button id="blockAdd">屏蔽该成员</button>
        <div class="list" id="blockList"></div>
        <div class="notice hidden" id="blockNotice"></div>
        <div class="muted">屏蔽 @ 某人（消息里 @ 到他就整条忽略）</div>
        <label>被 @ 的成员 openid<input id="mentionMember" placeholder="member_openid"></label>
        <label>备注（可选）<input id="mentionName"></label>
        <button id="mentionAdd">屏蔽 @</button>
        <div class="list" id="mentionList"></div>
        <div class="notice hidden" id="mentionNotice"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">违禁词与处罚</strong>
        <label class="row"><input type="checkbox" id="modEnabled" style="flex:0 0 auto"> <span>启用违禁词检测</span></label>
        <label>违禁词（每行一个）<textarea id="modWords"></textarea></label>
        <label>生效群 group_openid（每行一个）<textarea id="modGroups"></textarea></label>
        <label>违规几次后禁言（0=不禁言）<input id="modMuteAfter" type="number" min="0" max="100"></label>
        <label>禁言时长（分钟）<input id="modMute" type="number" min="1" max="43200"></label>
        <label>违规几次后踢出（0=不踢）<input id="modKickAfter" type="number" min="0" max="100"></label>
        <div class="muted">踢出次数必须大于禁言次数；这两个次数只能在 DSH 面板和主网页设置，分群网页只显示。</div>
        <button id="modSave">保存违禁词设置</button>
        <div class="notice hidden" id="modNotice"></div>
        <div class="muted">违规次数</div>
        <div class="list" id="strikeList"></div>
        <button class="sm ghost" id="strikesReset">全部重置</button>
      </div>
    </div>

    <div class="pane hidden" id="pane-settings">
      <div class="card">
        <strong style="font-size:14px">AI 对话通道</strong>
        <label class="row"><input type="checkbox" id="chatEnabled" style="flex:0 0 auto"> <span>启用通道（需先停用官方 QQ 插件）</span></label>
        <label>对话人设（提问时）<textarea id="chatPersona"></textarea></label>
        <label>闲聊智能体人设（非提问时）<textarea id="chatAgentPersona"></textarea></label>
        <label class="row"><input type="checkbox" id="chatUseQa" style="flex:0 0 auto"> <span>优先使用问答库（命中即用库答案，未命中走 DeepSeek）</span></label>
        <button id="chatSave">保存对话设置</button>
        <div class="notice hidden" id="chatNotice"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">入群欢迎 / 申请通知</strong>
        <label class="row"><input type="checkbox" id="welcomeEnabled" style="flex:0 0 auto"> <span>启用入群欢迎</span></label>
        <label>欢迎语<input id="welcomeText"></label>
        <label>欢迎生效群（每行一个，留空全部）<textarea id="welcomeGroups"></textarea></label>
        <label class="row"><input type="checkbox" id="joinNoticeEnabled" style="flex:0 0 auto"> <span>发送入群申请通知</span></label>
        <label class="row"><input type="checkbox" id="joinNoticeAvatar" style="flex:0 0 auto"> <span>通知带申请头像</span></label>
        <button id="welcomeSave">保存欢迎设置</button>
        <div class="notice hidden" id="welcomeNotice"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">会话目标</strong>
        <div class="row">
          <select id="targetScope"><option value="group">群聊</option><option value="c2c">私聊</option></select>
          <input id="targetOpenid" placeholder="group_openid / user_openid">
        </div>
        <input id="targetName" placeholder="备注名（可选）">
        <button id="targetAdd">添加目标</button>
        <div class="list" id="targetList"></div>
        <div class="notice hidden" id="targetNotice"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">群板块（1–3 个群）</strong>
        <input id="boardName" placeholder="板块名">
        <div id="boardGroups" class="list"></div>
        <button id="boardAdd">添加板块</button>
        <div class="list" id="boardList"></div>
        <div class="notice hidden" id="boardNotice"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">分群网页公告</strong>
        <label>公告内容<textarea id="paText" placeholder="只显示在分群网页顶部，不会发到 QQ 群"></textarea></label>
        <label>显示方式
          <select id="paMode">
            <option value="once">仅显示一次（点「知道了」下次不显示）</option>
            <option value="always">每次都显示</option>
          </select>
        </label>
        <div class="muted">不选群 = 所有分群网页都显示</div>
        <div id="paGroups" class="list"></div>
        <button id="paPublish">发布公告</button>
        <div class="notice hidden" id="paNotice"></div>
        <div class="list" id="paList"></div>
      </div>

      <div class="card">
        <strong style="font-size:14px">远程信息</strong>
        <div class="muted" id="remoteInfo"></div>
      </div>
    </div>
  </div>
</div>

<script>
(function () {
  var token = localStorage.getItem('qqf_remote_token') || ''
  var state = null
  var mediaFile = null
  var boardPick = []
  var paPick = []
  var $ = function (id) { return document.getElementById(id) }
  function headers() { return { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' } }
  function notice(el, text, kind) { el.className = 'notice' + (kind ? ' ' + kind : ''); el.textContent = text; el.classList.remove('hidden') }
  function showLogin(message) { $('app').classList.add('hidden'); $('loginCard').classList.remove('hidden'); if (message) notice($('loginNotice'), message, 'err') }
  function showApp() { $('loginCard').classList.add('hidden'); $('app').classList.remove('hidden') }

  async function request(path, options) {
    var res = await fetch(path, options || { headers: headers(), cache: 'no-store' })
    if (res.status === 401) { showLogin('token 不正确或已失效'); throw new Error('unauthorized') }
    var data = await res.json()
    if (!res.ok || data.ok !== true) throw new Error(data.error || ('HTTP ' + res.status))
    return data
  }
  async function post(path, body) {
    var data = await request(path, { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) })
    if (data.state) state = data.state
    render()
    return data
  }
  async function loadState(silent) {
    try {
      state = await request('/api/state')
      render()
      if (!silent) showApp()
    } catch (err) { if (!silent) showLogin(err.message || String(err)) }
  }

  function option(select, value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; select.appendChild(o) }

  function render() {
    if (!state) return
    var badge = $('statusBadge')
    badge.textContent = state.chat.state === 'connected' ? '通道已连接' : state.chat.enabled ? '通道未连接' : '通道未启用'
    badge.className = 'badge' + (state.chat.state === 'connected' ? ' on' : '')
    $('statusText').textContent = '收到 ' + state.chat.messages + ' 条 · 回复 ' + state.chat.replies + ' 条' + (state.chat.lastError ? ' · ' + state.chat.lastError : '')

    var targets = $('target')
    var keepTarget = targets.value
    targets.innerHTML = ''
    state.targets.forEach(function (t) { option(targets, t.id, t.name + ' · ' + (t.scope === 'group' ? '群聊' : '私聊')) })
    ;(state.boards || []).forEach(function (b) { option(targets, b.id, '板块：' + b.name + '（' + b.count + ' 群）') })
    if (keepTarget) targets.value = keepTarget
    if (!targets.value && state.targets[0]) targets.value = state.targets[0].id

    var selected = state.targets.filter(function (t) { return t.id === targets.value })[0]
    var mention = $('mention')
    var keepMention = mention.value
    mention.innerHTML = '<option value="">不 @ 成员</option>'
    ;(state.members || []).filter(function (m) { return selected && m.groupOpenid === selected.openid }).forEach(function (m) {
      option(mention, m.openid, '@' + m.name)
    })
    if (keepMention) mention.value = keepMention

    var autoTarget = $('autoTarget')
    var keepAuto = autoTarget.value
    autoTarget.innerHTML = ''
    state.targets.forEach(function (t) { option(autoTarget, t.id, t.name) })
    ;(state.boards || []).forEach(function (b) { option(autoTarget, b.id, '板块：' + b.name) })
    if (state.auto && state.auto.targetId) autoTarget.value = state.auto.targetId
    else if (keepAuto) autoTarget.value = keepAuto

    if (state.auto) {
      $('autoEnabled').checked = state.auto.enabled === true
      $('autoInterval').value = state.auto.intervalMinutes || 120
      $('autoTopics').value = state.auto.topics || ''
    }

    var log = $('log'); log.innerHTML = ''
    ;(state.log || []).slice(0, 20).forEach(function (e) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var meta = document.createElement('div'); meta.className = 'mono'; meta.textContent = (e.atLabel || '') + ' · ' + (e.name || '') + ' · ' + (e.kind || '')
      var text = document.createElement('div'); text.className = 'a'; text.textContent = e.text || ''
      main.appendChild(meta); main.appendChild(text); div.appendChild(main); log.appendChild(div)
    })

    var qaList = $('qaList'); qaList.innerHTML = ''
    ;(Array.isArray(state.qa) ? state.qa : []).slice(0, 50).forEach(function (item) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var q = document.createElement('div'); q.className = 'q'; q.textContent = '问：' + item.question
      var a = document.createElement('div'); a.className = 'a'; a.textContent = '答：' + item.answer
      main.appendChild(q); main.appendChild(a)
      var actions = document.createElement('div'); actions.className = 'item-actions'
      var del = document.createElement('button'); del.className = 'sm danger'; del.textContent = '删除'
      del.onclick = function () { post('/api/qa', { action: 'remove', id: item.id }).then(function () { notice($('qaNotice'), '已删除', 'ok') }).catch(function (e) { notice($('qaNotice'), e.message, 'err') }) }
      actions.appendChild(del); div.appendChild(main); div.appendChild(actions); qaList.appendChild(div)
    })

    var joins = $('joinList'); joins.innerHTML = ''
    var fortuneList = $('fortuneList'); fortuneList.innerHTML = ''
    ;(state.fortunes || []).slice(0, 20).forEach(function (entry) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var name = document.createElement('div'); name.className = 'q'; name.textContent = (entry.name || entry.memberOpenid) + ' · ' + (entry.date || '')
      var fortune = document.createElement('div'); fortune.className = 'a'; fortune.textContent = entry.fortune || ''
      main.appendChild(name); main.appendChild(fortune); div.appendChild(main); fortuneList.appendChild(div)
    })
    ;(state.pendingJoins || []).forEach(function (entry) {
      var memberId = entry.member_openid || entry.memberOpenid || ''
      var groupId = entry.group_openid || entry.groupOpenid || ''
      var applyAt = entry.apply_at || entry.applyAt || ''
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var name = document.createElement('div'); name.className = 'q'; name.textContent = entry.username || memberId
      var meta1 = document.createElement('div'); meta1.className = 'mono'; meta1.textContent = '成员 openid：' + memberId
      var meta2 = document.createElement('div'); meta2.className = 'mono'; meta2.textContent = applyAt ? '申请时间：' + applyAt : ''
      main.appendChild(name); main.appendChild(meta1); if (meta2.textContent) main.appendChild(meta2)
      var actions = document.createElement('div'); actions.className = 'item-actions'
      function decide(op) {
        post('/api/group-admin', { action: op, groupOpenid: groupId, memberOpenid: memberId, joinRequestId: entry.join_request_id || entry.joinRequestId || '', operator: $('operatorName').value.trim() || '管理员' })
          .then(function () { notice($('modNotice'), '已处理', 'ok') }).catch(function (e) { notice($('modNotice'), e.message, 'err') })
      }
      var ok = document.createElement('button'); ok.className = 'sm'; ok.textContent = '通过'; ok.onclick = function () { decide('approve') }
      var no = document.createElement('button'); no.className = 'sm danger'; no.textContent = '拒绝'; no.onclick = function () { decide('decline') }
      var rm = document.createElement('button'); rm.className = 'sm ghost'; rm.textContent = '移除'
      rm.onclick = function () { post('/api/group-admin', { action: 'forget', groupOpenid: groupId, memberOpenid: memberId }).then(function () { notice($('modNotice'), '已移除', 'ok') }).catch(function (e) { notice($('modNotice'), e.message, 'err') }) }
      actions.appendChild(ok); actions.appendChild(no); actions.appendChild(rm)
      div.appendChild(main); div.appendChild(actions); joins.appendChild(div)
    })

    if (state.moderation) {
      $('modEnabled').checked = state.moderation.enabled === true
      $('modWords').value = (state.moderation.words || []).join('\n')
      $('modGroups').value = (state.moderation.groups || []).join('\n')
      $('modMute').value = state.moderation.muteMinutes || 10
      $('modMuteAfter').value = state.moderation.muteAfter ?? 2
      $('modKickAfter').value = state.moderation.kickAfter ?? 3
      var strikes = $('strikeList'); strikes.innerHTML = ''
      ;(state.moderation.strikes || []).forEach(function (s) {
        var div = document.createElement('div'); div.className = 'item'
        var main = document.createElement('div'); main.className = 'item-main'
        var q = document.createElement('div'); q.className = 'q'; q.textContent = (s.name || s.memberOpenid) + ' · ' + s.count + ' 次'
        var meta = document.createElement('div'); meta.className = 'mono'; meta.textContent = s.key + ' · ' + (s.lastWord || '')
        main.appendChild(q); main.appendChild(meta)
        var actions = document.createElement('div'); actions.className = 'item-actions'
        var reset = document.createElement('button'); reset.className = 'sm ghost'; reset.textContent = '重置'
        reset.onclick = function () { post('/api/moderation', { action: 'reset', key: s.key }).then(function () { notice($('modNotice'), '已重置', 'ok') }).catch(function (e) { notice($('modNotice'), e.message, 'err') }) }
        actions.appendChild(reset); div.appendChild(main); div.appendChild(actions); strikes.appendChild(div)
      })
    }

    $('chatEnabled').checked = state.chat.enabled === true
    $('chatPersona').value = state.chat.persona || ''
    $('chatAgentPersona').value = state.chat.agentPersona || ''
    $('chatUseQa').checked = state.chat.useQa !== false
    if (state.welcome) {
      $('welcomeEnabled').checked = state.welcome.enabled === true
      $('welcomeText').value = state.welcome.text || ''
      $('welcomeGroups').value = (state.welcome.groups || []).join('\n')
      $('joinNoticeEnabled').checked = state.welcome.joinNoticeEnabled === true
      $('joinNoticeAvatar').checked = state.welcome.joinNoticeAvatar === true
    }

    var targetList = $('targetList'); targetList.innerHTML = ''
    state.targets.forEach(function (t) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var q = document.createElement('div'); q.className = 'q'; q.textContent = t.name + ' · ' + (t.scope === 'group' ? '群聊' : '私聊')
      var meta = document.createElement('div'); meta.className = 'mono'; meta.textContent = t.id + ' · ' + t.openid
      main.appendChild(q); main.appendChild(meta)
      var actions = document.createElement('div'); actions.className = 'item-actions'
      var del = document.createElement('button'); del.className = 'sm danger'; del.textContent = '删除'
      del.onclick = function () { post('/api/targets', { action: 'remove', id: t.id }).then(function () { notice($('targetNotice'), '已删除', 'ok') }).catch(function (e) { notice($('targetNotice'), e.message, 'err') }) }
      actions.appendChild(del); div.appendChild(main); div.appendChild(actions); targetList.appendChild(div)
    })

    var mentionList = $('mentionList'); mentionList.innerHTML = ''
    ;(state.blockedMentions || []).forEach(function (entry) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var q = document.createElement('div'); q.className = 'q'; q.textContent = entry.name || entry.memberOpenid
      var meta = document.createElement('div'); meta.className = 'mono'; meta.textContent = entry.groupOpenid + ' · ' + entry.memberOpenid
      main.appendChild(q); main.appendChild(meta)
      var actions = document.createElement('div'); actions.className = 'item-actions'
      var del = document.createElement('button'); del.className = 'sm danger'; del.textContent = '取消'
      del.onclick = function () { post('/api/blocklist', { action: 'remove-mention', groupOpenid: entry.groupOpenid, memberOpenid: entry.memberOpenid }).then(function () { notice($('mentionNotice'), '已取消', 'ok') }).catch(function (e) { notice($('mentionNotice'), e.message, 'err') }) }
      actions.appendChild(del); div.appendChild(main); div.appendChild(actions); mentionList.appendChild(div)
    })

    var blockGroup = $('blockGroup')
    var keepBlockGroup = blockGroup.value
    blockGroup.innerHTML = ''
    state.targets.filter(function (t) { return t.scope === 'group' }).forEach(function (t) { option(blockGroup, t.openid, t.name) })
    if (keepBlockGroup) blockGroup.value = keepBlockGroup

    var blockList = $('blockList'); blockList.innerHTML = ''
    ;(state.blockedMembers || []).forEach(function (entry) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var q = document.createElement('div'); q.className = 'q'; q.textContent = entry.name || entry.memberOpenid
      var meta = document.createElement('div'); meta.className = 'mono'; meta.textContent = entry.groupOpenid + ' · ' + entry.memberOpenid
      main.appendChild(q); main.appendChild(meta)
      var actions = document.createElement('div'); actions.className = 'item-actions'
      var del = document.createElement('button'); del.className = 'sm danger'; del.textContent = '取消'
      del.onclick = function () { post('/api/blocklist', { action: 'remove', groupOpenid: entry.groupOpenid, memberOpenid: entry.memberOpenid }).then(function () { notice($('blockNotice'), '已取消', 'ok') }).catch(function (e) { notice($('blockNotice'), e.message, 'err') }) }
      actions.appendChild(del); div.appendChild(main); div.appendChild(actions); blockList.appendChild(div)
    })

    var boardGroups = $('boardGroups'); boardGroups.innerHTML = ''
    state.targets.filter(function (t) { return t.scope === 'group' }).forEach(function (t) {
      var label = document.createElement('label'); label.className = 'row'
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.style.flex = '0 0 auto'; cb.checked = boardPick.indexOf(t.id) >= 0
      cb.onchange = function () {
        var i = boardPick.indexOf(t.id)
        if (i >= 0) boardPick.splice(i, 1)
        else if (boardPick.length < 3) boardPick.push(t.id)
        render()
      }
      var span = document.createElement('span'); span.textContent = t.name + '（' + t.openid.slice(-6) + '）'
      label.appendChild(cb); label.appendChild(span); boardGroups.appendChild(label)
    })

    var boardList = $('boardList'); boardList.innerHTML = ''
    ;(state.boards || []).forEach(function (b) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var q = document.createElement('div'); q.className = 'q'; q.textContent = b.name + ' · ' + b.count + ' 个群'
      var meta = document.createElement('div'); meta.className = 'mono'; meta.textContent = b.targets.map(function (t) { return t.name }).join(' / ')
      main.appendChild(q); main.appendChild(meta)
      var actions = document.createElement('div'); actions.className = 'item-actions'
      var del = document.createElement('button'); del.className = 'sm danger'; del.textContent = '删除'
      del.onclick = function () { post('/api/boards', { action: 'remove', id: b.id }).then(function () { notice($('boardNotice'), '已删除', 'ok') }).catch(function (e) { notice($('boardNotice'), e.message, 'err') }) }
      actions.appendChild(del); div.appendChild(main); div.appendChild(actions); boardList.appendChild(div)
    })

    $('remoteInfo').textContent = '远程服务：' + (state.remote ? (state.remote.running ? '运行中 · 端口 ' + state.remote.port : '未运行') : '未知') + ' · 回复日志：' + (state.replyLogPath || '')

    var paGroups = $('paGroups'); paGroups.innerHTML = ''
    state.targets.filter(function (t) { return t.scope === 'group' }).forEach(function (t) {
      var label = document.createElement('label'); label.className = 'row'
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.style.flex = '0 0 auto'; cb.checked = paPick.indexOf(t.openid) >= 0
      cb.onchange = function () {
        var i = paPick.indexOf(t.openid)
        if (i >= 0) paPick.splice(i, 1)
        else paPick.push(t.openid)
        render()
      }
      var span = document.createElement('span'); span.textContent = t.name
      label.appendChild(cb); label.appendChild(span); paGroups.appendChild(label)
    })

    var paList = $('paList'); paList.innerHTML = ''
    var pageAnns = (state.pageAnnouncements || []).slice().reverse()
    pageAnns.forEach(function (a) {
      var div = document.createElement('div'); div.className = 'item'
      var main = document.createElement('div'); main.className = 'item-main'
      var q = document.createElement('div'); q.className = 'q'
      q.textContent = (a.mode === 'always' ? '每次都显示' : '仅显示一次') + (a.active === false ? '（已停用）' : '') + ' · ' + new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false })
      var meta = document.createElement('div'); meta.className = 'mono'
      meta.textContent = (a.groups && a.groups.length > 0)
        ? a.groups.map(function (openid) { var t = state.targets.filter(function (x) { return x.openid === openid })[0]; return t ? t.name : openid }).join(' / ')
        : '所有分群网页'
      var body = document.createElement('div'); body.className = 'muted'; body.textContent = a.text
      main.appendChild(q); main.appendChild(meta); main.appendChild(body)
      var actions = document.createElement('div'); actions.className = 'item-actions'
      var toggle = document.createElement('button'); toggle.className = 'sm ghost'; toggle.textContent = a.active === false ? '启用' : '停用'
      toggle.onclick = function () { post('/api/pageAnnouncements', { action: 'toggle', id: a.id, active: a.active === false }).then(function () { notice($('paNotice'), '已更新', 'ok') }).catch(function (e) { notice($('paNotice'), e.message, 'err') }) }
      var del = document.createElement('button'); del.className = 'sm danger'; del.textContent = '删除'
      del.onclick = function () { post('/api/pageAnnouncements', { action: 'remove', id: a.id }).then(function () { notice($('paNotice'), '已删除', 'ok') }).catch(function (e) { notice($('paNotice'), e.message, 'err') }) }
      actions.appendChild(toggle); actions.appendChild(del); div.appendChild(main); div.appendChild(actions); paList.appendChild(div)
    })
  }

  async function sendText() {
    var text = $('text').value.trim(); if (!text) return
    $('sendBtn').disabled = true
    $('text').readOnly = true
    try {
      await post('/api/send', { targetId: $('target').value, text: text, mention: $('mention').value })
      $('text').value = ''; notice($('sendNotice'), '已发送。', 'ok')
    } catch (e) { notice($('sendNotice'), e.message, 'err') } finally { $('sendBtn').disabled = false; $('text').readOnly = false }
  }
  async function generate() {
    $('genBtn').disabled = true
    try {
      var data = await post('/api/generate', { targetId: $('target').value, topic: $('text').value.trim(), mention: $('mention').value })
      $('text').value = data.text || ''; notice($('sendNotice'), 'DeepSeek 写好了，可直接发。', 'ok')
    } catch (e) { notice($('sendNotice'), e.message, 'err') } finally { $('genBtn').disabled = false }
  }
  async function sendMedia() {
    if (!mediaFile) { notice($('sendNotice'), '先选本地文件', 'err'); return }
    $('mediaBtn').disabled = true
    try {
      await post('/api/media', { targetId: $('target').value, type: mediaFile.type, data: mediaFile.data, fileName: mediaFile.name, caption: $('mediaCaption').value, mention: $('mention').value })
      mediaFile = null; $('mediaHint').textContent = '未选择文件'; $('mediaCaption').value = ''
      notice($('sendNotice'), '媒体已发送。', 'ok')
    } catch (e) { notice($('sendNotice'), e.message, 'err') } finally { $('mediaBtn').disabled = false }
  }

  $('mediaFile').onchange = function (event) {
    var file = event.target.files && event.target.files[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { notice($('sendNotice'), '文件超过 5MB', 'err'); event.target.value = ''; return }
    var mime = file.type || ''
    var type = mime.indexOf('image/') === 0 ? 1 : mime.indexOf('video/') === 0 ? 2 : mime.indexOf('audio/') === 0 ? 3 : 4
    var reader = new FileReader()
    reader.onload = function () { mediaFile = { name: file.name, type: type, data: String(reader.result || '') }; $('mediaHint').textContent = '已选：' + file.name }
    reader.readAsDataURL(file)
  }

  $('loginBtn').onclick = function () {
    token = $('tokenInput').value.trim(); if (!token) return
    localStorage.setItem('qqf_remote_token', token); loadState(false)
  }
  $('logoutBtn').onclick = function () { localStorage.removeItem('qqf_remote_token'); token = ''; showLogin('') }
  $('refreshBtn').onclick = function () { loadState(true) }
  $('sendBtn').onclick = sendText
  $('genBtn').onclick = generate
  $('mediaBtn').onclick = sendMedia
  $('target').onchange = render

  $('autoSave').onclick = function () {
    post('/api/auto', { enabled: $('autoEnabled').checked, targetId: $('autoTarget').value, intervalMinutes: Number($('autoInterval').value), topics: $('autoTopics').value })
      .then(function () { notice($('autoNotice'), '已保存', 'ok') }).catch(function (e) { notice($('autoNotice'), e.message, 'err') })
  }
  $('autoNow').onclick = function () {
    $('autoNow').disabled = true
    post('/api/auto', { run: true }).then(function (d) { notice($('autoNotice'), d.text ? '已发：' + d.text : '已触发', 'ok') })
      .catch(function (e) { notice($('autoNotice'), e.message, 'err') })
      .then(function () { $('autoNow').disabled = false })
  }
  $('qaAdd').onclick = function () {
    post('/api/qa', { action: 'add', question: $('qaQuestion').value, answer: $('qaAnswer').value, keywords: $('qaKeywords').value })
      .then(function () { $('qaQuestion').value = ''; $('qaAnswer').value = ''; $('qaKeywords').value = ''; notice($('qaNotice'), '已添加', 'ok') })
      .catch(function (e) { notice($('qaNotice'), e.message, 'err') })
  }
  $('qaRefresh').onclick = function () { loadState(true) }
  $('joinsRefresh').onclick = function () {
    post('/api/group-admin', { action: 'list', groupOpenid: (state.targets.filter(function (t) { return t.scope === 'group' })[0] || {}).openid || '' })
      .then(function () { notice($('modNotice'), '已刷新', 'ok') }).catch(function (e) { notice($('modNotice'), e.message, 'err') })
  }
  $('muteBtn').onclick = function () { memberAction('mute') }
  $('unmuteBtn').onclick = function () { memberAction('unmute') }
  $('kickBtn').onclick = function () { memberAction('kick') }
  function memberAction(action) {
    var group = (state.targets.filter(function (t) { return t.scope === 'group' })[0] || {}).openid
    post('/api/group-admin', { action: action, groupOpenid: group, memberOpenid: $('memberOpenid').value.trim(), minutes: Number($('muteMinutes').value) })
      .then(function () { notice($('memberNotice'), '已执行', 'ok') }).catch(function (e) { notice($('memberNotice'), e.message, 'err') })
  }
  $('modSave').onclick = function () {
    post('/api/moderation', {
      action: 'save',
      enabled: $('modEnabled').checked,
      words: $('modWords').value,
      groups: $('modGroups').value,
      muteMinutes: Number($('modMute').value),
      muteAfter: Number($('modMuteAfter').value),
      kickAfter: Number($('modKickAfter').value),
    })
      .then(function () { notice($('modNotice'), '已保存', 'ok') }).catch(function (e) { notice($('modNotice'), e.message, 'err') })
  }
  $('strikesReset').onclick = function () {
    post('/api/moderation', { action: 'reset' }).then(function () { notice($('modNotice'), '已重置', 'ok') }).catch(function (e) { notice($('modNotice'), e.message, 'err') })
  }
  $('chatSave').onclick = function () {
    post('/api/channel', { enabled: $('chatEnabled').checked, confirm: true, persona: $('chatPersona').value, agentPersona: $('chatAgentPersona').value, useQa: $('chatUseQa').checked })
      .then(function () { notice($('chatNotice'), '已保存', 'ok') }).catch(function (e) { notice($('chatNotice'), e.message, 'err') })
  }
  $('welcomeSave').onclick = function () {
    post('/api/welcome', { enabled: $('welcomeEnabled').checked, text: $('welcomeText').value, groups: $('welcomeGroups').value, joinNoticeEnabled: $('joinNoticeEnabled').checked, joinNoticeAvatar: $('joinNoticeAvatar').checked })
      .then(function () { notice($('welcomeNotice'), '已保存', 'ok') }).catch(function (e) { notice($('welcomeNotice'), e.message, 'err') })
  }
  $('blockAdd').onclick = function () {
    post('/api/blocklist', { action: 'add', groupOpenid: $('blockGroup').value, memberOpenid: $('blockMember').value.trim(), name: $('blockName').value.trim() })
      .then(function () { $('blockMember').value = ''; $('blockName').value = ''; notice($('blockNotice'), '已屏蔽', 'ok') })
      .catch(function (e) { notice($('blockNotice'), e.message, 'err') })
  }

  $('mentionAdd').onclick = function () {
    post('/api/blocklist', { action: 'add-mention', groupOpenid: $('blockGroup').value, memberOpenid: $('mentionMember').value.trim(), name: $('mentionName').value.trim() })
      .then(function () { $('mentionMember').value = ''; $('mentionName').value = ''; notice($('mentionNotice'), '已屏蔽 @', 'ok') })
      .catch(function (e) { notice($('mentionNotice'), e.message, 'err') })
  }

  $('targetAdd').onclick = function () {
    post('/api/targets', { action: 'add', scope: $('targetScope').value, openid: $('targetOpenid').value.trim(), name: $('targetName').value.trim() })
      .then(function () { $('targetOpenid').value = ''; $('targetName').value = ''; notice($('targetNotice'), '已添加', 'ok') })
      .catch(function (e) { notice($('targetNotice'), e.message, 'err') })
  }
  $('boardAdd').onclick = function () {
    post('/api/boards', { action: 'add', name: $('boardName').value.trim(), targetIds: boardPick.slice(0, 3) })
      .then(function () { $('boardName').value = ''; boardPick = []; notice($('boardNotice'), '已添加', 'ok') })
      .catch(function (e) { notice($('boardNotice'), e.message, 'err') })
  }

  $('paPublish').onclick = function () {
    var text = $('paText').value.trim()
    if (!text) { notice($('paNotice'), '公告内容不能为空', 'err'); return }
    post('/api/pageAnnouncements', { action: 'add', text: text, mode: $('paMode').value, groups: paPick.slice() })
      .then(function () { $('paText').value = ''; paPick = []; notice($('paNotice'), '已发布到分群网页', 'ok') })
      .catch(function (e) { notice($('paNotice'), e.message, 'err') })
  }

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.onclick = function () {
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b === btn) })
      ;['send', 'auto', 'qa', 'manage', 'settings'].forEach(function (name) {
        $('pane-' + name).classList.toggle('hidden', name !== btn.dataset.tab)
      })
    }
  })

  var queryToken = new URLSearchParams(location.search).get('token')
  if (queryToken) { token = queryToken; localStorage.setItem('qqf_remote_token', token) }
  if (token) { loadState(false) } else { showLogin('') }
})()
</script>
</body>
</html>`
