// @vitest-environment happy-dom
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTerminalImeCandidateAnchor } from './terminal-ime-candidate-anchor'

const CELL_WIDTH = 10
const CELL_HEIGHT = 20

function nextEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()))
}

function write(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function compose(textarea: HTMLTextAreaElement, type: string, data?: string): void {
  const event = new CompositionEvent(type, { bubbles: true })
  if (data !== undefined) {
    Object.defineProperty(event, 'data', { value: data })
  }
  textarea.dispatchEvent(event)
}

describe('installTerminalImeCandidateAnchor', () => {
  beforeEach(() => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: xterm only calls measureText on this stub.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: CELL_WIDTH })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('keeps the Cursor Agent preedit on the prompt when xterm repaints mid-composition', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const terminal = new Terminal({ cols: 40, rows: 10 })
    terminal.open(container)
    const screen = terminal.element!.querySelector<HTMLElement>('.xterm-screen')!
    vi.spyOn(screen, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 40 * CELL_WIDTH, 10 * CELL_HEIGHT)
    )
    const compositionView = terminal.element!.querySelector<HTMLElement>('.composition-view')!
    installTerminalImeCandidateAnchor(terminal)
    // Cursor Agent parks the real cursor at column 0 of a blank row below its prompt.
    await write(terminal, 'Cursor Agent\r\n\r\n\r\n\r\n\r\n\r\n → abc\r\n\r\n')
    await nextFrame()

    compose(terminal.textarea!, 'compositionstart')
    compose(terminal.textarea!, 'compositionupdate', '한')
    await nextEventLoop()
    await nextEventLoop()
    expect(compositionView.style.top).toBe(`${6 * CELL_HEIGHT}px`)
    expect(compositionView.style.left).toBe(`${6 * CELL_WIDTH}px`)

    // Echoing the previous syllable repaints mid-composition and leaves the cursor parked again.
    await write(terminal, '\x1b7\x1b[7;7H가\x1b8')
    await nextFrame()
    await nextEventLoop()
    await nextEventLoop()
    expect(compositionView.style.top).toBe(`${6 * CELL_HEIGHT}px`)
    expect(compositionView.style.left).toBe(`${8 * CELL_WIDTH}px`)

    // A transient frame without the prompt must not stop later renders from re-anchoring.
    await write(terminal, '\x1b[2J\x1b[Habcd')
    await nextFrame()
    await write(terminal, '\x1b[HCursor Agent\r\n\r\n\r\n\r\n\r\n\r\n → 가\r\n\r\n')
    await nextFrame()
    await nextEventLoop()
    await nextEventLoop()
    expect(compositionView.style.top).toBe(`${6 * CELL_HEIGHT}px`)
    terminal.dispose()
  })
})
