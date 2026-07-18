export {}

declare global {
  interface Uint8ArrayConstructor {
    fromBase64(base64: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array
  }

  interface Uint8Array {
    toBase64(options?: { alphabet?: 'base64' | 'base64url' }): string
  }

  interface GestureEvent extends UIEvent {
    scale: number
    rotation: number
    clientX: number
    clientY: number
  }

  interface FilePickerAcceptType {
    description: string
    accept: Record<string, string[]>
  }

  interface FilePickerOptions {
    types?: FilePickerAcceptType[]
    suggestedName?: string
  }

  interface Window {
    showOpenFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle[]>
    showSaveFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle>
    queryLocalFonts?(): Promise<
      {
        family: string
        fullName: string
        style: string
        postscriptName: string
        blob(): Promise<Blob>
      }[]
    >
    mockWindowOpen?(url: string): void
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

  // lib.dom.d.ts has SpeechRecognitionResult/ResultList/Alternative but not the
  // (still non-standard) recognizer itself — declared here instead.
  interface SpeechRecognitionResultList {
    [Symbol.iterator](): IterableIterator<SpeechRecognitionResult>
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    start(): void
    stop(): void
    abort(): void
    onresult: ((event: SpeechRecognitionEvent) => void) | null
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
    onend: (() => void) | null
  }

  type SpeechRecognitionConstructor = new () => SpeechRecognition
}
