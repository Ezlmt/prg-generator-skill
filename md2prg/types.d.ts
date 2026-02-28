declare module "@msgpack/msgpack" {
  export function encode(value: unknown): Uint8Array;
}

declare module "@zip.js/zip.js" {
  export class Uint8ArrayReader {
    constructor(data: Uint8Array);
  }

  export class Uint8ArrayWriter {
    getData(): Uint8Array;
  }

  export class ZipWriter<TWriter> {
    constructor(writer: TWriter);
    add(name: string, reader: Uint8ArrayReader): Promise<void>;
    close(): Promise<void>;
  }
}
