import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { Colors } from '../../constants/theme'

interface Props {
  fullScreen?: boolean
  size?: 'small' | 'large'
  color?: string
}

export default function LoadingSpinner({
  fullScreen = false,
  size = 'large',
  color = Colors.primary,
}: Props) {
  if (fullScreen) {
    return (
      <View style={styles.fullScreen}>
        <ActivityIndicator size={size} color={color} />
      </View>
    )
  }
  return <ActivityIndicator size={size} color={color} />
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    backgroundColor: Colors.dark,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
