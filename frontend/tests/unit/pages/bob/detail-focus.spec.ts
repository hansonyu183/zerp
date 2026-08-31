import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useDetailDrawerFocus } from '@/pages/bob/shared/detail-focus'

describe('BOB detail drawer focus', () => {
  it('moves focus into the drawer and restores the row action after close', async () => {
    const trigger = document.createElement('button')
    const drawer = document.createElement('div')
    const close = document.createElement('button')
    close.dataset.detailDrawerClose = ''
    drawer.append(close)
    document.body.append(trigger, drawer)

    const open = ref(false)
    const focus = useDetailDrawerFocus(open)
    focus.setDrawerContent(drawer)
    trigger.focus()
    focus.rememberTrigger()

    open.value = true
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(close)

    open.value = false
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(trigger)

    trigger.remove()
    drawer.remove()
  })
})
