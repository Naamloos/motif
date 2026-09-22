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
  App: {
    dataPath: string
  }
  Window: {
    get(): NwWindow
  }
  Shell: {
    openExternal(uri: string): void
  }
}
