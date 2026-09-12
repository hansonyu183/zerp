import { vi } from 'vitest'
import { config } from '@vue/test-utils'
import { archiveStubs } from './archive-stubs.ts'
// Stubbed component suites use desktop presentation; real Vuetify tests cover breakpoints.
vi.mock('vuetify', () => ({ useDisplay: () => ({ xs: false }) }))
Object.assign(config.global.stubs, {
  VIcon: { template: '<i />' },
  VTooltip: { template: '<span hidden><slot /></span>' },
  VDataTable: archiveStubs.VDataTable,
  VDialog: archiveStubs.VDialog,
  VCard: archiveStubs.VCard,
  VCardText: archiveStubs.VCardText,
  VCardActions: archiveStubs.VCardActions,

  VSpacer: archiveStubs.VSpacer,
})
