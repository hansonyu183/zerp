import { useRouter } from 'vue-router'

export function useNotFoundViewModel() {
  const router = useRouter()

  const goHome = () => router.replace('/home/dashboard')

  return { goHome }
}
