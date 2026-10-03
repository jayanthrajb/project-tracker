import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { access, mkdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import type { StorageDriver } from './driver.js';

export class LocalStorageDriver implements StorageDriver {
  private readonly directory: string;

  constructor(directory = process.env.UPLOAD_DIR || './uploads') {
    this.directory = path.resolve(directory);
  }

  private resolveKey(storageKey: string) {
    const resolved = path.resolve(this.directory, storageKey);
    if (!resolved.startsWith(`${this.directory}${path.sep}`)) {
      throw new Error('Invalid storage key');
    }

    return resolved;
  }

  async save(storageKey: string, content: Readable, _sizeBytes: number) {
    const filePath = this.resolveKey(storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(content, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
  }

  async createReadStream(storageKey: string) {
    const filePath = this.resolveKey(storageKey);
    const rootPath = await realpath(this.directory);
    const resolvedFilePath = await realpath(filePath);
    if (!resolvedFilePath.startsWith(`${rootPath}${path.sep}`)) {
      throw new Error('Invalid storage path');
    }
    return createReadStream(resolvedFilePath);
  }

  async delete(storageKey: string) {
    const filePath = this.resolveKey(storageKey);
    try {
      const rootPath = await realpath(this.directory);
      const resolvedFilePath = await realpath(filePath);
      if (!resolvedFilePath.startsWith(`${rootPath}${path.sep}`)) {
        throw new Error('Invalid storage path');
      }
      await unlink(resolvedFilePath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  }

  async exists(storageKey: string) {
    try {
      await access(this.resolveKey(storageKey));
      return true;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }
}

export const localStorage = new LocalStorageDriver();
