import 'vue'

declare module 'vue' {
  interface ComponentCustomProperties {
    // This module is injected by uni-app in the view layer.
    harmonyMotion: { reset: (...args: unknown[]) => void }
  }
}
