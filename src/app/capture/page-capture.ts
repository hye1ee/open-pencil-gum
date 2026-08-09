/**
 * Screenshots of the whole visible page — every panel, the toolbar, the agent
 * cursor, the canvas — as the browser itself composited them. Rendering our own
 * scene only ever produces the scene, so this is the only way to record what
 * the user actually saw.
 *
 * Self-contained on purpose: nothing in here imports from this app, so the file
 * copies into another web project as-is. Point `endpoint` at whatever accepts
 * the POST. It owns no timer either — the caller decides when to grab a frame
 * (`use.ts` here) — which keeps it free of any framework.
 */

export type CaptureFormat = 'image/png' | 'image/jpeg' | 'image/webp'

export interface CaptureOptions {
  /** Receives `POST ?session=…&index=…&ts=…` with the frame as the raw body. */
  endpoint: string
  format?: CaptureFormat
  /** 0–1, ignored for PNG. */
  quality?: number
  /** Longest edge in device pixels; larger frames are scaled down. */
  maxWidth?: number
  /** Handed the same frame that was just written, for anything that wants to
   * read the session live rather than off disk. Must not throw. */
  onFrame?: (frame: Blob, meta: FrameMeta) => void
}

export interface FrameMeta {
  sessionId: string
  index: number
  /**
   * A 16×16 greyscale thumbnail of the frame. Comparing two of these tells you
   * whether the screen actually moved, which is the cheapest way to avoid
   * spending a model call on a batch where nothing happened. Free here — the
   * decoded bitmap is already in hand.
   */
  greyscaleThumbnail: Uint8Array
}

export interface PageCapture {
  /** Grab, encode and send one frame. Resolves false once the stream is gone. */
  captureFrame(): Promise<boolean>
  stop(): void
  /** Names the directory the frames land in. */
  readonly sessionId: string
}

const DEFAULTS = { format: 'image/webp' as CaptureFormat, quality: 0.8, maxWidth: 1920 }

/** Coarse enough that a moving cursor is invisible, fine enough that a panel
 * opening is not. */
const THUMBNAIL_SIZE = 16

/** Rec. 601 luma, in integers. Colour adds nothing to a change detector. */
function greyscaleThumbnailOf(canvas: OffscreenCanvas, bitmap: ImageBitmap): Uint8Array {
  const context = canvas.getContext('2d')
  const thumbnail = new Uint8Array(THUMBNAIL_SIZE * THUMBNAIL_SIZE)
  if (!context) return thumbnail
  context.drawImage(bitmap, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  const { data } = context.getImageData(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  for (const [i] of thumbnail.entries()) {
    thumbnail[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8
  }
  return thumbnail
}

/** Constraints Chromium honours that `DisplayMediaStreamOptions` doesn't list. */
interface DisplayMediaRequestOptions extends DisplayMediaStreamOptions {
  preferCurrentTab?: boolean
  selfBrowserSurface?: 'include' | 'exclude'
}

/** `navigator` as it actually is: `getDisplayMedia` is missing in WKWebView and
 * on any non-secure origin, both of which `lib.dom` insists cannot happen. */
interface MaybeCapableNavigator {
  mediaDevices?: {
    getDisplayMedia?: (options: DisplayMediaRequestOptions) => Promise<MediaStream>
  }
}

/** Off-screen rather than hidden: `display:none` stops the decoder, and a
 * detached element gets compositor-throttled. 1px at -99999px is invisible in
 * the surface we are capturing. */
const VIDEO_STYLE =
  'position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'

/**
 * Opens the browser's screen-capture picker, so it must be called from a user
 * gesture. Throws where screen capture isn't available at all.
 */
export async function startPageCapture(options: CaptureOptions): Promise<PageCapture> {
  const format = options.format ?? DEFAULTS.format
  const quality = options.quality ?? DEFAULTS.quality
  const maxWidth = options.maxWidth ?? DEFAULTS.maxWidth

  const nav: MaybeCapableNavigator = globalThis.navigator
  const devices = nav.mediaDevices
  if (!devices?.getDisplayMedia) {
    throw new Error('page-capture: screen capture needs a secure origin and a browser that has it')
  }

  const stream = await devices.getDisplayMedia({
    // We sample every few seconds; no reason to decode at 60fps.
    video: { frameRate: { max: 5 } },
    audio: false,
    preferCurrentTab: true,
    // Without this the current tab is filtered out of the picker entirely on
    // some Chromium versions.
    selfBrowserSurface: 'include'
  })

  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  video.setAttribute('style', VIDEO_STYLE)
  document.body.append(video)
  await video.play()

  const canvas = new OffscreenCanvas(1, 1)
  const thumb = new OffscreenCanvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
  const sessionId = `${new Date().toISOString().slice(0, 19).replaceAll(/[:T-]/g, '')}-${crypto.randomUUID().slice(0, 8)}`
  let index = 0

  function stop(): void {
    for (const track of stream.getTracks()) track.stop()
    video.pause()
    video.srcObject = null
    video.remove()
  }

  return {
    stop,
    sessionId,

    async captureFrame() {
      // The user hit the browser's own "Stop sharing".
      if (stream.getVideoTracks().every((track) => track.readyState === 'ended')) return false
      // Zero while the tab is hidden. A gap is more honest than a black frame.
      if (video.videoWidth === 0) return true

      const scale = Math.min(1, maxWidth / Math.max(video.videoWidth, video.videoHeight))
      const width = Math.round(video.videoWidth * scale)
      const height = Math.round(video.videoHeight * scale)

      // Resize during decode and encode off-thread — the main thread here is
      // busy drawing a canvas, and a full-size PNG encode would show.
      const bitmap = await createImageBitmap(video, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high'
      })
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
      const greyscaleThumbnail = greyscaleThumbnailOf(thumb, bitmap)
      bitmap.close()

      const blob = await canvas.convertToBlob({ type: format, quality })
      const frameIndex = index++
      options.onFrame?.(blob, { sessionId, index: frameIndex, greyscaleThumbnail })
      const query = new URLSearchParams({
        session: sessionId,
        index: String(frameIndex),
        ts: String(Date.now())
      })
      const response = await fetch(`${options.endpoint}?${query.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': format },
        body: blob
      })
      if (!response.ok) throw new Error(`page-capture: sink responded ${response.status}`)
      return true
    }
  }
}
