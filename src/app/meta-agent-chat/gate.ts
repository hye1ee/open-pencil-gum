export type ChatGatePoint = 'mid-thought' | 'before-action' | 'before-final-response'

export class ChatTurnGate {
  private blocked = false
  private resolver: ((resume: boolean) => void) | null = null
  private result: Promise<boolean> | null = null

  hold(): void {
    if (this.blocked) return
    this.blocked = true
    this.result = new Promise((resolve) => {
      this.resolver = resolve
    })
  }

  async awaitResume(point: ChatGatePoint): Promise<boolean> {
    if (point === 'mid-thought' || !this.blocked || !this.result) return true
    return this.result
  }

  resume(): void {
    this.release(true)
  }

  abandon(): void {
    this.release(false)
  }

  private release(resume: boolean): void {
    this.resolver?.(resume)
    this.blocked = false
    this.resolver = null
    this.result = null
  }
}
