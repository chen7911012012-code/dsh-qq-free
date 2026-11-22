/**
 * 分群网页：只允许操作一个指定群，权限和有效期由主面板控制。
 * 主网页（REMOTE_PAGE）完全不受这里的限制。
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
<title>分群控制台</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7fb;--card:#fff;--text:#1b2432;--muted:#6b7787;--line:#e3e8f0;--accent:#3b6ef6;--danger:#d94b4b}
@media(prefers-color-scheme:dark){:root{--bg:#14181f;--card:#1d232c;--text:#eef2f7;--muted:#9aa7b6;--line:#2b3441}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:620px;margin:0 auto;padding:24px 16px 48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 6px}.muted{color:var(--muted);font-size:13px}
textarea{width:100%;min-height:130px;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit;resize:vertical}
button{margin-top:12px;padding:11px 18px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
button:disabled{opacity:.55;cursor:not-allowed}
.notice{padding:10px 12px;border-radius:10px;background:rgba(217,75,75,.1);color:var(--danger);margin-top:12px;display:none;white-space:pre-wrap}
.notice.ok{background:rgba(59,110,246,.1);color:var(--accent)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.badge{font-size:12px;padding:2px 8px;border-radius:99px;background:rgba(59,110,246,.12);color:var(--accent)}
</style>
</head>
<body>
<main>
  <div class="card">
    <h1 id="groupName">加载中…</h1>
    <div class="muted" id="meta"></div>
  </div>
  <div class="card">
    <div class="row"><span class="badge" id="permBadge">权限</span><span class="muted" id="permText"></span></div>
    <textarea id="text" placeholder="输入要让机器人发送到本群的内容…"></textarea>
    <button id="sayBtn">机器人发言</button>
    <div class="notice" id="notice"></div>
  </div>
  <div class="muted">此页面只对本群生效；主控制台不受此页面权限限制。</div>
</main>
<script>
const TOKEN = ${JSON.stringify(safe)};
const $ = (id) => document.getElementById(id);
function show(message, ok) {
  const box = $('notice');
  box.textContent = message;
  box.className = ok ? 'notice ok' : 'notice';
  box.style.display = message ? 'block' : 'none';
}
async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options && options.headers ? options.headers : {}) },
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok || (data && data.ok === false)) {
    const error = new Error((data && data.error) || ('请求失败 HTTP ' + response.status));
    error.status = response.status;
    throw error;
  }
  return data || {};
}
async function load() {
  try {
    const data = await api('/gapi/state?token=' + encodeURIComponent(TOKEN));
    $('groupName').textContent = data.group && data.group.name ? data.group.name : '分群控制台';
    $('meta').textContent = data.expiresAt ? ('有效期至 ' + new Date(data.expiresAt).toLocaleString('zh-CN', { hour12: false })) : '长期有效';
    $('permText').textContent = data.permissions && data.permissions.say ? '可以管理机器人发言' : '没有机器人发言权限';
    $('permBadge').textContent = data.permissions && data.permissions.say ? '可发言' : '只读';
  } catch (error) {
    show(error.message);
    $('sayBtn').disabled = true;
  }
}
$('sayBtn').addEventListener('click', async () => {
  const text = $('text').value.trim();
  if (!text) { show('消息不能为空'); return; }
  $('sayBtn').disabled = true;
  show('');
  try {
    await api('/gapi/say?token=' + encodeURIComponent(TOKEN), { method: 'POST', body: JSON.stringify({ text }) });
    $('text').value = '';
    show('已发送', true);
  } catch (error) {
    show(error.status === 403 ? '你无权限' : error.message);
  } finally {
    $('sayBtn').disabled = false;
  }
});
load();
</script>
</body>
</html>`
}
