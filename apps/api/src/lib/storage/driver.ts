import type { ReadStream } from 'node:fs';

export interface StorageDriver {
  save(storageKey: string, content: Buffer): Promise<void>;
  createReadStream(storageKey: string): Promise<ReadStream>;
  delete(storageKey: string): Promise<void>;
}
