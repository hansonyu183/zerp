// Fixed user intents choose their icon here; icons never determine action eligibility.
export const actionIcons = {
  edit: 'mdi-pencil-outline',
  clone: 'mdi-content-copy',
  enable: 'mdi-check-circle-outline',
  disable: 'mdi-cancel',
  view: 'mdi-eye-outline',
  open: 'mdi-eye-outline',
  refresh: 'mdi-refresh',
  navigation: 'mdi-menu',
  lightTheme: 'mdi-weather-sunny',
  darkTheme: 'mdi-weather-night',
  account: 'mdi-account-edit-outline',
  password: 'mdi-lock-reset',
  signOut: 'mdi-logout',
  expand: 'mdi-chevron-down',
  create: 'mdi-plus',
  search: 'mdi-magnify',
  save: 'mdi-content-save-outline',
  submit: 'mdi-send-outline',
  add: 'mdi-plus-circle-outline',
  remove: 'mdi-minus-circle-outline',
  delete: 'mdi-delete-outline',
  cancel: 'mdi-close',
  confirm: 'mdi-check',
  resolve: 'mdi-clipboard-check-outline',
  calculate: 'mdi-calculator',
  trial: 'mdi-play-outline',
  retry: 'mdi-refresh',
  previous: 'mdi-chevron-left',
  next: 'mdi-chevron-right',
  export: 'mdi-file-export-outline',
  link: 'mdi-link-plus',
} as const

export function actionIcon(key: string): string | undefined {
  return Object.hasOwn(actionIcons, key)
    ? actionIcons[key as keyof typeof actionIcons]
    : undefined
}
