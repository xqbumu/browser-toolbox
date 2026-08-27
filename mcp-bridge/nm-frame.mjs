// Native Messaging 帧编解码（Firefox/Chrome native host 协议：4 字节小端长度前缀 + JSON）。
// 提取为纯函数，便于单测与在 native-host.mjs 中复用。

export function encodeMessage(obj) {
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(data.length, 0);
  return Buffer.concat([len, data]);
}

// 流式解码器：把任意分片的 chunk 累积，每凑齐一条完整消息就回调 onMessage。
export class NmDecoder {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (this.buf.length < 4 + len) break;
      const slice = this.buf.slice(4, 4 + len);
      this.buf = this.buf.slice(4 + len);
      let msg;
      try {
        msg = JSON.parse(slice.toString("utf8"));
      } catch {
        continue;
      }
      this.onMessage(msg);
    }
  }
}
