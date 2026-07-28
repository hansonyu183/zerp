export interface PackagingProductReference {
  objectId: string
  versionId: string
  code: string
  name: string
  unit?: string
  productKind?: string
}

export interface PackagingSpecDraft {
  key: string
  packagingProduct: PackagingProductReference | null
  contentQuantity: string
  isDefault: boolean
}

export interface PackagingSpecPayload {
  packagingProductObjectId: string
  packagingProductVersionId: string
  contentQuantity: string
  isDefault: boolean
}

export function packagingSpecsFromPayload(
  specs:
    | Array<{
        packagingProductObjectId: string
        packagingProductVersionId: string
        packagingProductCode?: string
        packagingProductName?: string
        contentQuantity: string
        isDefault: boolean
      }>
    | null
    | undefined,
): PackagingSpecDraft[] {
  return (specs ?? []).map((spec) => ({
    key: crypto.randomUUID(),
    packagingProduct: {
      objectId: spec.packagingProductObjectId,
      versionId: spec.packagingProductVersionId,
      code: spec.packagingProductCode ?? '',
      name: spec.packagingProductName ?? '',
      productKind: 'PACKAGING',
    },
    contentQuantity: spec.contentQuantity,
    isDefault: spec.isDefault,
  }))
}

export function packagingSpecsPayload(
  specs: readonly PackagingSpecDraft[] | null | undefined,
): PackagingSpecPayload[] {
  return (specs ?? []).map((spec) => ({
    packagingProductObjectId: spec.packagingProduct!.objectId,
    packagingProductVersionId: spec.packagingProduct!.versionId,
    contentQuantity: spec.contentQuantity.trim(),
    isDefault: spec.isDefault,
  }))
}
