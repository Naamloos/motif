type NwWindowEvent = 'maximize' | 'restore'

interface NwWindow {
  close(): void
  maximize(): void
  minimize(): void
  restore(): void
  on(event: NwWindowEvent, listener: () => void): void
  removeListener(event: NwWindowEvent, listener: () => void): void
}

declare const nw: {
  require: NodeJS.Require
  App: {
    dataPath: string
  }
  Window: {
    get(): NwWindow
  }
  Shell: {
    openExternal(uri: string): void
  }
  Clipboard: {
    get(type?: string): string
    set(text: string, type?: string): void
  }
}
