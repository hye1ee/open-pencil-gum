export type ChatGatePoint = 'mid-thought' | 'before-action' | 'before-final-response'

export class ChatTurnGate {
  private blocked = false
  private abandonAtCommit = false
  private resolver: ((resume: boolean) => void) | null = null
  private result: Promise<boolean> | null = null

  constructor(private readonly reviewReasoningDeltas = false) {}

  hold(): void {
    if (this.blocked) return
    this.blocked = true
    this.result = new Promise((resolve) => {
      this.resolver = resolve
    })
  }

  async awaitResume(point: ChatGatePoint): Promise<boolean> {
    if (point === 'mid-thought' && !this.reviewReasoningDeltas) return true

    // User-Initiated LenChat reviews each reasoning delta before revealing the
    // next one. Every condition still gates actions and final responses when a
    // host explicitly holds the turn.
    if (this.blocked && this.result && !(await this.result)) {
      return false
    }
    return point === 'mid-thought' || !this.abandonAtCommit
  }

  deferAbandonAtCommit(): void {
    this.abandonAtCommit = true
  }

  clearDeferredAbandon(): void {
    this.abandonAtCommit = false
  }

  resume(): void {
    this.release(true)
  }

  abandon(): void {
    this.abandonAtCommit = false
    this.release(false)
  }

  private release(resume: boolean): void {
    this.resolver?.(resume)
    this.blocked = false
    this.resolver = null
    this.result = null
  }
}
