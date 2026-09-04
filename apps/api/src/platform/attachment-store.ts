import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

export class AttachmentStoreError extends Error {
  readonly code: 'attachment_key_invalid' | 'attachment_not_found' | 'attachment_conflict' | 'attachment_cleanup_requires_freeze'

  constructor(code: AttachmentStoreError['code']) {
    super(code)
    this.code = code
  }
}

export interface StageAttachmentInput {
  ownerId: string
  stagingId: string
  content: Uint8Array
}

export interface PromoteAttachmentInput {
  stagingKey: string
  permanentKey: string
}

export interface PreparedAttachment {
  key: string
  created: boolean
}

/**
 * The only physical-attachment boundary used by the target runtime. Database
 * rows retain opaque relative keys and metadata; callers never receive paths.
 */
export class AttachmentStore {
  private readonly root: string
  private readonly orphanGraceMs: number

  constructor(root: string, options: { orphanGraceMs?: number } = {}) {
    this.root = resolve(root)
    this.orphanGraceMs = options.orphanGraceMs ?? 24 * 60 * 60 * 1000
  }

  async stage(input: StageAttachmentInput): Promise<string> {
    const key = `staging/${input.ownerId}/${input.stagingId}`
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    try {
      const existing = await this.read(key)
      if (!Buffer.from(existing).equals(Buffer.from(input.content)))
        throw new AttachmentStoreError('attachment_conflict')
      await this.touch(key)
      return key
    } catch (error) {
      if (!(error instanceof AttachmentStoreError) || error.code !== 'attachment_not_found')
        throw error
    }
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, input.content, { flag: 'wx', mode: 0o600 })
      try {
        await copyFile(temporary, path, constants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const existing = await this.read(key)
        if (!Buffer.from(existing).equals(Buffer.from(input.content)))
          throw new AttachmentStoreError('attachment_conflict')
        await this.touch(key)
      }
    } finally {
      await rm(temporary, { force: true })
    }
    return key
  }

  async promote(input: PromoteAttachmentInput): Promise<PreparedAttachment> {
    const permanentPath = this.pathFor(input.permanentKey)
    const content = await this.read(input.stagingKey)
    await mkdir(dirname(permanentPath), { recursive: true })
    try {
      const existing = await this.read(input.permanentKey)
      if (!Buffer.from(existing).equals(Buffer.from(content)))
        throw new AttachmentStoreError('attachment_conflict')
      await this.touch(input.permanentKey)
      return { key: input.permanentKey, created: false }
    } catch (error) {
      if (!(error instanceof AttachmentStoreError) || error.code !== 'attachment_not_found')
        throw error
    }
    // Promotion is deliberately a copy: callers prepare it inside their DB
    // transaction and retain the owned staging blob until that transaction
    // commits. This keeps a failed submission retryable.
    try {
      await copyFile(
        this.pathFor(input.stagingKey),
        permanentPath,
        constants.COPYFILE_EXCL,
      )
      return { key: input.permanentKey, created: true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.read(input.permanentKey)
      if (!Buffer.from(existing).equals(Buffer.from(content)))
        throw new AttachmentStoreError('attachment_conflict')
      await this.touch(input.permanentKey)
      return { key: input.permanentKey, created: false }
    }
  }

  async finalize(stagingKey: string): Promise<void> {
    await this.remove(stagingKey)
  }

  async cleanupOrphans(
    domain: 'dcl' | 'vou',
    referencedKeys: ReadonlySet<string>,
    proof: { writersFrozen: true },
  ): Promise<number> {
    if (proof.writersFrozen !== true)
      throw new AttachmentStoreError('attachment_cleanup_requires_freeze')
    return this.cleanupDirectory(
      resolve(this.root, 'permanent', domain),
      ['permanent', domain],
      referencedKeys,
    )
  }

  /** Physical orphan scans are operator-only and require every writer stopped. */
  async cleanupStagingOrphans(
    referencedKeys: ReadonlySet<string>,
    proof: { writersFrozen: true },
  ): Promise<number> {
    if (proof.writersFrozen !== true)
      throw new AttachmentStoreError('attachment_cleanup_requires_freeze')
    return this.cleanupDirectory(
      resolve(this.root, 'staging'),
      ['staging'],
      referencedKeys,
    )
  }

  async read(key: string): Promise<Buffer> {
    const path = this.pathFor(key)
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new AttachmentStoreError('attachment_not_found')
      return await readFile(path)
    } catch (error) {
      if (error instanceof AttachmentStoreError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new AttachmentStoreError('attachment_not_found')
      throw error
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true })
  }

  private async touch(key: string): Promise<void> {
    const now = new Date()
    await utimes(this.pathFor(key), now, now)
  }

  private pathFor(key: string): string {
    const segments = key.split('/')
    const valid =
      (segments[0] === 'staging' && segments.length === 3) ||
      (segments[0] === 'permanent' && segments.length === 5)
    if (!valid || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment)))
      throw new AttachmentStoreError('attachment_key_invalid')
    const path = resolve(this.root, ...segments)
    if (relative(this.root, path).startsWith('..'))
      throw new AttachmentStoreError('attachment_key_invalid')
    return path
  }

  private async cleanupDirectory(
    directory: string,
    prefix: string[],
    referencedKeys: ReadonlySet<string>,
  ): Promise<number> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let deleted = 0
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      const key = [...prefix, entry.name]
      if (entry.isDirectory()) {
        deleted += await this.cleanupDirectory(path, key, referencedKeys)
        continue
      }
      const storageKey = key.join('/')
      if (!referencedKeys.has(storageKey)) {
        const stat = await lstat(path)
        if (Date.now() - stat.mtimeMs < this.orphanGraceMs) continue
        await rm(path, { force: true })
        deleted += 1
      }
    }
    return deleted
  }
}
