/**
 * 远程网页公网隧道：由插件自己拉起 cloudflared quick tunnel。
 * 用 tunnel.pid 做单实例锁：插件/DSH 重启时优先复用仍在运行的旧隧道，
 * 避免重复启动导致地址不停变化。
 *
 * @module @local/dsh-qq-free/tunnel
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function createTunnel({ dataDir, getConfig, logger }) {
  let child = null
  let adoptedPid = 0
  let poller = null
  let restartTimer = null
  let lastUrl = ''
  let lastError = ''
  let restarts = 0
  let stopping = false

  function logFile() {
    return join(dataDir, 'tunnel.log')
  }

  function lockFile() {
    return join(dataDir, 'tunnel.pid')
  }

  function readPid() {
    try {
      const pid = Number.parseInt(readFileSync(lockFile(), 'utf8').trim(), 10)
      return Number.isFinite(pid) && pid > 0 ? pid : 0
    } catch {
      return 0
    }
  }

  function alive(pid) {
    if (!Number.isFinite(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  function resolveBinary() {
    const configured = String(getConfig().tunnelBin || '').trim()
    const candidates = [
      configured,
      join(dataDir, 'cloudflared.exe'),
      join(process.env.TEMP || tmpdir(), 'cloudflared.exe'),
      join(process.env.TEMP || tmpdir(), 'cloudflared'),
    ].filter(Boolean)
    return candidates.find((candidate) => existsSync(candidate)) ?? ''
  }

  function readUrl() {
    try {
      const text = readFileSync(logFile(), 'utf8')
      const matches = [...text.matchAll(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi)]
      return matches.length > 0 ? matches[matches.length - 1][0] : ''
    } catch {
      return ''
    }
  }

  function stopPolling() {
    if (poller !== null) clearInterval(poller)
    poller = null
  }

  function startPolling() {
    stopPolling()
    poller = setInterval(() => {
      if (adoptedPid > 0 && !alive(adoptedPid)) {
        adoptedPid = 0
        try { unlinkSync(lockFile()) } catch { /* ignore */ }
        scheduleRestart()
        return
      }
      const url = readUrl()
      if (url.length > 0 && url !== lastUrl) {
        lastUrl = url
        lastError = ''
        logger.info(`qq-free tunnel: ${url}`)
      }
    }, 1500)
    poller.unref?.()
  }

  function scheduleRestart() {
    if (stopping) return
    if (getConfig().tunnelEnabled !== true) return
    if (restartTimer !== null) return
    restartTimer = setTimeout(() => {
      restartTimer = null
      restarts += 1
      start()
    }, 8000)
    restartTimer.unref?.()
  }

  function start() {
    if (child !== null || adoptedPid > 0) return
    const config = getConfig()
    if (config.tunnelEnabled !== true) return
    if (config.webEnabled !== true) {
      lastError = '远程网页未启用，隧道不启动'
      return
    }

    const existing = readPid()
    if (existing > 0 && alive(existing)) {
      // 旧的 cloudflared 还在运行，直接复用，地址保持稳定
      adoptedPid = existing
      lastUrl = readUrl()
      lastError = ''
      startPolling()
      logger.info(`qq-free tunnel: 复用已有隧道 PID ${existing}`)
      return
    }
    try { unlinkSync(lockFile()) } catch { /* ignore */ }

    const binary = resolveBinary()
    if (binary.length === 0) {
      lastError = '找不到 cloudflared.exe，请把 cloudflared 放到数据目录或填 tunnelBin'
      logger.warn(`qq-free tunnel: ${lastError}`)
      return
    }
    try {
      unlinkSync(logFile())
    } catch {
      // ignore
    }
    lastError = ''
    try {
      child = spawn(binary, ['tunnel', '--url', 'http://127.0.0.1:8788', '--no-autoupdate', '--logfile', logFile()], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      child = null
      logger.warn(`qq-free tunnel: 启动失败 ${lastError}`)
      scheduleRestart()
      return
    }
    child.on('error', (error) => {
      lastError = error instanceof Error ? error.message : String(error)
      logger.warn(`qq-free tunnel: ${lastError}`)
    })
    if (child.pid) {
      try { writeFileSync(lockFile(), String(child.pid), 'utf8') } catch { /* ignore */ }
    }
    child.on('exit', (code) => {
      const exitedPid = child?.pid
      child = null
      stopPolling()
      try {
        const pid = readPid()
        if (pid === 0 || pid === exitedPid) unlinkSync(lockFile())
      } catch {
        // ignore
      }
      if (!stopping && getConfig().tunnelEnabled === true) {
        lastError = `cloudflared 退出（code ${code ?? '?'}），8 秒后重启`
        scheduleRestart()
      }
    })
    startPolling()
    logger.info('qq-free tunnel: 已启动 cloudflared')
  }

  function stop(killTunnel = false) {
    stopPolling()
    if (restartTimer !== null) clearTimeout(restartTimer)
    restartTimer = null
    if (killTunnel) {
      const pid = child?.pid ?? adoptedPid
      if (pid > 0) {
        try { process.kill(pid) } catch { /* ignore */ }
      }
      try { unlinkSync(lockFile()) } catch { /* ignore */ }
    }
    child = null
    adoptedPid = 0
  }

  return {
    start,
    stop,
    status() {
      const pid = adoptedPid > 0 ? adoptedPid : readPid()
      const running = child !== null || (pid > 0 && alive(pid))
      return {
        enabled: getConfig().tunnelEnabled === true,
        running,
        url: lastUrl || readUrl(),
        restarts,
        lastError,
        binary: resolveBinary(),
      }
    },
  }
}
