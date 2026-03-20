import { View, Text, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import ScreenHeader from '../../components/layout/ScreenHeader'
import { Colors, Typography, Spacing } from '../../constants/theme'

export default function EntriesScreen() {
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title="Entries" subtitle="Plytrack" />
      <View style={styles.body}>
        <Text style={styles.text}>Loading...</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.dark },
  body: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  text: { ...Typography.body, color: Colors.textSecondary },
})
