import type { NavigationMenuGroup } from './navigation-icons.ts'
const group: NavigationMenuGroup = {
  domain: 'custom',
  displayName: '自定义',
  resources: [],
  // @ts-expect-error Only finite semantic keys are supported, not library names.
  icon: 'mdi-folder',
}
void group
