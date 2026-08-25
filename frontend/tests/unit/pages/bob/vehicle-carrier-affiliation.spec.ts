import { describe, expect, it } from 'vitest'
import {
  bobCreateData,
  bobFormFromView,
  bobSaveData,
} from '@/pages/bob/shared/form-data'
import { getBobEntityConfig } from '@/pages/bob/shared/config'

describe('vehicle carrier affiliation form', () => {
  const config = getBobEntityConfig('vehicle')

  it('serializes only the selected closed carrier branch and explicit bulk capability', () => {
    const form = {
      ...config.emptyForm(),
      name: '自有配送车',
      plateNumber: '沪A12345',
      vehicleType: 'DIT-0003',
      carrierType: 'INTERNAL',
      carrierOperatingEntityId: 'OPERATING-ENTITY',
      carrierServiceRelationshipObjectId: 'STALE-EXTERNAL-CARRIER',
      bulkLiquidCapable: false,
    }

    expect(bobCreateData(config, form)).toMatchObject({
      carrierAffiliation: {
        type: 'INTERNAL',
        operatingEntityId: 'OPERATING-ENTITY',
      },
      bulkLiquidCapable: false,
    })
    expect(bobCreateData(config, form)).not.toHaveProperty('platformObjectId')
    expect(bobCreateData(config, form)).not.toHaveProperty(
      'carrierAffiliation.serviceRelationshipObjectId',
    )

    expect(
      bobSaveData(config, {
        ...form,
        carrierType: 'EXTERNAL',
        carrierOperatingEntityId: 'STALE-INTERNAL-CARRIER',
        carrierServiceRelationshipObjectId: 'SERVICE-RELATIONSHIP',
        bulkLiquidCapable: true,
      }),
    ).toMatchObject({
      carrierAffiliation: {
        type: 'EXTERNAL',
        serviceRelationshipObjectId: 'SERVICE-RELATIONSHIP',
      },
      bulkLiquidCapable: true,
    })
  })

  it('restores only the server-returned carrier branch into the editor', () => {
    const form = bobFormFromView(config, {
      objectId: 'VEHICLE',
      entity: 'vehicle',
      code: 'VEH-0001',
      objectRevision: 1,
      enabled: true,
      updatedAt: '2026-08-25T00:00:00Z',
      approval: {
        approvalEntryId: 'VERSION',
        versionNo: 1,
        status: 'APPROVED',
        revision: 1,
        createdBy: 'USER-1',
        createdAt: '2026-08-25T00:00:00Z',
        updatedBy: 'USER-2',
        updatedAt: '2026-08-25T00:00:00Z',
        submittedBy: 'USER-1',
        submittedAt: '2026-08-25T00:00:00Z',
        approvedBy: 'USER-2',
        approvedAt: '2026-08-25T00:00:00Z',
      },
      data: {
        name: '外部承运车',
        plateNumber: '沪A12345',
        vehicleType: 'DIT-0003',
        carrierAffiliation: {
          type: 'EXTERNAL',
          serviceRelationshipObjectId: 'SERVICE-RELATIONSHIP',
        },
        bulkLiquidCapable: true,
      },
    })

    expect(form).toMatchObject({
      carrierType: 'EXTERNAL',
      carrierOperatingEntityId: '',
      carrierServiceRelationshipObjectId: 'SERVICE-RELATIONSHIP',
      bulkLiquidCapable: true,
    })
  })
})
