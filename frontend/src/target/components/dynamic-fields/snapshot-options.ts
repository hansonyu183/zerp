import type {
  AuxSnapshot,
  ExactReference,
  StableArchiveReference,
} from '@zerp/model'
import type { SnapshotReferenceSource } from './form-fields.ts'
import type { EditOption } from './edit-fields.ts'

// Source adapters own identity semantics: AUX snapshots use id; archive references use objectId.
export function snapshotOption(
  source: SnapshotReferenceSource,
  value: object,
): EditOption {
  switch (source) {
    case 'archive-operating-entities':
    case 'archive-employees': {
      const snapshot = value as StableArchiveReference
      return {
        id: snapshot.objectId,
        name: `${snapshot.code} · ${snapshot.name}`,
        snapshot,
      }
    }
    case 'formula-materials':
    case 'external-salespeople':
    case 'channel-partners': {
      const snapshot = value as ExactReference
      return {
        id: snapshot.objectId,
        name: `${snapshot.code} · ${snapshot.name}`,
        approvalEntryId: snapshot.approvalEntryId,
        snapshot,
      }
    }
    default: {
      const snapshot = value as AuxSnapshot
      return {
        id: snapshot.id,
        name: `${snapshot.code} · ${snapshot.name}`,
        snapshot,
      }
    }
  }
}
