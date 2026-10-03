export class StorageUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor(message = 'Attachment file not found') {
    super(message);
    this.name = 'StorageObjectNotFoundError';
  }
}
