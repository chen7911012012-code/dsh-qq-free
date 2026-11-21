/**
 * 入群验证码图片：纯 Node 生成 PNG，不依赖 canvas / 第三方库。
 * 5x7 点阵数字 + 干扰点/线，验证码只出现在图片里。
 *
 * @module @local/dsh-qq-free/verification-image
 */

import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const DIGITS = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([length, name, data, crc])
}

function random(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1))
}

/**
 * 生成验证码 PNG。
 * @param {string} code 6 位数字
 * @param {string} file 输出路径
 */
export function renderVerificationImage(code, file) {
  const width = 360
  const height = 140
  const pixels = Buffer.alloc(width * height * 3)
  const bg = [random(235, 250), random(238, 250), random(240, 252)]
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 3] = bg[0]
    pixels[i * 3 + 1] = bg[1]
    pixels[i * 3 + 2] = bg[2]
  }
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const index = (y * width + x) * 3
    pixels[index] = color[0]
    pixels[index + 1] = color[1]
    pixels[index + 2] = color[2]
  }
  const line = (x0, y0, x1, y1, color) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(x0 + ((x1 - x0) * step) / steps)
      const y = Math.round(y0 + ((y1 - y0) * step) / steps)
      put(x, y, color)
    }
  }

  // 干扰线
  for (let i = 0; i < 5; i += 1) {
    line(random(0, width), random(0, height), random(0, width), random(0, height),
      [random(160, 215), random(160, 215), random(160, 215)])
  }
  // 干扰点
  for (let i = 0; i < 380; i += 1) {
    put(random(0, width - 1), random(0, height - 1),
      [random(130, 210), random(130, 210), random(130, 210)])
  }

  const scale = 10
  const gap = 6
  const totalWidth = code.length * 5 * scale + (code.length - 1) * gap
  let x = Math.floor((width - totalWidth) / 2)
  for (const digit of code) {
    const glyph = DIGITS[digit] ?? DIGITS[0]
    const y0 = Math.floor((height - 7 * scale) / 2) + random(-6, 6)
    const color = [random(20, 70), random(20, 70), random(20, 70)]
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if (glyph[row][col] !== '1') continue
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            put(x + col * scale + dx, y0 + row * scale + dy, color)
          }
        }
      }
    }
    x += 5 * scale + gap
  }

  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0
    pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(file, png)
  return png.length
}
