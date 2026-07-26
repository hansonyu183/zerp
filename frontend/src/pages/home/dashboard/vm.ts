import { computed } from 'vue'
import { useSessionStore } from '@/stores/session'

export function useDashboardViewModel() {
  const session = useSessionStore()

  const displayName = computed(
    () => session.user?.displayName || session.user?.username || '用户',
  )
  const menuCount = computed(() =>
    session.menus.reduce((total, domain) => total + domain.children.length, 0),
  )

  return {
    displayName,
    menuCount,
  }
}
