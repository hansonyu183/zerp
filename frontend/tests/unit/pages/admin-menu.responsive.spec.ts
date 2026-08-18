import { describe, expect, it } from 'vitest'
import menuSource from '@/pages/app/menu/Menu.vue?raw'

describe('menu management responsive layout', () => {
  it('stacks editable routes into labeled cards at phone widths', () => {
    const phoneStyles = menuSource.split('@media (max-width: 700px)')[1]

    expect(phoneStyles).toBeDefined()
    expect(phoneStyles).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(phoneStyles).toContain('.route-meta,')
    expect(phoneStyles).toContain('.route-actions')
    expect(menuSource).toContain('class="route-meta-label">路由键')
    expect(menuSource).toContain('class="route-meta-label">地址')
    expect(menuSource).toContain('class="route-meta-label">权限')
  })
})
