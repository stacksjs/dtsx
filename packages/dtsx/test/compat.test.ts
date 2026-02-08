/**
 * Tests for runtime compatibility module
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  file,
  fileExists,
  getRuntimeInfo,
  isBun,
  isNode,
  readTextFile,
  runtime,
  spawnProcess,
  write,
  writeTextFile,
} from '../src/compat'

describe('Compat Module', () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dtsx-compat-test-'))
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('runtime detection', () => {
    test('isBun should be true when running in Bun', () => {
      expect(isBun).toBe(true)
    })

    test('isNode should be false when running in Bun', () => {
      expect(isNode).toBe(false)
    })

    test('runtime should be "bun"', () => {
      expect(runtime).toBe('bun')
    })

    test('isBun and isNode are mutually exclusive', () => {
      expect(isBun).not.toBe(isNode)
    })
  })

  describe('getRuntimeInfo', () => {
    test('returns an object with the correct shape', () => {
      const info = getRuntimeInfo()
      expect(info).toHaveProperty('name')
      expect(info).toHaveProperty('version')
      expect(info).toHaveProperty('isBun')
      expect(info).toHaveProperty('isNode')
    })

    test('name matches the runtime constant', () => {
      const info = getRuntimeInfo()
      expect(info.name).toBe(runtime)
    })

    test('version is a non-empty string', () => {
      const info = getRuntimeInfo()
      expect(typeof info.version).toBe('string')
      expect(info.version.length).toBeGreaterThan(0)
    })

    test('isBun and isNode match top-level exports', () => {
      const info = getRuntimeInfo()
      expect(info.isBun).toBe(isBun)
      expect(info.isNode).toBe(isNode)
    })
  })

  describe('file()', () => {
    test('creates a FileHandle with the correct name', () => {
      const handle = file('/some/path/to/file.txt')
      expect(handle.name).toBe('/some/path/to/file.txt')
    })

    test('exists() returns true for an existing file', async () => {
      const filePath = join(tempDir, 'exists-test.txt')
      await writeTextFile(filePath, 'hello')

      const handle = file(filePath)
      expect(await handle.exists()).toBe(true)
    })

    test('exists() returns false for a non-existent file', async () => {
      const handle = file(join(tempDir, 'does-not-exist.txt'))
      expect(await handle.exists()).toBe(false)
    })

    test('text() reads file content as a string', async () => {
      const filePath = join(tempDir, 'text-test.txt')
      await writeTextFile(filePath, 'file content here')

      const handle = file(filePath)
      const content = await handle.text()
      expect(content).toBe('file content here')
    })

    test('arrayBuffer() reads file content as an ArrayBuffer', async () => {
      const filePath = join(tempDir, 'arraybuffer-test.txt')
      await writeTextFile(filePath, 'binary data')

      const handle = file(filePath)
      const buffer = await handle.arrayBuffer()
      expect(buffer).toBeInstanceOf(ArrayBuffer)
      const text = new TextDecoder().decode(buffer)
      expect(text).toBe('binary data')
    })
  })

  describe('readTextFile', () => {
    test('reads file content as a string', async () => {
      const filePath = join(tempDir, 'read-text-test.txt')
      await writeTextFile(filePath, 'read me')

      const content = await readTextFile(filePath)
      expect(content).toBe('read me')
    })

    test('reads a file with unicode content', async () => {
      const filePath = join(tempDir, 'unicode-test.txt')
      const unicodeContent = 'Hello, world! Привет мир! 你好世界!'
      await writeTextFile(filePath, unicodeContent)

      const content = await readTextFile(filePath)
      expect(content).toBe(unicodeContent)
    })
  })

  describe('fileExists', () => {
    test('returns true for an existing file', async () => {
      const filePath = join(tempDir, 'file-exists-test.txt')
      await writeTextFile(filePath, 'content')

      expect(await fileExists(filePath)).toBe(true)
    })

    test('returns false for a non-existent file', async () => {
      expect(await fileExists(join(tempDir, 'no-such-file.txt'))).toBe(false)
    })

    test('returns false for a non-existent directory path', async () => {
      expect(await fileExists(join(tempDir, 'no-dir', 'no-file.txt'))).toBe(false)
    })
  })

  describe('writeTextFile + readTextFile roundtrip', () => {
    test('writes and reads back the same content', async () => {
      const filePath = join(tempDir, 'roundtrip.txt')
      const content = 'roundtrip content'
      await writeTextFile(filePath, content)

      const result = await readTextFile(filePath)
      expect(result).toBe(content)
    })

    test('overwrites existing file content', async () => {
      const filePath = join(tempDir, 'overwrite.txt')
      await writeTextFile(filePath, 'first')
      await writeTextFile(filePath, 'second')

      const result = await readTextFile(filePath)
      expect(result).toBe('second')
    })
  })

  describe('write', () => {
    test('returns the byte count for a string', async () => {
      const filePath = join(tempDir, 'write-string.txt')
      const byteCount = await write(filePath, 'hello')
      expect(byteCount).toBe(5)
    })

    test('returns the byte count for a multi-byte string', async () => {
      const filePath = join(tempDir, 'write-multibyte.txt')
      const byteCount = await write(filePath, '你好')
      // Each CJK character is 3 bytes in UTF-8
      expect(byteCount).toBe(6)
    })

    test('returns the byte count for a Uint8Array', async () => {
      const filePath = join(tempDir, 'write-uint8.bin')
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const byteCount = await write(filePath, data)
      expect(byteCount).toBe(5)
    })

    test('written content can be read back', async () => {
      const filePath = join(tempDir, 'write-readback.txt')
      await write(filePath, 'written via write()')

      const content = await readTextFile(filePath)
      expect(content).toBe('written via write()')
    })
  })

  describe('spawnProcess', () => {
    test('spawns a process and returns a SpawnResult with pid', () => {
      const result = spawnProcess(['echo', 'hello'], { stdout: 'pipe', stderr: 'pipe' })
      expect(typeof result.pid).toBe('number')
      expect(result.pid).toBeGreaterThan(0)
    })

    test('exited resolves with exit code 0 on success', async () => {
      const result = spawnProcess(['true'], { stdout: 'pipe', stderr: 'pipe' })
      const exitCode = await result.exited
      expect(exitCode).toBe(0)
    })

    test('exited resolves with non-zero exit code on failure', async () => {
      const result = spawnProcess(['false'], { stdout: 'pipe', stderr: 'pipe' })
      const exitCode = await result.exited
      expect(exitCode).toBe(1)
    })
  })
})
