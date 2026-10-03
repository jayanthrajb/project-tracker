import type { Readable } from 'node:stream';

export interface PresignedDownloadOptions {
  filename: string;
  mimeType: string;
}

export interface StorageDriver {
  save(storageKey: string, content: Readable, sizeBytes: number): Promise<void>;
  createReadStream(storageKey: string): Promise<Readable>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  createPresignedDownloadUrl?(storageKey: string, options?: PresignedDownloadOptions): Promise<string>;
}
