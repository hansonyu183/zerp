import type { VouType } from '@zerp/model'
// All VOU resources share the typed document API and built-in list/approval behavior.
export type DocumentDefinition = { kind: 'document'; vouType: VouType }
