/** The release players see, "0.10" for package version 0.10.0. Kept in step with package.json by a test. */
export const appVersion = '0.10'

/** "0.7.0" → "0.07", "0.12.0" → "0.12". */
export function releaseName(packageVersion: string) {
  const [major, minor] = packageVersion.split('.').map(Number)
  return `${major}.${String(minor).padStart(2, '0')}`
}
