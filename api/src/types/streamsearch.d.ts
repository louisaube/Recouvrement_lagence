declare module 'streamsearch' {
  /** Streaming Boyer-Moore-Horspool search (no bundled types). */
  class StreamSearch {
    constructor(
      needle: Buffer | string,
      callback: (isMatch: boolean, data: Buffer | undefined, start: number, end: number, isSafe: boolean) => void,
    )
    push(chunk: Buffer): number
    destroy(): void
  }
  export = StreamSearch
}
