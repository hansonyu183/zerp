import type { ResourceRegistration } from './registry.ts'
import { userPage } from '../definitions/user.ts'
// @ts-expect-error Every registration requires a definition.
const missing: ResourceRegistration = { domain: 'app', entity: 'user' }
const wrong: ResourceRegistration = {
  domain: 'app',
  entity: 'user',
  definition: userPage,
  // @ts-expect-error Page selection belongs exclusively to the Host.
  component: {},
}
void [missing, wrong]
