import { queryTargetBobOptions } from '../../api.ts'
import type { ProductSnapshot } from './product-data.ts'
type Formula = NonNullable<ProductSnapshot['fixedFormula']>
type Material = Formula['components'][number]
export async function queryFormulaMaterials(materials: readonly Material[]) {
  const ids = [
    ...new Set(materials.map((item) => item.material.objectId).filter(Boolean)),
  ]
  const choices = new Map<
    string,
    Awaited<ReturnType<typeof queryTargetBobOptions>>['items'][number]
  >()
  for (let offset = 0; offset < ids.length; offset += 20) {
    const page = await queryTargetBobOptions('product', {
      ids: ids.slice(offset, offset + 20),
      enabled: 'true',
      behaviorProfile: 'RAW_MATERIAL',
      keyword: '',
      page: '1',
      pageSize: '20',
    })
    for (const item of page.items) choices.set(item.objectId, item)
  }
  return choices
}
export function adoptFormulaMaterials(
  formula: Formula,
  copied: readonly Material[],
  choices: Awaited<ReturnType<typeof queryFormulaMaterials>>,
): Formula {
  return {
    ...formula,
    components: formula.components.map((item) => {
      const unchanged = copied.some(
        (original) =>
          original.material.objectId === item.material.objectId &&
          original.material.approvalEntryId === item.material.approvalEntryId,
      )
      const current = choices.get(item.material.objectId)
      if (!unchanged || !item.requiresConfirmation || !current) return item
      return {
        ...item,
        material: {
          objectId: current.objectId,
          approvalEntryId: current.sourceApprovalEntryId,
          code: current.code,
          name: current.name,
        },
        resolutionStatus: 'CURRENT',
        requiresConfirmation: false,
      }
    }),
  }
}
