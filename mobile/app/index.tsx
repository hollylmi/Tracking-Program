import { Redirect } from 'expo-router'
import { useAuthStore } from '../store/auth'
import LoadingSpinner from '../components/ui/LoadingSpinner'

export default function Index() {
  const { isAuthenticated, isLoading } = useAuthStore()

  if (isLoading) {
    return <LoadingSpinner fullScreen />
  }

  return <Redirect href={isAuthenticated ? '/(tabs)' : '/login'} />
}
