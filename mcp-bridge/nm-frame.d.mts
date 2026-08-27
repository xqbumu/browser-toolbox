export function encodeMessage(obj: unknown): Buffer;
export class NmDecoder {
  constructor(onMessage: (msg: unknown) => void);
  push(chunk: Buffer | Uint8Array): void;
}
