declare module "@msgpack/msgpack" {
  export function encode(value: unknown): Uint8Array;
  export function decode(data: Uint8Array): unknown;
}

declare module "@zip.js/zip.js" {
  export interface ZipWriterOptions {
    level?: number;
  }

  export interface ZipEntryAddOptions {
    level?: number;
  }

  export interface ZipEntry {
    filename: string;
    directory: boolean;
    uncompressedSize?: number;
    getData?<T>(writer: T): Promise<Uint8Array>;
  }

  export class Uint8ArrayReader {
    constructor(data: Uint8Array);
  }

  export class Uint8ArrayWriter {
    getData(): Uint8Array;
  }

  export class ZipWriter<TWriter> {
    constructor(writer: TWriter, options?: ZipWriterOptions);
    add(name: string, reader: Uint8ArrayReader, options?: ZipEntryAddOptions): Promise<void>;
    close(): Promise<void>;
  }

  export class ZipReader<TReader> {
    constructor(reader: TReader);
    getEntries(): Promise<ZipEntry[]>;
    close(): Promise<void>;
  }
}
