import {
  nextTick,
  ref,
  watch,
  type ComponentPublicInstance,
  type Ref,
} from 'vue'

export function useDetailDrawerFocus(drawerOpen: Ref<boolean>) {
  const drawerContent = ref<HTMLElement | null>(null)
  let trigger: HTMLElement | null = null

  function rememberTrigger(): void {
    trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
  }

  function setDrawerContent(
    value: Element | ComponentPublicInstance | null,
  ): void {
    drawerContent.value = value instanceof HTMLElement ? value : null
  }

  watch(drawerOpen, async (open, wasOpen) => {
    await nextTick()
    if (open) {
      drawerContent.value
        ?.querySelector<HTMLElement>('[data-detail-drawer-close]')
        ?.focus()
      return
    }
    if (wasOpen) {
      trigger?.focus()
      trigger = null
    }
  })

  return { rememberTrigger, setDrawerContent }
}
