import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Typography, Spacing } from '../../constants/theme'
import Logo from '../../assets/logo.svg'

interface Props {
  title: string
  subtitle?: string
  showBack?: boolean
  right?: React.ReactNode
}

export default function ScreenHeader({ title, subtitle, showBack = false, right }: Props) {
  const router = useRouter()
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showBack && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
        )}
        <View style={styles.brand}>
          <Logo width={60} height={30} />
          <Text style={styles.brandName}>PLYTRACK</Text>
        </View>
      </View>
      <View style={styles.titleWrap}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {right ? <View>{right}</View> : <View style={styles.rightPlaceholder} />}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minWidth: 90,
  },
  backBtn: {
    marginRight: Spacing.xs,
  },
  brand: {
    alignItems: 'center',
    gap: 1,
  },
  brandName: {
    ...Typography.caption,
    color: Colors.primary,
    fontWeight: '700',
    letterSpacing: 1.5,
    fontSize: 8,
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    ...Typography.h4,
    color: Colors.white,
  },
  subtitle: {
    ...Typography.caption,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  rightPlaceholder: {
    minWidth: 90,
  },
})
