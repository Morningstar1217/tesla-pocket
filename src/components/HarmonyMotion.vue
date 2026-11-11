<template>
  <view style="display:none" :motion-state="context" :change:motion-state="harmonyMotion.reset" />
</template>

<script>
export default {
  props: { context: String },
  emits: ['visibility'],
  methods: {
    onVisibility(hidden) { this.$emit('visibility', hidden) }
  }
}
</script>

<script module="harmonyMotion" lang="renderjs">
import { updateNavigationScroll } from '../lib/navigation'

export default {
  mounted() {
    this.scrollState = { anchorTop: 0, hidden: false }
    this.frame = 0
    this.tracking = false
    this.onGesture = () => {
      if (!this.tracking) this.scrollState.anchorTop = window.scrollY
      this.tracking = true
    }
    this.onScroll = () => {
      if (!this.tracking || this.frame) return
      this.frame = requestAnimationFrame(() => {
        this.frame = 0
        const previous = this.scrollState
        this.scrollState = updateNavigationScroll(previous, window.scrollY)
        if (this.scrollState.hidden !== previous.hidden) {
          this.$ownerInstance.callMethod('onVisibility', this.scrollState.hidden)
        }
      })
    }
    window.addEventListener('scroll', this.onScroll, { passive: true })
    window.addEventListener('touchmove', this.onGesture, { passive: true })
    window.addEventListener('wheel', this.onGesture, { passive: true })
  },
  beforeUnmount() {
    window.removeEventListener('scroll', this.onScroll)
    window.removeEventListener('touchmove', this.onGesture)
    window.removeEventListener('wheel', this.onGesture)
    cancelAnimationFrame(this.frame)
  },
  methods: {
    reset() {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.tracking = false
      this.scrollState = { anchorTop: window.scrollY, hidden: false }
    }
  }
}
</script>
