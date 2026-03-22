import { config } from "./config.js";
import type { ConvexClientWrapper } from "./convex-client.js";

export class StreamWriter {
  private buffer = "";
  private deltaIndex = 0;
  private fullContent = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private messageId: string,
    private convex: ConvexClientWrapper,
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.flush();
    }, config.streamFlushIntervalMs);
  }

  append(text: string): void {
    this.buffer += text;
    this.fullContent += text;
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;

    const text = this.buffer;
    this.buffer = "";
    const index = this.deltaIndex++;

    try {
      await this.convex.writeDelta(this.messageId, text, index);
    } catch (err) {
      console.error(`Failed to write stream delta ${index}:`, err);
      // Re-prepend to buffer for retry on next flush
      this.buffer = text + this.buffer;
      this.deltaIndex--;
    } finally {
      this.flushing = false;
    }
  }

  async finalize(metadata: {
    toolCalls?: Parameters<ConvexClientWrapper["finalizeMessage"]>[0]["toolCalls"];
    artifactIds?: string[];
    elementRefs?: Parameters<ConvexClientWrapper["finalizeMessage"]>[0]["elementRefs"];
    suggestions?: Parameters<ConvexClientWrapper["finalizeMessage"]>[0]["suggestions"];
  }): Promise<void> {
    this.stop();
    // Flush any remaining buffer
    if (this.buffer.length > 0) {
      const text = this.buffer;
      this.buffer = "";
      try {
        await this.convex.writeDelta(this.messageId, text, this.deltaIndex++);
      } catch {
        // Best-effort final flush
      }
    }

    await this.convex.finalizeMessage({
      messageId: this.messageId,
      content: this.fullContent,
      ...metadata,
    });
  }

  async abort(error: string): Promise<void> {
    this.stop();
    await this.convex.setMessageError(this.messageId, error);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getFullContent(): string {
    return this.fullContent;
  }
}
