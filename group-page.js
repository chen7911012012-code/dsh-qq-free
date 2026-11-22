/**
 * 分群网页：只操作指定群，具备发言、入群审批、成员管理、群设置、公告等管理能力。
 * 具体权限由主面板控制；主网页不受限制。
 *
 * @module @local/dsh-qq-free/group-page
 */

export function renderGroupPage(token) {
  const safe = String(token).replace(/[^A-Za-z0-9_-]/g, '')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>分群管理</title>
<style>
:root{color-scheme:light dark;--bg:#f4f6fb;--card:#fff;--text:#18202b;--muted:#6b7787;--line:#e4e8f0;--accent:#3b6ef6;--danger:#d94b4b;--ok:#1a9c68}
@media(prefers-color-scheme:dark){:root{--bg:#12161d;--card:#1c222b;--text:#eef2f7;--muted:#9aa7b6;--line:#2b3441}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 14px 60px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 10px}
.muted{color:var(--muted);font-size:13px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
input,textarea,select{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:transparent;color:inherit;font:inherit}
textarea{min-height:90px;resize:vertical}
button{padding:8px 13px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--line)}
button.danger{background:var(--danger)}
button.sm{padding:5px 9px;font-size:12px}
button:disabled{opacity:.55;cursor:not-allowed}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}
.list{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:8px}
.item{border:1px solid var(--line);border-radius:10px;padding:9px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
.notice{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);padding:10px 16px;border-radius:10px;background:#222c3a;color:#fff;display:none;max-width:90vw;z-index:9}
.badge{font-size:12px;padding:2px 8px;border-radius:99px;background:rgba(59,110,246,.13);color:var(--accent)}
.badge.off{background:rgba(217,75,75,.13);color:var(--danger)}
label.check{display:flex;gap:7px;align-items:center;font-size:13px}
label.check input{width:auto}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.tabs button{background:transparent;color:var(--muted);border:1px solid var(--line)}
.tabs button.on{background:var(--accent);color:#fff;border-color:var(--accent)}
section{display:none}section.on{display:block}
</style>
</head>
<body>
<main>
  <div class="card">
    <h1 id="groupName">分群管理</h1>
    <div class="muted" id="meta"></div>
    <div class="row" id="permBadges" style="margin-top:8px"></div>
  </div>
  <div class="tabs" id="tabs">
    <button data-tab="say" class="on">发言</button>
    <button data-tab="join">入群申请</button>
    <button data-tab="members">成员管理</button>
    <button data-tab="settings">群设置</button>
    <button data-tab="announce">定时公告</button>
  </div>
  <section id="tab-say" class="on">
    <div class="card">
      <h2>机器人发言</h2>
      <textarea id="sayText" placeholder="要发送到本群的内容…"></textarea>
      <div class="row" style="margin-top:8px"><button id="sayBtn">发送</button></div>
    </div>
    <div class="card">
      <h2>DeepSeek 代写</h2>
      <input id="topic" placeholder="输入主题，让 DeepSeek 写一句发到群里">
      <div class="row" style="margin-top:8px"><button id="genBtn">生成并发送</button></div>
    </div>
  </section>
  <section id="tab-join">
    <div class="card"><h2>入群申请</h2><ul class="list" id="joinList"></ul><p class="muted" id="joinEmpty">暂无待处理申请</p></div>
  </section>
  <section id="tab-members">
    <div class="card"><h2>已知成员</h2><ul class="list" id="memberList"></ul><p class="muted" id="memberEmpty">还没有成员记录</p></div>
  </section>
  <section id="tab-settings">
    <div class="card">
      <h2>群功能开关</h2>
      <div class="grid" id="featureGrid"></div>
      <div class="row" style="margin-top:10px"><button id="blockBtn">保存功能开关</button></div>
      <p class="muted">关闭「入群申请处理」后，本群不再记录/通知入群申请；关闭「入群人机验证」后，本群新成员不验证。</p>
    </div>
    <div class="card">
      <h2>入群欢迎</h2>
      <label class="check"><input type="checkbox" id="welcomeOn"> 启用本群欢迎</label>
      <textarea id="welcomeText" placeholder="欢迎语"></textarea>
      <div class="row" style="margin-top:8px"><button id="welcomeBtn">保存欢迎设置</button></div>
    </div>
    <div class="card">
      <h2>入群人机验证</h2>
      <label class="check"><input type="checkbox" id="verifyOn"> 在本群启用图片验证码验证</label>
      <div class="row" style="margin-top:8px"><button id="verifyBtn">保存验证开关</button><button class="ghost" id="cancelVerifyBtn">取消本次验证</button></div>
    </div>
    <div class="card">
      <h2>沉默低等级成员清理</h2>
      <label class="check"><input type="checkbox" id="cleanupOn"> 在本群启用</label>
      <div class="row" style="margin-top:8px">
        <input id="cleanupTime" type="time" style="max-width:150px">
        <input id="cleanupDays" type="number" min="1" placeholder="未发言天数" style="max-width:150px">
        <button id="cleanupBtn">保存清理设置</button>
      </div>
    </div>
    <div class="card">
      <h2>代管</h2>
      <div class="row"><input id="managerOpenid" placeholder="成员 member_openid"><input id="managerName" placeholder="备注" style="max-width:140px"><button id="managerAdd">添加代管</button></div>
      <ul class="list" id="managerList"></ul>
    </div>
    <div class="card">
      <h2>群信息</h2>
      <button class="ghost" id="infoBtn">获取群信息</button>
      <pre class="muted" id="infoText" style="white-space:pre-wrap"></pre>
    </div>
  </section>
  <section id="tab-announce">
    <div class="card">
      <h2>创建定时公告</h2>
      <input id="annName" placeholder="公告名称（可选）">
      <div class="row" style="margin-top:8px"><input id="annDate" type="date" style="max-width:170px"><input id="annTime" type="time" style="max-width:140px"></div>
      <textarea id="annText" placeholder="公告文字（会 @所有人）"></textarea>
      <div class="row" style="margin-top:8px"><button id="annSave">保存公告</button></div>
    </div>
    <div class="card"><h2>已有公告</h2><ul class="list" id="annList"></ul></div>
  </section>
</main>
<div class="notice" id="notice"></div>
<script>
const TOKEN = ${JSON.stringify(safe)};
const $ = (id) => document.getElementById(id);
let data = null;
function toast(message, ok) {
  const box = $('notice');
  box.textContent = message;
  box.style.background = ok ? '#1a9c68' : '#b83b3b';
  box.style.display = message ? 'block' : 'none';
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => { box.style.display = 'none'; }, 2600);
}
async function api(path, options) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options && options.headers ? options.headers : {}) } });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok || (body && body.ok === false)) {
    const error = new Error((body && body.error) || ('HTTP ' + response.status));
    error.status = response.status;
    throw error;
  }
  return body || {};
}
async function act(action, body) {
  try {
    const result = await api('/gapi/action?token=' + encodeURIComponent(TOKEN), { method: 'POST', body: JSON.stringify({ action, ...(body || {}) }) });
    await load();
    toast('操作成功', true);
    return result;
  } catch (error) {
    toast(error.status === 403 ? '你无权限' : error.message);
    return null;
  }
}
$('tabs').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) return;
  for (const item of document.querySelectorAll('#tabs button')) item.classList.toggle('on', item === button);
  for (const section of document.querySelectorAll('section')) section.classList.toggle('on', section.id === 'tab-' + button.dataset.tab);
});
const FEATURE_LABELS = { chat:'群聊回复', auto:'自动发言', welcome:'入群欢迎', joinNotice:'入群申请通知', joinRequest:'入群申请处理', joinVerify:'入群人机验证', commands:'群管理命令', moderation:'违禁词', info:'获取信息' };
function render() {
  $('groupName').textContent = data.group.name || '分群管理';
  $('meta').textContent = (data.expiresAt ? ('有效期至 ' + new Date(data.expiresAt).toLocaleString('zh-CN', { hour12:false })) : '长期有效');
  const p = data.permissions || {};
  $('permBadges').innerHTML = [
    ['say','发言',p.say],['joinApprove','审批',p.joinApprove],['memberManage','成员',p.memberManage],['settings','设置',p.settings],
  ].map(([key,label,on]) => '<span class="badge ' + (on ? '' : 'off') + '">' + label + (on ? ' 可用' : ' 无权限') + '</span>').join('');
  const joins = data.pendingJoins || [];
  $('joinList').innerHTML = joins.map((item) => '<li class="item"><div><div>' + (item.username || item.memberOpenid) + '</div><div class="muted">' + item.memberOpenid + '</div></div><div class="row"><button class="sm" data-join="approve" data-id="' + item.memberOpenid + '">同意</button><button class="sm danger" data-join="decline" data-id="' + item.memberOpenid + '">拒绝</button></div></li>').join('');
  $('joinEmpty').style.display = joins.length ? 'none' : 'block';
  const members = data.members || [];
  $('memberList').innerHTML = members.map((item) => '<li class="item"><div><div>' + (item.name || item.openid) + '</div><div class="muted">' + item.openid + ' · ' + (item.role || 'member') + '</div></div><div class="row"><button class="sm" data-mute="' + item.openid + '">禁言60分</button><button class="sm ghost" data-unmute="' + item.openid + '">解禁</button><button class="sm danger" data-kick="' + item.openid + '">踢人</button></div></li>').join('');
  $('memberEmpty').style.display = members.length ? 'none' : 'block';
  $('featureGrid').innerHTML = (data.features || []).map((key) => '<label class="check"><input type="checkbox" data-feature="' + key + '" ' + ((data.blocks?.features || []).includes(key) ? '' : 'checked') + '> ' + (FEATURE_LABELS[key] || key) + '</label>').join('') + '<label class="check"><input type="checkbox" data-feature="__all" ' + (data.blocks?.all ? 'checked' : '') + '> 全部屏蔽</label>';
  $('welcomeOn').checked = data.welcome?.enabled === true;
  $('welcomeText').value = data.welcome?.text || '';
  $('verifyOn').checked = data.joinVerify?.enabled === true;
  $('cleanupOn').checked = data.cleanup?.enabled === true;
  $('cleanupTime').value = data.cleanup?.time || '03:00';
  $('cleanupDays').value = data.cleanup?.days || 30;
  $('managerList').innerHTML = (data.managers || []).map((item) => '<li class="item"><div>' + (item.name || item.memberOpenid) + '<div class="muted">' + item.memberOpenid + '</div></div><button class="sm danger" data-manager-del="' + item.memberOpenid + '">取消</button></li>').join('');
  $('annList').innerHTML = (data.announcements || []).map((item) => '<li class="item"><div><div>' + (item.name || '公告') + ' · ' + (item.date || '每天') + ' ' + item.time + '</div><div class="muted">' + item.text + '</div></div><div class="row"><button class="sm" data-ann-run="' + item.id + '">立即发</button><button class="sm danger" data-ann-del="' + item.id + '">删除</button></div></li>').join('');
}
async function load() {
  try {
    data = await api('/gapi/overview?token=' + encodeURIComponent(TOKEN));
    render();
  } catch (error) {
    toast(error.message);
  }
}
$('sayBtn').onclick = async () => {
  const text = $('sayText').value.trim();
  if (!text) { toast('消息不能为空'); return; }
  const ok = await act('say', { text });
  if (ok) $('sayText').value = '';
};
$('genBtn').onclick = () => act('generate', { topic: $('topic').value });
$('joinList').onclick = (event) => {
  const button = event.target.closest('button[data-join]');
  if (!button) return;
  act('join-approve', { memberOpenid: button.dataset.id, approve: button.dataset.join === 'approve' });
};
$('memberList').onclick = (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.mute) act('mute', { memberOpenid: button.dataset.mute, minutes: 60 });
  if (button.dataset.unmute) act('unmute', { memberOpenid: button.dataset.unmute });
  if (button.dataset.kick) { if (confirm('确定踢出这个成员？')) act('kick', { memberOpenid: button.dataset.kick }); }
};
$('blockBtn').onclick = () => {
  const all = $('featureGrid').querySelector('[data-feature="__all"]').checked;
  const blocked = [...$('featureGrid').querySelectorAll('input[data-feature]:not([data-feature="__all"])')].filter((input) => !input.checked).map((input) => input.dataset.feature);
  act('save-blocks', { all, features: blocked });
};
$('welcomeBtn').onclick = () => act('welcome-save', { enabled: $('welcomeOn').checked, text: $('welcomeText').value });
$('verifyBtn').onclick = () => act('join-verify-save', { enabled: $('verifyOn').checked });
$('cancelVerifyBtn').onclick = () => act('join-verify-cancel', {});
$('cleanupBtn').onclick = () => act('cleanup-save', { enabled: $('cleanupOn').checked, time: $('cleanupTime').value, days: Number($('cleanupDays').value) || 30 });
$('managerAdd').onclick = () => act('manager-add', { memberOpenid: $('managerOpenid').value.trim(), name: $('managerName').value.trim() });
$('managerList').onclick = (event) => { const button = event.target.closest('button[data-manager-del]'); if (button) act('manager-remove', { memberOpenid: button.dataset.managerDel }); };
$('infoBtn').onclick = async () => { const result = await act('group-info', {}); if (result && result.text) $('infoText').textContent = result.text; };
$('annSave').onclick = () => act('announcement-save', { name: $('annName').value, date: $('annDate').value, time: $('annTime').value || '09:00', text: $('annText').value });
$('annList').onclick = (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.annRun) act('announcement-run', { id: button.dataset.annRun });
  if (button.dataset.annDel) act('announcement-remove', { id: button.dataset.annDel });
};
load();
</script>
</body>
</html>`
}
