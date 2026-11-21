/**
 * QQ 官方机器人「自由发言台」——浏览器半边。
 *
 * 注册两个展示位：
 * - `main` 主面板（侧栏「QQ 自由发言」入口）
 * - `settings.section` 设置页栏目
 *
 * 所有数据走同源 HTTP 路由（/qq-free/*），由宿主插件提供；
 * 视觉全部使用宿主主题变量（--dsw-alias-*），不引入任何外部依赖。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-qq-free',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useCallback } = React

    const STYLE_ID = 'qq-free-panel-styles'
    const MAIN_PANEL_ID = 'qq-free'
    const PACKAGE_NAME = '@local/dsh-qq-free'

    const CSS = `
.qqf-page {
  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 40px;
  color: var(--dsw-alias-label-primary, #1f2329);
  background: transparent;
  font-size: 13px;
}
.qqf-wrap { max-width: 1120px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.qqf-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.qqf-title { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.3; }
.qqf-sub { margin: 6px 0 0; color: var(--dsw-alias-label-secondary, #646a73); line-height: 1.6; max-width: 46em; }
.qqf-note {
  margin: 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.65;
  color: var(--dsw-alias-label-secondary, #646a73);
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08));
  border-left: 3px solid var(--dsw-alias-state-warn-primary, #d29922);
}
.qqf-draft {
  display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 8px;
  border: 1px dashed var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06));
}
.qqf-draft-text { line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.qqf-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.qqf-badge {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  color: var(--dsw-alias-label-secondary, #646a73); font-size: 12px; white-space: nowrap;
}
.qqf-badge--on { color: var(--dsw-alias-state-success-primary, #2ea043); border-color: currentColor; }
.qqf-badge--warn { color: var(--dsw-alias-state-warn-primary, #d29922); border-color: currentColor; }
.qqf-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.qqf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 16px; align-items: start; }
.qqf-card {
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.04));
  border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;
}
.qqf-card--wide { grid-column: 1 / -1; }
.qqf-card-head { display: flex; flex-direction: column; gap: 4px; }
.qqf-card h3 { margin: 0; font-size: 14px; font-weight: 600; }
.qqf-hint { margin: 0; font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-tertiary, #8a9099); }
.qqf-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.qqf-grow { flex: 1 1 160px; min-width: 0; }
.qqf-field { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, #646a73); flex: 1 1 120px; min-width: 0; }
.qqf-field--full { flex-basis: 100%; }
.qqf-input, .qqf-select, .qqf-textarea {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary, inherit);
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06));
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  border-radius: 8px; padding: 7px 10px; outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.qqf-input:focus, .qqf-select:focus, .qqf-textarea:focus {
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary, #4d6bfe) 18%, transparent);
}
.qqf-textarea { resize: vertical; min-height: 76px; line-height: 1.6; }
.qqf-btn {
  font: inherit; font-size: 13px; cursor: pointer; padding: 7px 14px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.4));
  background: transparent; color: inherit; white-space: nowrap;
  transition: background-color .15s ease, opacity .15s ease, border-color .15s ease;
}
.qqf-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.12)); }
.qqf-btn:disabled { opacity: .5; cursor: default; }
.qqf-btn--primary { background: var(--dsw-alias-brand-primary, #4d6bfe); border-color: transparent; color: var(--dsw-alias-label-on-color, #fff); font-weight: 500; }
.qqf-btn--primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-fill-hover, #3b5cf0); }
.qqf-btn--danger { color: var(--dsw-alias-state-error-primary, #f26d6d); border-color: currentColor; }
.qqf-btn--sm { padding: 4px 10px; font-size: 12px; }
.qqf-link { border: none; background: none; padding: 0; font: inherit; font-size: 12px; color: var(--dsw-alias-brand-primary, #4d6bfe); cursor: pointer; }
.qqf-answer {
  display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22));
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.06));
}
.qqf-answer-text { margin: 0; line-height: 1.7; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.qqf-qa-list {
  list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;
  max-height: 360px; overflow: auto;
}
.qqf-qa-item {
  display: flex; justify-content: space-between; gap: 12px; align-items: flex-start;
  padding: 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22)); border-radius: 8px;
}
.qqf-qa-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.qqf-qa-q { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.qqf-qa-a {
  color: var(--dsw-alias-label-secondary, #646a73); line-height: 1.6;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
  white-space: pre-wrap; word-break: break-word;
}
.qqf-targets { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }.qqf-target {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.22));
  border-radius: 8px; padding: 8px 10px; font-size: 13px; min-width: 0;
}
.qqf-target-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.qqf-target-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qqf-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a9099); overflow: hidden; text-overflow: ellipsis; }
.qqf-chat { display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow: auto; padding: 2px; }
.qqf-chat-empty { color: var(--dsw-alias-label-tertiary, #8a9099); font-size: 12px; }
.qqf-msg {
  max-width: 86%; padding: 8px 10px; border-radius: 10px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; font-size: 13px;
}
.qqf-msg--user { align-self: flex-end; background: var(--dsw-alias-brand-primary, #4d6bfe); color: var(--dsw-alias-label-on-color, #fff); }
.qqf-msg--assistant { align-self: flex-start; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.08)); }
.qqf-log-wrap { overflow: auto; max-height: 320px; }
.qqf-log { width: 100%; border-collapse: collapse; font-size: 12px; }
.qqf-log th, .qqf-log td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.18)); vertical-align: top; }
.qqf-log th { color: var(--dsw-alias-label-secondary, #646a73); font-weight: 500; white-space: nowrap; }
.qqf-log td.qqf-log-text { word-break: break-word; }
.qqf-ok { color: var(--dsw-alias-state-success-primary, #2ea043); }
.qqf-fail { color: var(--dsw-alias-state-error-primary, #f26d6d); }
.qqf-notice {
  border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.6;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.35));
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,128,.05));
}
.qqf-notice--error { color: var(--dsw-alias-state-error-primary, #f26d6d); border-color: currentColor; }
.qqf-notice--ok { color: var(--dsw-alias-state-success-primary, #2ea043); border-color: currentColor; }
.qqf-empty { color: var(--dsw-alias-label-tertiary, #8a9099); font-size: 13px; padding: 12px 0; }
.qqf-split { height: 1px; background: var(--dsw-alias-border-l1, rgba(128,128,128,.18)); }
@media (max-width: 560px) {
  .qqf-page { padding: 16px 12px 32px; }
  .qqf-card { padding: 12px; }
}
`

    /** 同源 JSON 请求。 */
    async function request(path, body) {
      const init = body === undefined
        ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      const response = await fetch(path, init)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || `请求失败（HTTP ${response.status}）`)
      }
      return data
    }

    function useSnapshot() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const load = useCallback(async () => {
        try {
          const next = await request('/qq-free/state')
          setData(next)
          setError('')
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }, [])
      useEffect(() => {
        let stopped = false
        const tick = () => { if (!stopped) void load() }
        tick()
        const timer = setInterval(tick, 6000)
        return () => { stopped = true; clearInterval(timer) }
      }, [load])
      return { data, error, reload: load, setData }
    }

    function Badge({ tone, children }) {
      const className = `qqf-badge${tone ? ` qqf-badge--${tone}` : ''}`
      return h('span', { className }, h('span', { className: 'qqf-dot' }), children)
    }

    function Card({ title, hint, wide, children, actions }) {
      return h('section', { className: `qqf-card${wide ? ' qqf-card--wide' : ''}` },
        h('div', { className: 'qqf-card-head' },
          h('div', { className: 'qqf-row' }, h('h3', { className: 'qqf-grow' }, title), actions),
          hint ? h('p', { className: 'qqf-hint' }, hint) : null),
        children)
    }

    function TargetSelect({ targets, boards, value, onChange, ariaLabel }) {
      return h('select', {
        className: 'qqf-select qqf-grow',
        'aria-label': ariaLabel || '选择会话目标',
        value: value || '',
        onChange: (event) => onChange(event.target.value),
      },
        h('option', { value: '' }, targets.length === 0 && (boards?.length ?? 0) === 0 ? '（还没有会话目标）' : '选择会话目标…'),
        targets.map((target) => h('option', { key: target.id, value: target.id },
          `${target.name} · ${target.scope === 'group' ? '群聊' : '私聊'} · ${target.openid.slice(0, 6)}…${target.openid.slice(-4)}`)),
        (boards ?? []).map((board) => h('option', { key: board.id, value: board.id },
          `板块：${board.name}（${board.count} 个群）`)))
    }

    function Panel() {
      const { data, error, reload, setData } = useSnapshot()
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState('')
      const [form, setForm] = useState(null)
      const [autoForm, setAutoForm] = useState(null)
      const [targetForm, setTargetForm] = useState({ scope: 'group', openid: '', name: '' })
      const [targetId, setTargetId] = useState('')
      const [mentionOpenid, setMentionOpenid] = useState('')
      const [text, setText] = useState('')
      const [draft, setDraft] = useState('')
      const [topic, setTopic] = useState('')
      const [chatInput, setChatInput] = useState('')
      const [chat, setChat] = useState([])
      const [qa, setQa] = useState({ entries: [], stats: { count: 0, hits: 0, threshold: 0.45 } })
      const [qaQuestion, setQaQuestion] = useState('')
      const [qaAnswer, setQaAnswer] = useState('')
      const [qaKeywords, setQaKeywords] = useState('')
      const [qaEditingId, setQaEditingId] = useState('')
      const [qaAsk, setQaAsk] = useState('')
      const [qaResult, setQaResult] = useState(null)
      const [channelPersona, setChannelPersona] = useState(null)
      const [channelAgentPersona, setChannelAgentPersona] = useState(null)
      const [channelArmed, setChannelArmed] = useState(false)
      const [channelUseQa, setChannelUseQa] = useState(null)
      const [remoteForm, setRemoteForm] = useState(null)
      const [boardName, setBoardName] = useState('')
      const [boardTargetIds, setBoardTargetIds] = useState([])
      const [modForm, setModForm] = useState(null)
      const [cloudForm, setCloudForm] = useState(null)
      const [githubForm, setGithubForm] = useState(null)
      const [updateInfo, setUpdateInfo] = useState(null)
      const [blockGroup, setBlockGroup] = useState('')
      const [blockMember, setBlockMember] = useState('')
      const [blockName, setBlockName] = useState('')
      const [gbGroup, setGbGroup] = useState('')
      const [gbAll, setGbAll] = useState(false)
      const [gbFeatures, setGbFeatures] = useState([])
      const [annForm, setAnnForm] = useState({ name: '', groups: [], date: '', time: '09:00', text: '', enabled: true })
      const [annImage, setAnnImage] = useState(null)
      const [ownerId, setOwnerId] = useState(null)
      const [gmGroup, setGmGroup] = useState('')
      const [gmMember, setGmMember] = useState('')
      const [gmName, setGmName] = useState('')
      const [groupInfo, setGroupInfo] = useState('')
      const [jvEnabled, setJvEnabled] = useState(null)
      const [jvGroups, setJvGroups] = useState([])
      const [mentionMember, setMentionMember] = useState('')
      const [mentionName, setMentionName] = useState('')
      const [welcomeForm, setWelcomeForm] = useState(null)
      const [adminGroup, setAdminGroup] = useState('')
      const [joins, setJoins] = useState([])
      const [memberOpenid, setMemberOpenid] = useState('')
      const [muteMinutes, setMuteMinutes] = useState(60)
      const [joinBlacklist, setJoinBlacklist] = useState(false)
      const [kickArmed, setKickArmed] = useState(false)
      const [operatorName, setOperatorName] = useState('管理员')
      const [mediaFile, setMediaFile] = useState(null)
      const [mediaCaption, setMediaCaption] = useState('')
      const [replyLogFile, setReplyLogFile] = useState(null)
      const noticeTimer = useRef(null)

      const flash = useCallback((kind, message) => {
        setNotice({ kind, message })
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(null), 7000)
      }, [])

      useEffect(() => () => { if (noticeTimer.current !== null) clearTimeout(noticeTimer.current) }, [])

      const loadQa = useCallback(async () => {
        try {
          const result = await request('/qq-free/qa')
          setQa({ entries: result.entries, stats: result.stats })
        } catch {
          // 旧版本插件没有问答路由时保持沉默
        }
      }, [])

      useEffect(() => { void loadQa() }, [loadQa])
      useEffect(() => { void loadQa() }, [data?.qa?.count, data?.qa?.hits, loadQa])

      useEffect(() => {
        if (data === null) return
        if (form === null) {
          setForm({
            appId: data.credential.appId || '',
            appSecret: '',
            provider: data.model.provider || '',
            model: data.model.model || '',
            persona: data.persona || '',
            dailyLimit: data.limits.dailyLimit,
            quietHoursStart: data.limits.quietHoursStart,
            quietHoursEnd: data.limits.quietHoursEnd,
          })
        }
        if (autoForm === null) {
          setAutoForm({
            enabled: data.auto.enabled,
            targetId: data.auto.targetId || '',
            intervalMinutes: data.auto.intervalMinutes || 120,
            topics: data.auto.topics || '',
          })
        }
        if (channelPersona === null) setChannelPersona(data.chat?.persona || '')
        if (channelAgentPersona === null) setChannelAgentPersona(data.chat?.agentPersona || '')
        if (data.chat && channelUseQa === null) setChannelUseQa(data.chat.useQa === true)
        if (remoteForm === null && data.remote) {
          setRemoteForm({
            enabled: data.remote.enabled === true,
            port: data.remote.port || 8788,
            token: data.remote.token || '',
            tunnelEnabled: data.remote.tunnel?.enabled === true,
          })
        }
        if (modForm === null && data.moderation) {
          setModForm({
            enabled: data.moderation.enabled === true,
            words: (data.moderation.words || []).join('\n'),
            groups: (data.moderation.groups || []).join('\n'),
            muteMinutes: data.moderation.muteMinutes || 10,
          })
        }
        if (cloudForm === null && data.cloud) {
          setCloudForm({
            enabled: data.cloud.enabled === true,
            url: data.cloud.url || '',
            user: data.cloud.user || '',
            password: '',
            auto: data.cloud.auto === true,
          })
        }
        if (ownerId === null) setOwnerId(data.ownerOpenid || '')
        if (jvEnabled === null && data.joinVerify) {
          setJvEnabled(data.joinVerify.enabled === true)
          setJvGroups(Array.isArray(data.joinVerify.groups) ? data.joinVerify.groups : [])
        }
        if (githubForm === null && data.github) {          setGithubForm({
            enabled: data.github.enabled === true,
            owner: data.github.owner || 'chen7911012012-code',
            repo: data.github.repo || 'dsh-qq-free',
            token: '',
            auto: data.github.auto === true,
          })
        }
        if (welcomeForm === null && data.welcome) {
          setWelcomeForm({
            enabled: data.welcome.enabled === true,
            text: data.welcome.text || '',
            groups: (data.welcome.groups || []).join('\n'),
            joinNotice: data.welcome.joinNoticeEnabled !== false,
            joinAvatar: data.welcome.joinNoticeAvatar !== false,
          })
        }
        if (adminGroup === '') {
          const firstGroup = (data.targets || []).find((target) => target.scope === 'group')
          if (firstGroup) setAdminGroup(firstGroup.openid)
        }
        if (replyLogFile === null) setReplyLogFile(data.replyLogFile || 'qq-replies.md')
      }, [data, form, autoForm, channelPersona, welcomeForm, adminGroup, replyLogFile])

      useEffect(() => {
        if (data === null || autoForm === null) return
        if (autoForm.targetId === '' || data.targets.some((target) => target.id === autoForm.targetId)) return
        setAutoForm({ ...autoForm, targetId: '' })
      }, [data, autoForm])

      useEffect(() => {
        if (data === null) return
        if (targetId !== '' && data.targets.some((target) => target.id === targetId)) return
        const preferred = data.targets.find((target) => target.id === data.auto.targetId)
          ?? data.targets.find((target) => target.id === data.defaultTarget)
          ?? data.targets[0]
          ?? null
        setTargetId(preferred === null ? '' : preferred.id)
      }, [data, targetId])

      useEffect(() => {
        setMentionOpenid('')
      }, [targetId])

      async function run(key, action) {
        setBusy(key)
        try {
          const result = await action()
          if (result && result.state) setData(result.state)
          return result
        } catch (err) {
          flash('error', err instanceof Error ? err.message : String(err))
          return null
        } finally {
          setBusy('')
        }
      }

      if (error !== '' && data === null) {
        return h('div', { className: 'qqf-page' }, h('style', null, CSS),
          h('div', { className: 'qqf-wrap' },
            h('div', { className: 'qqf-notice qqf-notice--error' }, `读取插件状态失败：${error}`),
            h('p', { className: 'qqf-hint' }, '如果插件刚安装，稍等几秒后点下面的按钮重试。'),
            h('div', { className: 'qqf-row' }, h('button', { className: 'qqf-btn qqf-btn--primary', onClick: () => void reload() }, '重试'))))
      }

      if (data === null) {
        return h('div', { className: 'qqf-page' }, h('style', null, CSS), h('div', { className: 'qqf-wrap' }, h('div', { className: 'qqf-empty' }, '正在载入…')))
      }

      const targets = data.targets
      const providers = Array.isArray(data.model.providers) ? data.model.providers : []
      const providerOptions = form !== null && form.provider !== '' && !providers.some((provider) => provider.id === form.provider)
        ? [...providers, { id: form.provider, name: form.provider }]
        : providers
      const currentTarget = targets.find((target) => target.id === targetId) ?? null
      const usedToday = currentTarget === null ? 0 : (data.usage.find((item) => item.key === `${currentTarget.scope}:${currentTarget.openid}`)?.used ?? 0)
      const remaining = Math.max(0, data.limits.dailyLimit - usedToday)
      const credentialTone = data.credential.configured ? 'on' : 'warn'
      const modelTone = data.model.available ? 'on' : 'warn'
      const chatState = data.chat ?? { enabled: false, state: 'stopped' }
      const groupTargets = targets.filter((target) => target.scope === 'group')
      const groupMembers = (data.members ?? []).filter((member) => member.groupOpenid === (currentTarget?.openid ?? ''))
      const pendingJoins = (joins.length > 0 ? joins : (data.pendingJoins ?? [])).map((item) => ({
        group_openid: item.group_openid ?? item.groupOpenid ?? adminGroup,
        member_openid: item.member_openid ?? item.memberOpenid ?? '',
        join_request_id: item.join_request_id ?? item.joinRequestId ?? '',
        username: item.username ?? '',
        apply_at: item.apply_at ?? item.applyAt ?? '',
        risk_tips: item.risk_tips ?? item.riskTips ?? '',
      }))
      const creatorCard = (props, ...children) => data.creator === true ? h(Card, props, ...children) : null
      const chatTone = chatState.enabled
        ? chatState.state === 'connected' ? 'on' : 'warn'
        : undefined
      const chatLabel = chatState.enabled !== true
        ? '通道未启用'
        : chatState.state === 'connected'
          ? '通道已连接'
          : chatState.state === 'connecting'
            ? '正在连接…'
            : chatState.state === 'error'
              ? '连接失败'
              : '通道已停止'

      async function saveConfig() {
        if (form === null) return
        const payload = {
          provider: form.provider.trim(),
          model: form.model.trim(),
          persona: form.persona,
          dailyLimit: Number(form.dailyLimit),
          quietHoursStart: form.quietHoursStart,
          quietHoursEnd: form.quietHoursEnd,
        }
        if (form.appId.trim() !== '') payload.appId = form.appId.trim()
        if (form.appSecret.trim() !== '') payload.appSecret = form.appSecret.trim()
        const result = await run('config', () => request('/qq-free/config', payload))
        if (result !== null) {
          setForm({ ...form, appSecret: '' })
          flash('ok', '设置已保存，立即生效。')
        }
      }

      async function addTarget() {
        const result = await run('target', () => request('/qq-free/targets', {
          action: 'add',
          scope: targetForm.scope,
          openid: targetForm.openid.trim(),
          name: targetForm.name.trim(),
        }))
        if (result !== null) {
          setTargetForm({ scope: 'group', openid: '', name: '' })
          flash('ok', '会话目标已添加。')
        }
      }

      async function removeTarget(target) {
        const result = await run(`remove-${target.id}`, () => request('/qq-free/targets', { action: 'remove', id: target.id }))
        if (result !== null) flash('ok', '已移除。')
      }

      async function sendNow() {
        const result = await run('send', () => request('/qq-free/send', { targetId, text, mention: mentionOpenid.trim() }))
        if (result !== null) {
          setText('')
          flash('ok', `已发送到 QQ${result.messageId ? `（消息 ${result.messageId}）` : ''}。`)
        }
      }

      async function generate(send) {
        const source = topic.trim() !== '' ? topic.trim() : text.trim()
        const result = await run(send ? 'generate-send' : 'generate', () => request('/qq-free/generate', { topic: source, targetId, send, mention: mentionOpenid.trim() }))
        if (result === null) return
        if (result.sent === true) {
          flash('ok', `DeepSeek 已直接说了一句：${result.text}`)
          return
        }
        if (text.trim() === '') {
          setText(result.text)
          flash('ok', 'DeepSeek 写好了一句，已填进输入框，可以改完再发。')
          return
        }
        setDraft(result.text)
        flash('ok', 'DeepSeek 写好了，在输入框下方可以选用。')
      }

      async function saveAuto() {
        const result = await run('auto', () => request('/qq-free/auto', {
          enabled: autoForm.enabled,
          targetId: autoForm.targetId || targetId,
          intervalMinutes: Number(autoForm.intervalMinutes),
          topics: autoForm.topics,
        }))
        if (result !== null) flash('ok', '自动发言设置已保存。')
      }

      async function runAutoNow() {
        const result = await run('auto-now', () => request('/qq-free/auto', { runNow: true }))
        if (result !== null) flash('ok', `机器人在群里说：${result.text}`)
      }

      async function importTargets() {
        const result = await run('import', () => request('/qq-free/import', {}))
        if (result !== null) flash('ok', `导入完成：新增 ${result.imported} 个会话目标。`)
      }

      async function sendChat() {
        const question = chatInput.trim()
        if (question === '') return
        const nextChat = [...chat, { role: 'user', text: question }]
        setChat(nextChat)
        setChatInput('')
        const result = await run('chat', () => request('/qq-free/chat', { messages: nextChat }))
        if (result !== null) setChat([...nextChat, { role: 'assistant', text: result.text }])
      }

      function resetQaForm() {
        setQaQuestion('')
        setQaAnswer('')
        setQaKeywords('')
        setQaEditingId('')
      }

      async function saveQaEntry() {
        const result = await run('qa-save', () => request('/qq-free/qa', {
          action: qaEditingId === '' ? 'add' : 'update',
          id: qaEditingId === '' ? undefined : qaEditingId,
          question: qaQuestion,
          answer: qaAnswer,
          keywords: qaKeywords,
        }))
        if (result === null) return
        flash('ok', result.updated ? '问答已更新。' : '问答已添加。')
        resetQaForm()
        void loadQa()
      }

      async function removeQa(id) {
        const result = await run(`qa-remove-${id}`, () => request('/qq-free/qa', { action: 'remove', id }))
        if (result === null) return
        flash('ok', '问答已删除。')
        void loadQa()
      }

      function startEditQa(entry) {
        setQaEditingId(entry.id)
        setQaQuestion(entry.question)
        setQaAnswer(entry.answer)
        setQaKeywords(entry.keywords.join('，'))
      }

      async function askQa(fallback) {
        const question = qaAsk.trim()
        if (question === '') return
        const result = await run(fallback ? 'qa-deepseek' : 'qa-lookup', () => request('/qq-free/qa/lookup', { question, fallback }))
        if (result !== null) {
          setQaResult(result)
          void loadQa()
        }
      }

      async function sendQaAnswer() {
        if (qaResult === null || qaResult.answer === '') return
        const result = await run('qa-send', () => request('/qq-free/send', { targetId, text: qaResult.answer }))
        if (result !== null) flash('ok', '问答答案已发到 QQ。')
      }

      async function toggleChannel() {
        const enabling = data?.chat?.enabled !== true
        if (enabling && !channelArmed) {
          setChannelArmed(true)
          return
        }
        const result = await run('channel', () => request('/qq-free/channel', {
          enabled: enabling,
          confirm: true,
          persona: channelPersona ?? '',
        }))
        if (result === null) return
        setChannelArmed(false)
        flash('ok', enabling ? 'QQ AI 对话通道已启动。' : 'QQ AI 对话通道已停止。')
      }

      async function saveChannelPersona() {
        const result = await run('channel-persona', () => request('/qq-free/channel', {
          enabled: data?.chat?.enabled === true,
          confirm: true,
          persona: channelPersona ?? '',
          agentPersona: channelAgentPersona ?? '',
          useQa: channelUseQa !== false,
        }))
        if (result !== null) flash('ok', '对话设置已保存。')
      }

      async function saveRemote(regenerate) {
        if (remoteForm === null) return
        const result = await run(regenerate ? 'remote-regen' : 'remote', () => request('/qq-free/remote', {
          enabled: remoteForm.enabled,
          port: Number(remoteForm.port) || 8788,
          token: remoteForm.token,
          tunnelEnabled: remoteForm.tunnelEnabled === true,
          ...(regenerate ? { regenerate: true } : {}),
        }))
        if (result !== null) {
          const remote = result.state?.remote
          if (remote) {
            setRemoteForm({ enabled: remote.enabled, port: remote.port, token: remote.token })
          }
          flash('ok', regenerate ? '已生成新 token。' : '远程发言设置已保存。')
        }
      }

      async function addBoard() {
        if (boardName.trim() === '' || boardTargetIds.length === 0) return
        const result = await run('board', () => request('/qq-free/boards', {
          action: 'add',
          name: boardName.trim(),
          targetIds: boardTargetIds,
        }))
        if (result !== null) {
          setBoardName('')
          setBoardTargetIds([])
          flash('ok', '板块已添加。')
        }
      }

      async function removeBoard(board) {
        const result = await run(`board-${board.id}`, () => request('/qq-free/boards', { action: 'remove', id: board.id }))
        if (result !== null) flash('ok', '板块已删除。')
      }

      function toggleBoardTarget(id) {
        setBoardTargetIds((current) => current.includes(id)
          ? current.filter((item) => item !== id)
          : current.length >= 3 ? current : [...current, id])
      }

      async function saveModeration() {
        if (modForm === null) return
        const result = await run('moderation', () => request('/qq-free/config', {
          moderationEnabled: modForm.enabled,
          bannedWords: modForm.words.split(/[\n,，、]+/).map((word) => word.trim()).filter(Boolean),
          moderationGroups: modForm.groups.split(/[\n,，、\s]+/).map((group) => group.trim()).filter(Boolean),
          moderationMuteMinutes: Number(modForm.muteMinutes) || 10,
        }))
        if (result !== null) flash('ok', '违禁词设置已保存。')
      }

      async function resetStrikes(key) {
        const result = await run('strikes', () => request('/qq-free/moderation', { action: 'reset', ...(key ? { key } : {}) }))
        if (result !== null) flash('ok', '违规次数已重置。')
      }

      async function addBlock() {
        if (blockGroup === '' || blockMember.trim() === '') return
        const result = await run('block', () => request('/qq-free/blocklist', {
          action: 'add',
          groupOpenid: blockGroup,
          memberOpenid: blockMember.trim(),
          name: blockName.trim(),
        }))
        if (result !== null) {
          setBlockMember('')
          setBlockName('')
          flash('ok', '已屏蔽该成员。')
        }
      }

      async function removeBlock(entry) {
        const result = await run(`block-${entry.memberOpenid}`, () => request('/qq-free/blocklist', {
          action: 'remove',
          groupOpenid: entry.groupOpenid,
          memberOpenid: entry.memberOpenid,
        }))
        if (result !== null) flash('ok', '已取消屏蔽。')
      }

      async function addMentionBlock() {
        if (blockGroup === '' || mentionMember.trim() === '') return
        const result = await run('mention-block', () => request('/qq-free/blocklist', {
          action: 'add-mention',
          groupOpenid: blockGroup,
          memberOpenid: mentionMember.trim(),
          name: mentionName.trim(),
        }))
        if (result !== null) {
          setMentionMember('')
          setMentionName('')
          flash('ok', '已屏蔽 @ 该成员的消息。')
        }
      }

      async function removeMentionBlock(entry) {
        const result = await run(`mention-block-${entry.memberOpenid}`, () => request('/qq-free/blocklist', {
          action: 'remove-mention',
          groupOpenid: entry.groupOpenid,
          memberOpenid: entry.memberOpenid,
        }))
        if (result !== null) flash('ok', '已取消 @ 屏蔽。')
      }

      async function saveGroupBlock() {
        if (gbGroup === '') return
        const result = await run('group-block', () => request('/qq-free/group-blocks', {
          action: 'save',
          groupOpenid: gbGroup,
          all: gbAll,
          features: gbFeatures,
        }))
        if (result !== null) flash('ok', '群功能屏蔽已保存。')
      }

      async function removeGroupBlock(entry) {
        const result = await run(`group-block-${entry.groupOpenid}`, () => request('/qq-free/group-blocks', {
          action: 'remove',
          groupOpenid: entry.groupOpenid,
        }))
        if (result !== null) flash('ok', '已取消该群屏蔽。')
      }

      async function saveAnnouncement() {
        const result = await run('announcement', () => request('/qq-free/announcements', {
          action: 'save',
          name: annForm.name,
          groupOpenids: annForm.groups,
          date: annForm.date,
          time: annForm.time,
          text: annForm.text,
          enabled: annForm.enabled,
          ...(annImage ? { imageData: annImage.data, imageName: annImage.name } : {}),
        }))
        if (result !== null) {
          setAnnImage(null)
          flash('ok', '定时群公告已保存。')
        }
      }

      async function removeAnnouncement(entry) {
        const result = await run(`announcement-${entry.id}`, () => request('/qq-free/announcements', {
          action: 'remove',
          id: entry.id,
        }))
        if (result !== null) flash('ok', '已删除群公告。')
      }

      async function runAnnouncement(entry) {
        const result = await run(`announcement-run-${entry.id}`, () => request('/qq-free/announcements', {
          action: 'run',
          id: entry.id,
        }))
        if (result !== null) {
          const failed = (result.results ?? []).filter((item) => item.ok !== true)
          flash(failed.length > 0 ? 'error' : 'ok', failed.length > 0 ? failed[0].error : '已立即发送。')
        }
      }

      async function saveOwner() {
        const result = await run('owner', () => request('/qq-free/owner', { ownerOpenid: (ownerId ?? '').trim() }))
        if (result !== null) flash('ok', '主人已保存。')
      }

      async function addGroupManager() {
        if (gmGroup === '' || gmMember.trim() === '') return
        const result = await run('group-manager', () => request('/qq-free/group-managers', {
          action: 'save',
          groupOpenid: gmGroup,
          memberOpenid: gmMember.trim(),
          name: gmName.trim(),
        }))
        if (result !== null) {
          setGmMember('')
          setGmName('')
          flash('ok', '已添加代管。')
        }
      }

      async function removeGroupManager(entry) {
        const result = await run(`group-manager-${entry.memberOpenid}`, () => request('/qq-free/group-managers', {
          action: 'remove',
          groupOpenid: entry.groupOpenid,
          memberOpenid: entry.memberOpenid,
        }))
        if (result !== null) flash('ok', '已取消代管。')
      }

      async function fetchGroupInfo(groupOpenid) {
        if (groupOpenid === '') return
        const result = await run('group-info', () => request('/qq-free/group-info', { groupOpenid }))
        if (result !== null) setGroupInfo(result.text || '')
      }

      async function saveJoinVerify() {
        const result = await run('join-verify', () => request('/qq-free/config', {
          joinVerifyEnabled: jvEnabled === true,
          joinVerifyGroups: jvGroups,
        }))
        if (result !== null) flash('ok', '入群验证设置已保存。')
      }

      async function cloudAction(action) {
        const result = await run(`cloud-${action}`, () => request('/qq-free/cloud', action === 'save' ? {
          action: 'save',
          enabled: cloudForm?.enabled === true,
          url: cloudForm?.url ?? '',
          user: cloudForm?.user ?? '',
          password: cloudForm?.password ?? '',
          auto: cloudForm?.auto !== false,
        } : { action }))
        if (result !== null) {
          const message = action === 'push' ? `已上传 ${result.result?.files ?? 0} 个文件`
            : action === 'pull' ? `已从云端恢复 ${result.result?.files ?? 0} 个文件，重启插件后生效`
              : action === 'test' ? '云端连接成功'
                : '云端同步设置已保存'
          flash('ok', message)
        }
      }

      async function updateAction(download) {
        const result = await run(download ? 'update-download' : 'update-check', () => request('/qq-free/update', {
          action: download ? 'download' : 'check',
        }))
        if (result !== null) {
          setUpdateInfo(result.result)
          flash('ok', download ? '更新包已下载。' : (result.result?.hasUpdate ? `发现新版本 ${result.result.latest}` : '已经是最新版本。'))
        }
      }

      async function githubAction(action) {
        const result = await run(`github-${action}`, () => request('/qq-free/github', action === 'save' ? {
          action: 'save',
          enabled: githubForm?.enabled === true,
          owner: githubForm?.owner ?? '',
          repo: githubForm?.repo ?? '',
          token: githubForm?.token ?? '',
          auto: githubForm?.auto !== false,
        } : { action }))
        if (result !== null) {
          flash('ok', action === 'push' ? `已同步 ${result.result?.synced ?? 0} 个文件到 GitHub` : 'GitHub 同步设置已保存')
        }
      }

      async function saveWelcome() {
        if (welcomeForm === null) return
        const result = await run('welcome', () => request('/qq-free/config', {
          welcomeEnabled: welcomeForm.enabled,
          welcomeText: welcomeForm.text,
          welcomeGroups: welcomeForm.groups.split(/[\n,，、\s]+/).filter(Boolean),
          joinNoticeEnabled: welcomeForm.joinNotice,
          joinNoticeAvatar: welcomeForm.joinAvatar,
        }))
        if (result !== null) flash('ok', '入群欢迎设置已保存。')
      }

      async function refreshJoins() {
        if (adminGroup === '') return
        const result = await run('joins', () => request('/qq-free/group-admin', { action: 'list', groupOpenid: adminGroup }))
        if (result !== null) {
          setJoins(Array.isArray(result.list) ? result.list : [])
          flash('ok', `入群申请：${Array.isArray(result.list) ? result.list.length : 0} 条`)
        }
      }

      async function decideJoin(entry, op) {
        const result = await run(`join-${op}`, () => request('/qq-free/group-admin', {
          action: op,
          groupOpenid: entry.groupOpenid ?? entry.group_openid,
          memberOpenid: entry.member_openid,
          joinRequestId: entry.join_request_id,
          operator: operatorName.trim() || '管理员',
          ...(op === 'decline' ? { rejectReason: '管理员拒绝', blacklist: joinBlacklist } : {}),
        }))
        if (result !== null) {
          flash('ok', `${operatorName.trim() || '管理员'} 已${op === 'approve' ? '通过' : '拒绝'}入群申请。`)
          setJoins((current) => current.filter((item) => item.member_openid !== entry.member_openid))
        }
      }

      async function forgetJoin(entry) {
        const result = await run(`join-forget`, () => request('/qq-free/group-admin', {
          action: 'forget',
          groupOpenid: entry.groupOpenid ?? entry.group_openid,
          memberOpenid: entry.member_openid,
        }))
        if (result !== null) {
          flash('ok', '已从本地待处理列表移除（不会影响平台申请）。')
          setJoins((current) => current.filter((item) => item.member_openid !== entry.member_openid))
        }
      }

      async function sendMediaNow() {
        if (mediaFile === null) return
        const result = await run('media', () => request('/qq-free/send-media', {
          targetId,
          type: mediaFile.type,
          data: mediaFile.data,
          fileName: mediaFile.name,
          caption: mediaCaption,
          mention: mentionOpenid.trim(),
        }))
        if (result !== null) {
          setMediaFile(null)
          setMediaCaption('')
          flash('ok', `已发送${mediaFile.type === 1 ? '图片' : mediaFile.type === 2 ? '视频' : mediaFile.type === 3 ? '语音' : '文件'}。`)
        }
      }

      function pickMediaFile(event) {
        const file = event.target.files?.[0]
        if (!file) return
        if (file.size > 5 * 1024 * 1024) {
          flash('error', '文件超过 5MB，QQ 接口不接受')
          event.target.value = ''
          return
        }
        const mime = String(file.type || '')
        const type = mime.startsWith('image/') ? 1 : mime.startsWith('video/') ? 2 : mime.startsWith('audio/') ? 3 : 4
        const reader = new FileReader()
        reader.onload = () => setMediaFile({ name: file.name, mime, type, data: String(reader.result || '') })
        reader.onerror = () => flash('error', '读取本地文件失败')
        reader.readAsDataURL(file)
        event.target.value = ''
      }

      async function saveReplyLogFile() {
        const result = await run('reply-log', () => request('/qq-free/config', {
          replyLogFile: replyLogFile ?? 'qq-replies.md',
        }))
        if (result !== null) flash('ok', '回复日志路径已保存。')
      }

      async function memberAction(action) {
        if (adminGroup === '' || memberOpenid.trim() === '') return
        if (action === 'kick' && !kickArmed) {
          setKickArmed(true)
          return
        }
        const result = await run(`member-${action}`, () => request('/qq-free/group-admin', {
          action,
          groupOpenid: adminGroup,
          memberOpenid: memberOpenid.trim(),
          ...(action === 'mute' ? { minutes: Number(muteMinutes) || 60 } : {}),
          ...(action === 'kick' ? { blacklist: false } : {}),
        }))
        if (result !== null) {
          setKickArmed(false)
          flash('ok', action === 'mute' ? '已设置禁言。' : action === 'unmute' ? '已解除禁言。' : '已移出群成员。')
        }
      }

      return h('div', { className: 'qqf-page' },
        h('style', null, CSS),
        h('div', { className: 'qqf-wrap' },
          h('header', { className: 'qqf-head' },
            h('div', null,
              h('h2', { className: 'qqf-title' }, 'QQ 官方机器人 · 自由发言台'),
              h('p', { className: 'qqf-sub' },
                '不@也能开口：手动发一条、让 DeepSeek 现场写一句、或按间隔自动说话。消息走 QQ 开放平台主动消息接口，'
                + '群 / 私聊都用 openid 定位。')),
            h('div', { className: 'qqf-badges' },
              h(Badge, { tone: credentialTone }, data.credential.configured ? `凭据 ${data.credential.appId}` : '未配置凭据'),
              h(Badge, { tone: modelTone }, data.model.available ? 'LLM 服务可用' : 'LLM 不可用'),
              h(Badge, { tone: data.auto.enabled ? 'on' : undefined }, data.auto.enabled ? '自动发言已开启' : '自动发言已暂停'),
              h('button', {
                className: 'qqf-btn qqf-btn--sm',
                onClick: () => void reload(),
                disabled: busy !== '',
              }, '刷新'))),

          h('p', { className: 'qqf-note' },
            '这个插件只负责「主动发送」：不接收群消息，被 @ 的回复仍由官方 QQ 插件处理；'
            + '群里不 @ 也能自动接话需要平台下发全量群消息的权限，那部分不在本插件内。'),

          notice !== null
            ? h('div', { className: `qqf-notice qqf-notice--${notice.kind === 'ok' ? 'ok' : 'error'}` }, notice.message)
            : null,

          h('div', { className: 'qqf-grid' },
            h(Card, {
              title: '连接与模型',
              hint: 'AppID / AppSecret 来自 QQ 开放平台机器人后台，保存后立刻生效，不需要重启。Provider / Model 决定 DeepSeek 走哪条路由，保存后可以用「DeepSeek 试聊」验证。',
            },
              h('div', { className: 'qqf-row' },
                h('label', { className: 'qqf-field' }, h('span', null, 'AppID'),
                  h('input', {
                    className: 'qqf-input', value: form?.appId ?? '', placeholder: '例如 102757755',
                    onChange: (event) => setForm({ ...form, appId: event.target.value }),
                  })),
                h('label', { className: 'qqf-field' }, h('span', null, 'AppSecret'),
                  h('input', {
                    className: 'qqf-input', type: 'password', value: form?.appSecret ?? '',
                    placeholder: data.credential.configured ? '已保存，留空表示不修改' : '在开放平台复制',
                    onChange: (event) => setForm({ ...form, appSecret: event.target.value }),
                  }))),
              h('div', { className: 'qqf-row' },
                h('label', { className: 'qqf-field' }, h('span', null, 'Provider'),
                  providerOptions.length > 0
                    ? h('select', {
                      className: 'qqf-select', value: form?.provider ?? '', 'aria-label': 'Provider',
                      onChange: (event) => setForm({ ...form, provider: event.target.value }),
                    }, providerOptions.map((provider) => h('option', { key: provider.id, value: provider.id }, `${provider.name}（${provider.id}）`)))
                    : h('input', {
                      className: 'qqf-input', value: form?.provider ?? '', placeholder: 'deepseek-account',
                      onChange: (event) => setForm({ ...form, provider: event.target.value }),
                    })),
                h('label', { className: 'qqf-field' }, h('span', null, 'Model'),
                  h('input', {
                    className: 'qqf-input', value: form?.model ?? '', placeholder: 'deepseek-flash',
                    onChange: (event) => setForm({ ...form, model: event.target.value }),
                  }))),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '机器人人设（system prompt）'),
                h('textarea', {
                  className: 'qqf-textarea', value: form?.persona ?? '', placeholder: '它说话的风格、身份、禁忌……留空用内置的群友口吻。',
                  onChange: (event) => setForm({ ...form, persona: event.target.value }),
                })),
              h('div', { className: 'qqf-row' },
                h('label', { className: 'qqf-field' }, h('span', null, '每个会话每日上限（0 = 不限）'),
                  h('input', {
                    className: 'qqf-input', type: 'number', min: 0, max: 200, value: form?.dailyLimit ?? 4,
                    onChange: (event) => setForm({ ...form, dailyLimit: event.target.value }),
                  })),
                h('label', { className: 'qqf-field' }, h('span', null, '静默开始'),
                  h('input', {
                    className: 'qqf-input', type: 'time', value: form?.quietHoursStart ?? '23:00',
                    onChange: (event) => setForm({ ...form, quietHoursStart: event.target.value }),
                  })),
                h('label', { className: 'qqf-field' }, h('span', null, '静默结束'),
                  h('input', {
                    className: 'qqf-input', type: 'time', value: form?.quietHoursEnd ?? '08:00',
                    onChange: (event) => setForm({ ...form, quietHoursEnd: event.target.value }),
                  }))),
              h('div', { className: 'qqf-row' },
                h('button', { className: 'qqf-btn qqf-btn--primary', disabled: busy !== '', onClick: () => void saveConfig() }, busy === 'config' ? '保存中…' : '保存设置'),
                h('span', { className: 'qqf-hint' },
                  data.limits.dailyLimit === 0
                    ? '今日主动消息不限（平台配额仍然生效）'
                    : `今日剩余额度：${remaining} / ${data.limits.dailyLimit}`))),

            h(Card, {
              title: '发一条（自由发言）',
              hint: '不需要 @，直接以机器人身份推送。官方平台对主动消息有频率与配额限制，超限会返回平台错误。',
            },
              h(TargetSelect, { targets, boards: data.boards, value: targetId, onChange: setTargetId, ariaLabel: '发送目标' }),
              groupMembers.length > 0
                ? h('select', {
                  className: 'qqf-select', value: mentionOpenid, 'aria-label': '要 @ 的群成员',
                  onChange: (event) => setMentionOpenid(event.target.value),
                },
                  h('option', { value: '' }, '不 @ 成员'),
                  groupMembers.map((member) => h('option', { key: member.openid, value: member.openid }, `@${member.name}`)))
                : h('input', {
                  className: 'qqf-input', value: mentionOpenid, placeholder: '要 @ 的群成员 openid（可选，仅群聊）',
                  onChange: (event) => setMentionOpenid(event.target.value),
                }),
              h('textarea', {
                className: 'qqf-textarea', value: text, maxLength: data.limits.maxText,
                placeholder: '想让它说什么？也可以先让 DeepSeek 写一句。',
                onChange: (event) => setText(event.target.value),
              }),
              h('div', { className: 'qqf-row' },
                h('span', { className: 'qqf-hint qqf-grow' }, `${text.length} / ${data.limits.maxText}`),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || targets.length === 0,
                  onClick: () => void generate(false),
                }, busy === 'generate' ? '生成中…' : 'DeepSeek 写一句'),
                h('button', {
                  className: 'qqf-btn qqf-btn--primary',
                  disabled: busy !== '' || text.trim() === '' || targets.length === 0,
                  onClick: () => void sendNow(),
                }, busy === 'send' ? '发送中…' : '发送到 QQ')),
              draft !== ''
                ? h('div', { className: 'qqf-draft' },
                  h('span', { className: 'qqf-draft-text' }, draft),
                  h('div', { className: 'qqf-row' },
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm',
                      onClick: () => { setText(draft); setDraft('') },
                    }, '用这句'),
                    h('button', { className: 'qqf-btn qqf-btn--sm', onClick: () => setDraft('') }, '忽略')))
                : null,
              h('div', { className: 'qqf-split' }),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: topic, placeholder: '给个话题（可选），例如：周一上班好困',
                  onChange: (event) => setTopic(event.target.value),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || targets.length === 0,
                  onClick: () => void generate(true),
                }, busy === 'generate-send' ? '生成中…' : '生成并直接发送')),
              h('div', { className: 'qqf-split' }),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '从本地选择图片 / 表情包 / 视频 / 语音 / 文件（≤5MB）'),
                h('input', {
                  className: 'qqf-input', type: 'file', accept: 'image/*,video/*,audio/*,*/*',
                  onChange: pickMediaFile,
                })),
              mediaFile
                ? h('p', { className: 'qqf-hint' }, `已选：${mediaFile.name} · ${mediaFile.type === 1 ? '图片/表情包' : mediaFile.type === 2 ? '视频' : mediaFile.type === 3 ? '语音' : '文件'}`)
                : null,
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: mediaCaption, placeholder: '可选说明文字（会单独发一条）',
                  onChange: (event) => setMediaCaption(event.target.value),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || targets.length === 0 || mediaFile === null,
                  onClick: () => void sendMediaNow(),
                }, busy === 'media' ? '发送中…' : '发送媒体'))),

            h(Card, {
              title: '自动发言',
              hint: '按固定间隔让 DeepSeek 自己找话说。开启后从当前时刻开始计时，第一句在一个间隔之后；想马上发就用「现在就来一句」。静默时段和每日上限会自动生效。',
            },
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: autoForm?.enabled ?? false,
                  onChange: (event) => setAutoForm({ ...autoForm, enabled: event.target.checked }),
                }),
                h('span', null, '开启自动开口')),
              h(TargetSelect, {
                targets, boards: data.boards, value: autoForm?.targetId || targetId,
                onChange: (value) => setAutoForm({ ...autoForm, targetId: value }),
                ariaLabel: '自动发言目标',
              }),
              h('div', { className: 'qqf-row' },
                h('label', { className: 'qqf-field' }, h('span', null, '间隔（分钟）'),
                  h('input', {
                    className: 'qqf-input', type: 'number', min: 5, max: 10080, value: autoForm?.intervalMinutes ?? 120,
                    onChange: (event) => setAutoForm({ ...autoForm, intervalMinutes: event.target.value }),
                  })),
                h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '偏好话题（可留空）'),
                  h('input', {
                    className: 'qqf-input', value: autoForm?.topics ?? '', placeholder: '例如：游戏、加班、周末去哪玩',
                    onChange: (event) => setAutoForm({ ...autoForm, topics: event.target.value }),
                  }))),
              h('div', { className: 'qqf-row' },
                h('button', { className: 'qqf-btn qqf-btn--primary', disabled: busy !== '', onClick: () => void saveAuto() }, busy === 'auto' ? '保存中…' : '保存自动发言'),
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void runAutoNow() }, busy === 'auto-now' ? '发言中…' : '现在就来一句')),
              h('p', { className: 'qqf-hint' },
                data.auto.lastAt ? `上次自动发言：${new Date(data.auto.lastAt).toLocaleString('zh-CN', { hour12: false })}` : '还没有自动发过言。',
                data.auto.nextAt ? ` · 下一句最早 ${new Date(data.auto.nextAt).toLocaleString('zh-CN', { hour12: false })}` : '',
                data.auto.quiet ? ' · 当前处于静默时段' : '',
                data.auto.error ? ` · 最近错误：${data.auto.error}` : ''),
              (() => {
                const autoTarget = targets.find((target) => target.id === (autoForm?.targetId || data.auto.targetId))
                if (autoTarget === undefined) return null
                const used = data.usage.find((item) => item.key === `${autoTarget.scope}:${autoTarget.openid}`)?.used ?? 0
                return h('p', { className: 'qqf-hint' },
                  data.limits.dailyLimit === 0
                    ? `自动发言目标今日已发 ${used} 条（不限）`
                    : `自动发言目标今日已发 ${used} / ${data.limits.dailyLimit} 条`)
              })()),

            h(Card, {
              title: '问答库',
              wide: true,
              hint: '群友 @ 机器人提问时，它会先查这里的答案，再决定怎么回；网页里也能查，并可一键发到 QQ。'
                + '注意：官方只把 @ 机器人的群消息下发给机器人，普通群消息里的关键词触发做不到。',
              actions: h('span', { className: 'qqf-hint' }, `共 ${qa.stats.count} 条 · 命中 ${qa.stats.hits} 次`),
            },
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: qaAsk, placeholder: '问一个试试，例如：群规是什么',
                  onChange: (event) => setQaAsk(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter') return
                    if (event.nativeEvent?.isComposing === true) return
                    event.preventDefault()
                    if (busy === '') void askQa(false)
                  },
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || qaAsk.trim() === '',
                  onClick: () => void askQa(false),
                }, busy === 'qa-lookup' ? '查询中…' : '查问答库'),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || qaAsk.trim() === '',
                  onClick: () => void askQa(true),
                }, busy === 'qa-deepseek' ? '回答中…' : '问 DeepSeek')),
              qaResult !== null
                ? h('div', { className: 'qqf-answer' },
                  h('div', { className: 'qqf-row' },
                    h(Badge, { tone: qaResult.matched ? 'on' : undefined },
                      qaResult.matched
                        ? `问答库命中 ${Math.round(Number(qaResult.score) * 100)}%`
                        : qaResult.source === 'deepseek' ? 'DeepSeek 现答' : '没有命中'),
                    h('span', { className: 'qqf-hint qqf-grow' }, qaResult.question)),
                  h('p', { className: 'qqf-answer-text' }, qaResult.answer || '问答库里没有匹配的答案，可以换种问法，或点「问 DeepSeek」。'),
                  h('div', { className: 'qqf-row' },
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm', disabled: busy !== '' || qaResult.answer === '',
                      onClick: () => void sendQaAnswer(),
                    }, '发送到 QQ'),
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm',
                      onClick: () => {
                        setQaQuestion(qaResult.question)
                        setQaAnswer(qaResult.answer)
                        setQaKeywords('')
                        setQaEditingId('')
                      },
                    }, '存进问答库'),
                    h('button', { className: 'qqf-btn qqf-btn--sm', onClick: () => setQaResult(null) }, '关闭')))
                : null,
              h('div', { className: 'qqf-split' }),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: qaQuestion, placeholder: '问题，例如：群里能发广告吗',
                  onChange: (event) => setQaQuestion(event.target.value),
                }),
                h('input', {
                  className: 'qqf-input qqf-grow', value: qaKeywords, placeholder: '关键词，逗号分隔（可选）',
                  onChange: (event) => setQaKeywords(event.target.value),
                })),
              h('textarea', {
                className: 'qqf-textarea', value: qaAnswer, placeholder: '答案。写清楚规则/步骤，机器人会按原意回答。',
                onChange: (event) => setQaAnswer(event.target.value),
              }),
              h('div', { className: 'qqf-row' },
                h('button', {
                  className: 'qqf-btn qqf-btn--primary',
                  disabled: busy !== '' || qaQuestion.trim() === '' || qaAnswer.trim() === '',
                  onClick: () => void saveQaEntry(),
                }, busy === 'qa-save' ? '保存中…' : qaEditingId === '' ? '添加问答' : '保存修改'),
                qaEditingId !== ''
                  ? h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: resetQaForm }, '取消编辑')
                  : null),
              h('div', { className: 'qqf-split' }),
              qa.entries.length === 0
                ? h('p', { className: 'qqf-empty' }, '问答库还是空的。添加几条，或问 DeepSeek 后点「存进问答库」。')
                : h('ul', { className: 'qqf-qa-list' },
                  qa.entries.slice(0, 40).map((entry) => h('li', { key: entry.id, className: 'qqf-qa-item' },
                    h('div', { className: 'qqf-qa-main' },
                      h('div', { className: 'qqf-qa-q' }, entry.question),
                      h('div', { className: 'qqf-qa-a' }, entry.answer),
                      h('div', { className: 'qqf-mono' },
                        `${entry.enabled ? '启用' : '停用'} · 命中 ${entry.hits}`
                        + (entry.keywords.length > 0 ? ` · 关键词 ${entry.keywords.join(' / ')}` : ''))),
                    h('div', { className: 'qqf-row' },
                      h('button', { className: 'qqf-btn qqf-btn--sm', onClick: () => startEditQa(entry) }, '编辑'),
                      h('button', {
                        className: 'qqf-btn qqf-btn--sm qqf-btn--danger',
                        disabled: busy !== '',
                        onClick: () => void removeQa(entry.id),
                      }, '删除')))))),

            h(Card, {
              title: 'QQ AI 对话（自带通道）',
              wide: true,
              hint: '开启后由本插件直接连 QQ 网关：私聊和群里 @ 机器人的消息，先查问答库，再用 DeepSeek 回复。'
                + '启用前必须先停用官方 QQ 机器人插件，否则两个连接会抢消息、重复回复。这个通道只做聊天和问答，不带 DSH 工具与文件能力。',
            },
              h('div', { className: 'qqf-row' },
                h(Badge, { tone: chatTone }, chatLabel),
                h('span', { className: 'qqf-hint qqf-grow' },
                  `收到 ${data.chat?.messages ?? 0} 条 · 回复 ${data.chat?.replies ?? 0} 条`),
                h('button', {
                  className: 'qqf-btn qqf-btn--primary',
                  disabled: busy !== '',
                  onClick: () => void toggleChannel(),
                }, busy === 'channel' ? '处理中…' : data.chat?.enabled === true
                  ? '停止通道'
                  : channelArmed ? '确认启用（已停用官方插件）' : '启用通道')),
              channelArmed && data.chat?.enabled !== true
                ? h('div', { className: 'qqf-notice qqf-notice--error' },
                  '请先到「插件」里停用官方 QQ 机器人插件（@tencent-connect/dsh-qqbot），再点「确认启用」；否则两个 WebSocket 会抢消息。',
                  h('div', { className: 'qqf-row' },
                    h('button', { className: 'qqf-btn qqf-btn--sm', onClick: () => setChannelArmed(false) }, '取消')))
                : null,
              data.chat?.lastError
                ? h('p', { className: 'qqf-hint' }, `最近错误：${data.chat.lastError}`)
                : null,
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '对话人设（留空用全局人设）'),
                h('textarea', {
                  className: 'qqf-textarea', value: channelPersona ?? '',
                  placeholder: '它在 QQ 里聊天时的身份、语气、边界……',
                  onChange: (event) => setChannelPersona(event.target.value),
                })),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '闲聊智能体人设（非提问时使用）'),
                h('textarea', {
                  className: 'qqf-textarea', value: channelAgentPersona ?? '',
                  placeholder: '它闲聊时的身份、语气，例如：群里的老网友，接话自然、简短、偶尔吐槽。',
                  onChange: (event) => setChannelAgentPersona(event.target.value),
                })),
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: channelUseQa !== false,
                  onChange: (event) => setChannelUseQa(event.target.checked),
                }),
                h('span', null, '优先使用问答库（命中即用库答案，未命中走 DeepSeek）')),
              h('p', { className: 'qqf-hint' }, '每条消息会先判断是不是提问：提问 → 问答库命中用库答案，否则 DeepSeek；闲聊 → 用上面的智能体人设接话。'),
              h('div', { className: 'qqf-row' },
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '',
                  onClick: () => void saveChannelPersona(),
                }, busy === 'channel-persona' ? '保存中…' : '保存设置'),
                h('span', { className: 'qqf-hint' },
                  data.chat?.connectedAt
                    ? `已连接：${new Date(data.chat.connectedAt).toLocaleString('zh-CN', { hour12: false })}`
                    : '未连接'))),

            h(Card, {
              title: '远程发言网页',
              wide: true,
              hint: '默认局域网使用：同一 Wi-Fi 打开 http://<本机局域网IP>:8788/?token=...，防火墙放行 TCP 8788。外网不要直接做端口映射；请安装 Tailscale 或 cloudflared 后再访问，详见安装说明。',
            },
              h('div', { className: 'qqf-row' },
                h('label', { className: 'qqf-row' },
                  h('input', {
                    type: 'checkbox', checked: remoteForm?.enabled ?? false,
                    onChange: (event) => setRemoteForm({ ...remoteForm, enabled: event.target.checked }),
                  }),
                  h('span', null, '启用远程网页')),
                h('label', { className: 'qqf-field' }, h('span', null, '端口'),
                  h('input', {
                    className: 'qqf-input', type: 'number', min: 1024, max: 65535, value: remoteForm?.port ?? 8788,
                    onChange: (event) => setRemoteForm({ ...remoteForm, port: event.target.value }),
                  }))),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '访问 token'),
                h('input', {
                  className: 'qqf-input', value: remoteForm?.token ?? '',
                  placeholder: '留空会在启用时自动生成',
                  onChange: (event) => setRemoteForm({ ...remoteForm, token: event.target.value }),
                })),
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: remoteForm?.tunnelEnabled === true,
                  onChange: (event) => setRemoteForm({ ...remoteForm, tunnelEnabled: event.target.checked }),
                }),
                h('span', null, '自动启动公网隧道（cloudflared，DSH 重启后自动恢复）')),
              h('div', { className: 'qqf-row' },
                h('button', {
                  className: 'qqf-btn qqf-btn--primary', disabled: busy !== '',
                  onClick: () => void saveRemote(false),
                }, busy === 'remote' ? '保存中…' : '保存 / 启动'),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '',
                  onClick: () => void saveRemote(true),
                }, busy === 'remote-regen' ? '生成中…' : '重新生成 token'),
                h('span', { className: 'qqf-hint' },
                  data.remote?.running ? `运行中 · 端口 ${data.remote.port}` : '未运行')),
              data.remote?.lastError ? h('p', { className: 'qqf-hint' }, `最近错误：${data.remote.lastError}`) : null,
              data.remote?.tunnel?.url
                ? h('p', { className: 'qqf-mono' }, `公网隧道：${data.remote.tunnel.url}`)
                : null,
              data.remote?.tunnel?.lastError
                ? h('p', { className: 'qqf-hint' }, `隧道错误：${data.remote.tunnel.lastError}`)
                : null,
              data.remote?.urls && data.remote.urls.length > 0
                ? h('div', null,
                  h('p', { className: 'qqf-hint' }, '用下面的地址打开（带 token，可直接复制到手机）：'),
                  data.remote.urls.map((url) => h('p', { key: url, className: 'qqf-mono' },
                    h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { color: 'inherit' } }, url))))
                : null),

            h(Card, {
              title: '会话目标',
              hint: '官方开放平台没有「列出群」接口，所以用 openid 记录目标；可以从官方 QQ 插件已记录的会话里导入。',
              actions: h('button', { className: 'qqf-btn qqf-btn--sm', disabled: busy !== '', onClick: () => void importTargets() }, busy === 'import' ? '导入中…' : '导入已知会话'),
            },
              h('div', { className: 'qqf-row' },
                h('select', {
                  className: 'qqf-select', value: targetForm.scope, 'aria-label': '目标类型',
                  onChange: (event) => setTargetForm({ ...targetForm, scope: event.target.value }),
                }, h('option', { value: 'group' }, '群聊'), h('option', { value: 'c2c' }, '私聊')),
                h('input', {
                  className: 'qqf-input qqf-grow', value: targetForm.openid, placeholder: 'group_openid / user_openid',
                  onChange: (event) => setTargetForm({ ...targetForm, openid: event.target.value }),
                })),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: targetForm.name, placeholder: '备注名，例如：摸鱼群',
                  onChange: (event) => setTargetForm({ ...targetForm, name: event.target.value }),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || targetForm.openid.trim() === '',
                  onClick: () => void addTarget(),
                }, busy === 'target' ? '添加中…' : '添加目标')),
              targets.length === 0
                ? h('p', { className: 'qqf-empty' }, '还没有目标。点「导入已知会话」，或手动粘贴 openid。')
                : h('ul', { className: 'qqf-targets' },
                  targets.map((target) => h('li', { key: target.id, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' }, `${target.name} · ${target.scope === 'group' ? '群聊' : '私聊'}`),
                      h('span', { className: 'qqf-mono' }, target.openid)),
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '',
                      onClick: () => void removeTarget(target),
                    }, '移除'))))),

            h(Card, {
              title: '入群欢迎与群管理',
              wide: true,
              hint: '欢迎消息走主动消息（受平台配额限制）；入群审批、禁言、踢人需要机器人在该群是管理员，并已打开对应权限。禁言/踢人也可在群里直接发「禁言 @某人 60」「踢人 @某人」，不用记 openid。',
            },
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: welcomeForm?.enabled ?? false,
                  onChange: (event) => setWelcomeForm({ ...welcomeForm, enabled: event.target.checked }),
                }),
                h('span', null, '有人入群时发送欢迎语')),
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: welcomeForm?.joinNotice ?? true,
                  onChange: (event) => setWelcomeForm({ ...welcomeForm, joinNotice: event.target.checked }),
                }),
                h('span', null, '有人申请入群时，在对应群里发申请通知（管理员可回复「同意 申请号」/「拒绝 申请号」）')),
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: welcomeForm?.joinAvatar ?? true,
                  onChange: (event) => setWelcomeForm({ ...welcomeForm, joinAvatar: event.target.checked }),
                }),
                h('span', null, '申请通知附带头像（会多耗一条主动消息；取不到头像时用链接代替）')),
              h('textarea', {
                className: 'qqf-textarea', value: welcomeForm?.text ?? '',
                placeholder: '欢迎语，支持 {member_openid} / {group_openid} 占位符',
                onChange: (event) => setWelcomeForm({ ...welcomeForm, text: event.target.value }),
              }),
              h('textarea', {
                className: 'qqf-textarea', value: welcomeForm?.groups ?? '',
                placeholder: '只在这些群生效（每行一个 group_openid，留空 = 全部群）',
                onChange: (event) => setWelcomeForm({ ...welcomeForm, groups: event.target.value }),
              }),
              h('div', { className: 'qqf-row' },
                h('button', { className: 'qqf-btn qqf-btn--primary', disabled: busy !== '', onClick: () => void saveWelcome() }, busy === 'welcome' ? '保存中…' : '保存欢迎设置'),
                h('span', { className: 'qqf-hint' }, '欢迎消息是主动消息，可能受平台频率/配额限制')),

              h('div', { className: 'qqf-split' }),
              h('div', { className: 'qqf-row' },
                h('select', {
                  className: 'qqf-select qqf-grow', value: adminGroup, 'aria-label': '管理群',
                  onChange: (event) => setAdminGroup(event.target.value),
                }, groupTargets.length === 0
                  ? h('option', { value: '' }, '（没有群目标）')
                  : groupTargets.map((target) => h('option', { key: target.id, value: target.openid },
                    `${target.name} · ${target.openid.slice(-6)}`))),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || adminGroup === '',
                  onClick: () => void refreshJoins(),
                }, busy === 'joins' ? '读取中…' : '刷新入群申请')),
              h('input', {
                className: 'qqf-input', value: operatorName,
                placeholder: '操作人（记录在审批记录里）',
                onChange: (event) => setOperatorName(event.target.value),
              }),
              pendingJoins.length === 0
                ? h('p', { className: 'qqf-empty' }, '没有待处理的入群申请。')
                : h('ul', { className: 'qqf-qa-list' },
                  pendingJoins.map((entry) => h('li', { key: `${entry.join_request_id}-${entry.member_openid}`, className: 'qqf-qa-item' },
                    h('div', { className: 'qqf-qa-main' },
                      h('div', { className: 'qqf-qa-q' }, entry.username || entry.member_openid),
                      h('div', { className: 'qqf-mono' },
                        `成员 openid：${entry.member_openid}`),
                      h('div', { className: 'qqf-mono' },
                        `${entry.apply_at ? `申请时间：${entry.apply_at}` : ''}${entry.risk_tips ? ` · ${entry.risk_tips}` : ''}`)),
                    h('div', { className: 'qqf-row' },
                      h('button', {
                        className: 'qqf-btn qqf-btn--sm', disabled: busy !== '',
                        onClick: () => void decideJoin(entry, 'approve'),
                      }, '通过'),
                      h('button', {
                        className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '',
                        onClick: () => void decideJoin(entry, 'decline'),
                      }, '拒绝'),
                      h('button', {
                        className: 'qqf-btn qqf-btn--sm', disabled: busy !== '',
                        onClick: () => void forgetJoin(entry),
                      }, '移除'))))),
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: joinBlacklist,
                  onChange: (event) => setJoinBlacklist(event.target.checked),
                }),
                h('span', null, '拒绝时同时加入群黑名单')),

              h('div', { className: 'qqf-split' }),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: memberOpenid,
                  placeholder: '成员 openid（官方不提供 QQ号映射；也可群里发「禁言 @成员 60」）',
                  onChange: (event) => setMemberOpenid(event.target.value),
                }),
                h('label', { className: 'qqf-field' }, h('span', null, '禁言分钟'),
                  h('input', {
                    className: 'qqf-input', type: 'number', min: 1, max: 43200, value: muteMinutes,
                    onChange: (event) => setMuteMinutes(event.target.value),
                  }))),
              h('div', { className: 'qqf-row' },
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || memberOpenid.trim() === '',
                  onClick: () => void memberAction('mute'),
                }, '禁言'),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || memberOpenid.trim() === '',
                  onClick: () => void memberAction('unmute'),
                }, '解除禁言'),
                h('button', {
                  className: 'qqf-btn qqf-btn--danger', disabled: busy !== '' || memberOpenid.trim() === '',
                  onClick: () => void memberAction('kick'),
                }, kickArmed ? '确认踢出' : '踢出'),
                kickArmed ? h('button', { className: 'qqf-btn qqf-btn--sm', onClick: () => setKickArmed(false) }, '取消') : null)),

            h(Card, {
              title: 'GitHub 更新',
              wide: true,
              hint: '从 GitHub Release 检查新版本并下载 tgz 更新包；下载后按提示重新安装。',
            },
              h('div', { className: 'qqf-row' },
                h('span', { className: 'qqf-hint' }, `当前版本：${data.version || '未知'}`),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '',
                  onClick: () => void updateAction(false),
                }, busy === 'update-check' ? '检查中…' : '检查更新'),
                h('button', {
                  className: 'qqf-btn qqf-btn--ghost', disabled: busy !== '',
                  onClick: () => void updateAction(true),
                }, busy === 'update-download' ? '下载中…' : '下载最新版')),
              updateInfo
                ? h('div', null,
                  h('p', { className: 'qqf-hint' },
                    `最新版本：${updateInfo.latest}${updateInfo.hasUpdate ? '（有更新）' : '（已是最新）'}`),
                  updateInfo.notes
                    ? h('pre', {
                      className: 'qqf-mono',
                      style: { whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto' },
                    }, updateInfo.notes)
                    : null,
                  updateInfo.file
                    ? h('p', { className: 'qqf-hint' }, `已下载到：${updateInfo.file}`)
                    : null,
                  updateInfo.installHint
                    ? h('p', { className: 'qqf-mono' }, updateInfo.installHint)
                    : null,
                  updateInfo.url
                    ? h('p', { className: 'qqf-hint' }, h('a', { href: updateInfo.url, target: '_blank', rel: 'noreferrer' }, '打开发布页'))
                    : null)
                : h('p', { className: 'qqf-empty' }, '点「检查更新」查看 GitHub 最新版本。')),

            creatorCard({
              title: '云端同步（WebDAV）',
              wide: true,
              hint: '把插件源码打包上传到 WebDAV 网盘；其他电脑填同一个地址/账号后点「从云端恢复」。文件改动后会自动上传（需勾选自动）。密码保存在本机 config.json，建议用 HTTPS。',
            },
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: cloudForm?.enabled ?? false,
                  onChange: (event) => setCloudForm({ ...cloudForm, enabled: event.target.checked }),
                }),
                h('span', null, '启用云端同步'),
                h('input', {
                  type: 'checkbox', checked: cloudForm?.auto ?? true,
                  onChange: (event) => setCloudForm({ ...cloudForm, auto: event.target.checked }),
                }),
                h('span', null, '改动后自动上传')),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, 'WebDAV 地址（文件夹）'),
                h('input', {
                  className: 'qqf-input', value: cloudForm?.url ?? '',
                  placeholder: 'https://dav.jianguoyun.com/dav/qq-free',
                  onChange: (event) => setCloudForm({ ...cloudForm, url: event.target.value }),
                })),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: cloudForm?.user ?? '', placeholder: 'WebDAV 账号',
                  onChange: (event) => setCloudForm({ ...cloudForm, user: event.target.value }),
                }),
                h('input', {
                  className: 'qqf-input qqf-grow', type: 'password', value: cloudForm?.password ?? '',
                  placeholder: data.cloud?.hasPassword ? '密码已保存，留空不改' : 'WebDAV 密码',
                  onChange: (event) => setCloudForm({ ...cloudForm, password: event.target.value }),
                })),
              h('div', { className: 'qqf-row' },
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void cloudAction('save') },
                  busy === 'cloud-save' ? '保存中…' : '保存'),
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void cloudAction('test') }, '测试连接'),
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void cloudAction('push') }, '立即上传'),
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void cloudAction('pull') }, '从云端恢复')),
              h('p', { className: 'qqf-hint' },
                data.cloud?.lastAt
                  ? `最近同步：${new Date(data.cloud.lastAt).toLocaleString('zh-CN', { hour12: false })} · ${data.cloud.lastAction || ''}`
                  : '还没有同步记录'),
              data.cloud?.lastError ? h('p', { className: 'qqf-hint' }, `最近错误：${data.cloud.lastError}`) : null),

            creatorCard({
              title: 'GitHub 直连同步',
              wide: true,
              hint: '源码改动后约 3 秒直接提交到 GitHub（Contents API），不依赖 git 命令；和 WebDAV / Actions 互为兜底。token 只存在本机 config.json 里。',
            },
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: githubForm?.enabled ?? false,
                  onChange: (event) => setGithubForm({ ...githubForm, enabled: event.target.checked }),
                }),
                h('span', null, '启用 GitHub 直连'),
                h('input', {
                  type: 'checkbox', checked: githubForm?.auto ?? true,
                  onChange: (event) => setGithubForm({ ...githubForm, auto: event.target.checked }),
                }),
                h('span', null, '改动后自动提交')),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: githubForm?.owner ?? '', placeholder: 'GitHub owner',
                  onChange: (event) => setGithubForm({ ...githubForm, owner: event.target.value }),
                }),
                h('input', {
                  className: 'qqf-input qqf-grow', value: githubForm?.repo ?? '', placeholder: '仓库名',
                  onChange: (event) => setGithubForm({ ...githubForm, repo: event.target.value }),
                })),
              h('input', {
                className: 'qqf-input', type: 'password', value: githubForm?.token ?? '',
                placeholder: data.github?.hasToken ? 'token 已保存，留空不改' : 'GitHub token（repo/contents 权限）',
                onChange: (event) => setGithubForm({ ...githubForm, token: event.target.value }),
              }),
              h('div', { className: 'qqf-row' },
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void githubAction('save') },
                  busy === 'github-save' ? '保存中…' : '保存'),
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void githubAction('push') },
                  busy === 'github-push' ? '同步中…' : '全量同步')),
              h('p', { className: 'qqf-hint' },
                data.github?.lastAt
                  ? `最近同步：${new Date(data.github.lastAt).toLocaleString('zh-CN', { hour12: false })} · ${data.github.lastFile || data.github.lastAction || ''}`
                  : '还没有同步记录'),
              data.github?.lastError ? h('p', { className: 'qqf-hint' }, `最近错误：${data.github.lastError}`) : null),

            h(Card, {
              title: '定时群公告（@所有人）',
              wide: true,
              hint: '@全体成员要求机器人是群管理员，每个群每天只能发 1 次；可同时发文字和一张图片。时间按本机时区，日期留空表示每天。',
            },
              h('input', {
                className: 'qqf-input', value: annForm.name, placeholder: '公告名称（可选）',
                onChange: (event) => setAnnForm({ ...annForm, name: event.target.value }),
              }),
              groupTargets.length === 0
                ? h('p', { className: 'qqf-empty' }, '先添加群聊目标。')
                : h('div', { className: 'qqf-row' },
                  groupTargets.map((target) => h('label', { key: target.id, className: 'qqf-row' },
                    h('input', {
                      type: 'checkbox', checked: annForm.groups.includes(target.openid),
                      onChange: (event) => setAnnForm({
                        ...annForm,
                        groups: event.target.checked
                          ? [...new Set([...annForm.groups, target.openid])]
                          : annForm.groups.filter((item) => item !== target.openid),
                      }),
                    }),
                    h('span', null, target.name)))),
              h('div', { className: 'qqf-row' },
                h('label', { className: 'qqf-field' }, h('span', null, '日期（留空=每天）'),
                  h('input', {
                    className: 'qqf-input', type: 'date', value: annForm.date,
                    onChange: (event) => setAnnForm({ ...annForm, date: event.target.value }),
                  })),
                h('label', { className: 'qqf-field' }, h('span', null, '时间'),
                  h('input', {
                    className: 'qqf-input', type: 'time', value: annForm.time,
                    onChange: (event) => setAnnForm({ ...annForm, time: event.target.value }),
                  }))),
              h('textarea', {
                className: 'qqf-textarea', value: annForm.text, placeholder: '要 @所有人 发送的文字',
                onChange: (event) => setAnnForm({ ...annForm, text: event.target.value }),
              }),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '图片（可选，≤5MB）'),
                h('input', {
                  className: 'qqf-input', type: 'file', accept: 'image/*',
                  onChange: (event) => {
                    const file = event.target.files?.[0]
                    if (!file) return
                    if (file.size > 5 * 1024 * 1024) {
                      flash('error', '图片超过 5MB')
                      event.target.value = ''
                      return
                    }
                    const reader = new FileReader()
                    reader.onload = () => setAnnImage({ name: file.name, data: String(reader.result || '') })
                    reader.readAsDataURL(file)
                    event.target.value = ''
                  },
                })),
              annImage ? h('p', { className: 'qqf-hint' }, `已选图片：${annImage.name}`) : null,
              h('button', {
                className: 'qqf-btn', disabled: busy !== '' || annForm.groups.length === 0 || annForm.text.trim() === '',
                onClick: () => void saveAnnouncement(),
              }, busy === 'announcement' ? '保存中…' : '保存定时公告'),
              data.announcements && data.announcements.length > 0
                ? h('ul', { className: 'qqf-targets' },
                  data.announcements.map((entry) => h('li', { key: entry.id, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' },
                        `${entry.name || '群公告'} · ${entry.date || '每天'} ${entry.time}${entry.enabled === false ? '（已停用）' : ''}`),
                      h('span', { className: 'qqf-mono' },
                        `${(entry.groupOpenids || []).map((openid) => groupTargets.find((target) => target.openid === openid)?.name || openid).join(' / ')}${entry.imagePath ? ' · 含图片' : ''}`),
                      h('span', { className: 'qqf-mono' }, entry.text)),
                    h('div', { className: 'qqf-row' },
                      h('button', {
                        className: 'qqf-btn qqf-btn--sm', disabled: busy !== '',
                        onClick: () => void runAnnouncement(entry),
                      }, '立即发送'),
                      h('button', {
                        className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '',
                        onClick: () => void removeAnnouncement(entry),
                      }, '删除')))))
                : h('p', { className: 'qqf-empty' }, '还没有定时公告。')),

            h(Card, {
              title: '群板块（一次发多个群）',
              wide: true,
              hint: '把 1–3 个群建成一个板块；发送/生成/媒体/自动发言选中板块就会一次发到所有群。',
            },
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: boardName, placeholder: '板块名，例如：活动通知',
                  onChange: (event) => setBoardName(event.target.value),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || boardName.trim() === '' || boardTargetIds.length === 0,
                  onClick: () => void addBoard(),
                }, busy === 'board' ? '添加中…' : '添加板块（1–3 群）')),
              groupTargets.length === 0
                ? h('p', { className: 'qqf-empty' }, '先添加群聊目标。')
                : h('div', { className: 'qqf-row' },
                  groupTargets.map((target) => h('label', { key: target.id, className: 'qqf-row' },
                    h('input', {
                      type: 'checkbox',
                      checked: boardTargetIds.includes(target.id),
                      disabled: !boardTargetIds.includes(target.id) && boardTargetIds.length >= 3,
                      onChange: () => toggleBoardTarget(target.id),
                    }),
                    h('span', null, `${target.name}（${target.openid.slice(-6)}）`)))),
              data.boards && data.boards.length > 0
                ? h('ul', { className: 'qqf-targets' },
                  data.boards.map((board) => h('li', { key: board.id, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' }, `${board.name} · ${board.count} 个群`),
                      h('span', { className: 'qqf-mono' }, board.targets.map((target) => target.name).join(' / '))),
                    h('button', { className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '', onClick: () => void removeBoard(board) }, '删除'))))
                : h('p', { className: 'qqf-empty' }, '还没有板块。')),

            h(Card, {
              title: '违禁词与处罚',
              wide: true,
              hint: '只在指定群里生效：第 1 次撤回+警告，第 2 次撤回+禁言，第 3 次撤回+踢出。管理员/群主不会被处罚。',
            },
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: modForm?.enabled ?? false,
                  onChange: (event) => setModForm({ ...modForm, enabled: event.target.checked }),
                }),
                h('span', null, '启用违禁词检测')),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '违禁词（每行一个）'),
                h('textarea', {
                  className: 'qqf-textarea', value: modForm?.words ?? '',
                  placeholder: '例如：广告\n代练\n加微信',
                  onChange: (event) => setModForm({ ...modForm, words: event.target.value }),
                })),
              h('label', { className: 'qqf-field qqf-field--full' }, h('span', null, '生效的群 group_openid（每行一个）'),
                h('textarea', {
                  className: 'qqf-textarea', value: modForm?.groups ?? '',
                  placeholder: '只填要管理的群；留空 = 不检测',
                  onChange: (event) => setModForm({ ...modForm, groups: event.target.value }),
                })),
              h('div', { className: 'qqf-row' },
                h('label', { className: 'qqf-field' }, h('span', null, '第 2 次禁言分钟'),
                  h('input', {
                    className: 'qqf-input', type: 'number', min: 1, max: 43200, value: modForm?.muteMinutes ?? 10,
                    onChange: (event) => setModForm({ ...modForm, muteMinutes: event.target.value }),
                  })),
                h('button', { className: 'qqf-btn qqf-btn--primary', disabled: busy !== '', onClick: () => void saveModeration() },
                  busy === 'moderation' ? '保存中…' : '保存违禁词设置')),
              data.moderation?.strikes && data.moderation.strikes.length > 0
                ? h('div', null,
                  h('p', { className: 'qqf-hint' }, '违规次数：'),
                  h('ul', { className: 'qqf-targets' },
                    data.moderation.strikes.map((entry) => h('li', { key: entry.key, className: 'qqf-target' },
                      h('div', { className: 'qqf-target-main' },
                        h('span', { className: 'qqf-target-name' }, `${entry.name || entry.memberOpenid} · ${entry.count} 次`),
                        h('span', { className: 'qqf-mono' }, `${entry.key} · ${entry.lastWord || ''}`)),
                      h('button', {
                        className: 'qqf-btn qqf-btn--sm', disabled: busy !== '',
                        onClick: () => void resetStrikes(entry.key),
                      }, '重置')))),
                  h('button', { className: 'qqf-btn qqf-btn--sm', disabled: busy !== '', onClick: () => void resetStrikes('') }, '全部重置'))
                : null),

            h(Card, {
              title: '屏蔽成员',
              wide: true,
              hint: '指定群里完全忽略某个成员的消息：不回复、不执行命令、不参与违禁词处罚。',
            },
              h('div', { className: 'qqf-row' },
                h('select', {
                  className: 'qqf-select qqf-grow', value: blockGroup,
                  onChange: (event) => setBlockGroup(event.target.value),
                },
                  h('option', { value: '' }, '选择群聊…'),
                  groupTargets.map((target) => h('option', { key: target.id, value: target.openid }, target.name))),
                h('input', {
                  className: 'qqf-input qqf-grow', value: blockMember, placeholder: '成员 member_openid',
                  onChange: (event) => setBlockMember(event.target.value),
                }),
                h('input', {
                  className: 'qqf-input', value: blockName, placeholder: '备注（可选）',
                  onChange: (event) => setBlockName(event.target.value),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || blockGroup === '' || blockMember.trim() === '',
                  onClick: () => void addBlock(),
                }, busy === 'block' ? '添加中…' : '屏蔽')),
              data.blockedMembers && data.blockedMembers.length > 0
                ? h('ul', { className: 'qqf-targets' },
                  data.blockedMembers.map((entry) => h('li', { key: `${entry.groupOpenid}-${entry.memberOpenid}`, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' }, entry.name || entry.memberOpenid),
                      h('span', { className: 'qqf-mono' }, `${entry.groupOpenid} · ${entry.memberOpenid}`)),
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '',
                      onClick: () => void removeBlock(entry),
                    }, '取消'))))
                : h('p', { className: 'qqf-empty' }, '还没有屏蔽成员。'),
              h('div', { className: 'qqf-split' }),
              h('p', { className: 'qqf-hint' }, '屏蔽 @ 某人：消息里只要 @ 到这个人，就忽略整条消息（不管发送者是谁）。'),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: mentionMember, placeholder: '被 @ 的成员 member_openid',
                  onChange: (event) => setMentionMember(event.target.value),
                }),
                h('input', {
                  className: 'qqf-input', value: mentionName, placeholder: '备注（可选）',
                  onChange: (event) => setMentionName(event.target.value),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || blockGroup === '' || mentionMember.trim() === '',
                  onClick: () => void addMentionBlock(),
                }, busy === 'mention-block' ? '添加中…' : '屏蔽 @')),
              data.blockedMentions && data.blockedMentions.length > 0
                ? h('ul', { className: 'qqf-targets' },
                  data.blockedMentions.map((entry) => h('li', { key: `${entry.groupOpenid}-${entry.memberOpenid}`, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' }, entry.name || entry.memberOpenid),
                      h('span', { className: 'qqf-mono' }, `${entry.groupOpenid} · ${entry.memberOpenid}`)),
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '',
                      onClick: () => void removeMentionBlock(entry),
                    }, '取消'))))
                : h('p', { className: 'qqf-empty' }, '还没有 @ 屏蔽。')),

            h(Card, {
              title: '主人与代管',
              wide: true,
              hint: '主人拥有全部权限；群主、群管理员默认有管理权限；代管可执行审批、禁言、踢人、群信息等操作。',
            },
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: ownerId ?? '', placeholder: '主人 member_openid',
                  onChange: (event) => setOwnerId(event.target.value),
                }),
                h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void saveOwner() }, '保存主人')),
              h('div', { className: 'qqf-split' }),
              h('div', { className: 'qqf-row' },
                h('select', {
                  className: 'qqf-select qqf-grow', value: gmGroup,
                  onChange: (event) => setGmGroup(event.target.value),
                },
                  h('option', { value: '' }, '选择群聊…'),
                  groupTargets.map((target) => h('option', { key: target.id, value: target.openid }, target.name))),
                h('input', {
                  className: 'qqf-input qqf-grow', value: gmMember, placeholder: '代管 member_openid',
                  onChange: (event) => setGmMember(event.target.value),
                }),
                h('input', {
                  className: 'qqf-input', value: gmName, placeholder: '备注',
                  onChange: (event) => setGmName(event.target.value),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '' || gmGroup === '' || gmMember.trim() === '',
                  onClick: () => void addGroupManager(),
                }, '添加代管')),
              h('div', { className: 'qqf-row' },
                h('button', {
                  className: 'qqf-btn qqf-btn--ghost', disabled: busy !== '' || gmGroup === '',
                  onClick: () => void fetchGroupInfo(gmGroup),
                }, '获取群信息')),
              groupInfo ? h('pre', { className: 'qqf-mono', style: { whiteSpace: 'pre-wrap' } }, groupInfo) : null,
              data.groupManagers && data.groupManagers.length > 0
                ? h('ul', { className: 'qqf-targets' },
                  data.groupManagers.map((entry) => h('li', { key: `${entry.groupOpenid}-${entry.memberOpenid}`, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' }, entry.name || entry.memberOpenid),
                      h('span', { className: 'qqf-mono' }, `${entry.groupOpenid} · ${entry.memberOpenid}`)),
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '',
                      onClick: () => void removeGroupManager(entry),
                    }, '取消'))))
                : h('p', { className: 'qqf-empty' }, '还没有代管。')),

            h(Card, {
              title: '入群人机验证',
              wide: true,
              hint: '只在勾选的群生效：新成员入群后 @他 发送随机验证码，2 分钟内 @机器人 回复正确验证码通过；超时或回复错误会被移出群聊。',
            },
              h('label', { className: 'qqf-row' },
                h('input', {
                  type: 'checkbox', checked: jvEnabled === true,
                  onChange: (event) => setJvEnabled(event.target.checked),
                }),
                h('span', null, '启用入群人机验证')),
              groupTargets.length === 0
                ? h('p', { className: 'qqf-empty' }, '先添加群聊目标。')
                : h('div', { className: 'qqf-row' },
                  groupTargets.map((target) => h('label', { key: target.id, className: 'qqf-row' },
                    h('input', {
                      type: 'checkbox', checked: jvGroups.includes(target.openid),
                      onChange: (event) => setJvGroups(event.target.checked
                        ? [...new Set([...jvGroups, target.openid])]
                        : jvGroups.filter((item) => item !== target.openid)),
                    }),
                    h('span', null, target.name)))),
              h('button', { className: 'qqf-btn', disabled: busy !== '', onClick: () => void saveJoinVerify() },
                busy === 'join-verify' ? '保存中…' : '保存入群验证设置'),
              data.joinVerifications && data.joinVerifications.length > 0
                ? h('ul', { className: 'qqf-targets' },
                  data.joinVerifications.map((entry) => h('li', { key: `${entry.groupOpenid}-${entry.memberOpenid}`, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' }, entry.name || entry.memberOpenid),
                      h('span', { className: 'qqf-mono' }, `${entry.groupOpenid} · 到期 ${new Date(entry.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}`)))))
                : h('p', { className: 'qqf-empty' }, '当前没有待验证的新成员。')),

            h(Card, {
              title: '群功能屏蔽',
              wide: true,
              hint: '按群屏蔽指定功能，或一键屏蔽全部功能。全部屏蔽后该群的聊天、自动发言、命令、违禁词、欢迎、入群通知、获取信息都不再响应。',
            },
              h('div', { className: 'qqf-row' },
                h('select', {
                  className: 'qqf-select qqf-grow', value: gbGroup,
                  onChange: (event) => setGbGroup(event.target.value),
                },
                  h('option', { value: '' }, '选择群聊…'),
                  groupTargets.map((target) => h('option', { key: target.id, value: target.openid }, target.name))),
                h('label', { className: 'qqf-row' },
                  h('input', {
                    type: 'checkbox', checked: gbAll,
                    onChange: (event) => setGbAll(event.target.checked),
                  }),
                  h('span', null, '屏蔽全部功能'))),
              h('div', { className: 'qqf-row' },
                [
                  ['chat', 'AI 聊天'],
                  ['auto', '自动发言'],
                  ['welcome', '入群欢迎'],
                  ['joinNotice', '入群申请通知'],
                  ['commands', '群管理命令'],
                  ['moderation', '违禁词'],
                  ['info', '获取信息'],
                ].map(([key, label]) => h('label', { key, className: 'qqf-row' },
                  h('input', {
                    type: 'checkbox', disabled: gbAll, checked: gbFeatures.includes(key),
                    onChange: (event) => setGbFeatures((current) => event.target.checked
                      ? [...new Set([...current, key])]
                      : current.filter((item) => item !== key)),
                  }),
                  h('span', null, label)))),
              h('button', {
                className: 'qqf-btn', disabled: busy !== '' || gbGroup === '',
                onClick: () => void saveGroupBlock(),
              }, busy === 'group-block' ? '保存中…' : '保存群屏蔽'),
              data.groupBlocks && data.groupBlocks.length > 0
                ? h('ul', { className: 'qqf-targets' },
                  data.groupBlocks.map((entry) => h('li', { key: entry.groupOpenid, className: 'qqf-target' },
                    h('div', { className: 'qqf-target-main' },
                      h('span', { className: 'qqf-target-name' },
                        groupTargets.find((target) => target.openid === entry.groupOpenid)?.name || entry.groupOpenid),
                      h('span', { className: 'qqf-mono' },
                        entry.all ? '全部功能' : (entry.features.length > 0 ? entry.features.join(' / ') : '未选择功能'))),
                    h('button', {
                      className: 'qqf-btn qqf-btn--sm qqf-btn--danger', disabled: busy !== '',
                      onClick: () => void removeGroupBlock(entry),
                    }, '取消'))))
                : h('p', { className: 'qqf-empty' }, '还没有群功能屏蔽。')),

            h(Card, {
              title: 'DeepSeek 试聊',
              hint: '不经过 QQ，直接在网页里试人设和回复效果。',
            },
              h('div', { className: 'qqf-chat' },
                chat.length === 0
                  ? h('span', { className: 'qqf-chat-empty' }, '问它一句，看看现在的人设效果。')
                  : chat.map((message, index) => h('div', {
                    key: index,
                    className: `qqf-msg qqf-msg--${message.role === 'user' ? 'user' : 'assistant'}`,
                  }, message.text))),
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: chatInput, placeholder: '例如：帮我写条周五下午的摸鱼通知',
                  onChange: (event) => setChatInput(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter') return
                    if (event.nativeEvent?.isComposing === true) return
                    event.preventDefault()
                    if (busy === '') void sendChat()
                  },
                }),
                h('button', {
                  className: 'qqf-btn qqf-btn--primary', disabled: busy !== '' || chatInput.trim() === '',
                  onClick: () => void sendChat(),
                }, busy === 'chat' ? '思考中…' : '发送')),

            h(Card, {
              title: 'QQ 对话记录',
              wide: true,
              hint: `群聊/私聊的问答会同步写进工作区文件：${data.replyLogPath || ''}`,
            },
              h('div', { className: 'qqf-row' },
                h('input', {
                  className: 'qqf-input qqf-grow', value: replyLogFile ?? '',
                  placeholder: '日志文件（相对当前工作区，或绝对路径）',
                  onChange: (event) => setReplyLogFile(event.target.value),
                }),
                h('button', {
                  className: 'qqf-btn', disabled: busy !== '',
                  onClick: () => void saveReplyLogFile(),
                }, busy === 'reply-log' ? '保存中…' : '保存路径')),
              data.chatLog && data.chatLog.length > 0
                ? h('ul', { className: 'qqf-qa-list' },
                  data.chatLog.slice(0, 20).map((entry, index) => h('li', { key: `${entry.at}-${index}`, className: 'qqf-qa-item' },
                    h('div', { className: 'qqf-qa-main' },
                      h('div', { className: 'qqf-qa-q' }, `问：${entry.question || '（空）'}`),
                      h('div', { className: 'qqf-qa-a' }, `答：${entry.answer}`),
                      h('div', { className: 'qqf-mono' },
                        `${entry.atLabel || ''} · ${entry.askerName || entry.asker || ''} · ${entry.source}`)))))
                : h('p', { className: 'qqf-empty' }, '还没有对话记录。')),

            h(Card, {
              title: '发送记录',
              wide: true,
              hint: `最近 ${data.log.length} 条；日志同时保存在 ${data.dataDir}。`,
            },
              data.log.length === 0
                ? h('p', { className: 'qqf-empty' }, '还没有发送记录。')
                : h('div', { className: 'qqf-log-wrap' },
                  h('table', { className: 'qqf-log' },
                    h('thead', null, h('tr', null,
                      h('th', null, '时间'), h('th', null, '来源'), h('th', null, '目标'), h('th', null, '内容'), h('th', null, '结果'))),
                    h('tbody', null,
                      data.log.map((entry, index) => h('tr', { key: `${entry.at}-${index}` },
                        h('td', { className: 'qqf-mono' }, entry.atLabel),
                        h('td', null, entry.kind === 'auto' ? '自动' : entry.kind === 'tool' ? '工具' : entry.kind === 'generated' ? 'DeepSeek' : '手动'),
                        h('td', null, `${entry.name}（${entry.scope === 'group' ? '群' : '私聊'}）`),
                        h('td', { className: 'qqf-log-text' }, entry.text),
                        h('td', { className: entry.ok ? 'qqf-ok' : 'qqf-fail' }, entry.ok ? '成功' : entry.error || '失败'))))))))
          )))
    }

    function Page() {
      return h(Panel)
    }

    function OpenAction({ subject, packageName, onOpen }) {
      if (subject?.kind !== 'bundle' && subject?.kind !== 'row') return null
      if (subject.pkg?.name !== PACKAGE_NAME) return null
      if (subject.kind === 'row' && subject.row?.moduleName !== PACKAGE_NAME) return null
      return h('button', { type: 'button', className: 'qqf-btn', onClick: onOpen }, '打开面板')
    }

    function SidebarIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.36A1 1 0 0 1 4 18.57V5.5Z',
          stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round',
        }),
        h('path', { d: 'M8 8.5h8M8 12h5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function installStyles() {
      if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return null
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      document.head.appendChild(style)
      return () => { style.remove() }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = []
        const styleDispose = installStyles()
        if (styleDispose !== null) disposers.push(styleDispose)
        const slots = ctx.slots
        if (slots !== undefined) {
          disposers.push(slots.inject('settings.section', () => slots.register({
            name: 'settings.section',
            id: 'qq-free',
            order: 8,
            label: 'QQ 自由发言',
          }, Panel)))
        }
        const ctxInject = ctx.inject
        if (typeof ctxInject === 'function') {
          ctxInject.call(ctx, ['layout'], (pageCtx) => {
            const pageSlots = pageCtx.slots
            const layout = pageCtx.layout
            if (pageSlots === undefined || layout === undefined) return undefined
            const stopMain = pageSlots.inject('main', () => pageSlots.register({
              name: 'main',
              key: MAIN_PANEL_ID,
            }, Page))
            const stopSidebar = pageSlots.inject('sidebar.panellist', () => pageSlots.register({
              name: 'sidebar.panellist',
              id: MAIN_PANEL_ID,
              order: 11,
              label: 'QQ 自由发言',
            }, SidebarIcon))
            const stopActions = pageSlots.inject('plugins.detail.actions', () => pageSlots.register({
              name: 'plugins.detail.actions',
              id: 'qq-free-open',
              order: 21,
              inject: () => ({ packageName: PACKAGE_NAME, onOpen: () => layout.selectPanel(MAIN_PANEL_ID) }),
            }, OpenAction))
            return () => { stopMain(); stopSidebar(); stopActions() }
          })
        }
        ctx.effect(() => () => {
          for (const dispose of disposers.reverse()) dispose()
        }, 'qq-free.client')
      },
    }
  },
})
