import * as ImageManipulator from 'expo-image-manipulator'

/**
 * Compress an image to max 1920px on longest edge, JPEG quality 0.7.
 * Returns the compressed URI.
 */
export async function compressImage(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1920 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  )
  return result.uri
}
