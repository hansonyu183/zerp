import {
  formulaFromPayload,
  formulaPayload,
  type ProductFormulaDraft,
} from '@/components/formula'
import {
  packagingSpecsFromPayload,
  packagingSpecsPayload,
  type PackagingSpecDraft,
} from '@/components/packaging'

export function productPayload(
  source: Record<string, unknown>,
): Record<string, unknown> {
  return {
    formula: formulaPayload(
      source.formula as ProductFormulaDraft | null,
    ),
    packagingSpecs: packagingSpecsPayload(
      source.packagingSpecs as PackagingSpecDraft[],
    ),
  }
}

export function productFormFields(
  source: Record<string, unknown>,
): Record<string, unknown> {
  return {
    formula: formulaFromPayload(
      source.formula as Parameters<typeof formulaFromPayload>[0],
    ),
    packagingSpecs: packagingSpecsFromPayload(
      source.packagingSpecs as Parameters<
        typeof packagingSpecsFromPayload
      >[0],
    ),
  }
}

export function comparableProductValue(
  key: string,
  value: unknown,
  fromServer: boolean,
): unknown {
  if (key === 'formula') {
    return (
      formulaPayload(
        fromServer
          ? formulaFromPayload(
              value as Parameters<typeof formulaFromPayload>[0],
            )
          : (value as ProductFormulaDraft | null),
      ) ?? ''
    )
  }
  if (key === 'packagingSpecs') {
    return packagingSpecsPayload(
      fromServer
        ? packagingSpecsFromPayload(
            value as Parameters<typeof packagingSpecsFromPayload>[0],
          )
        : (value as PackagingSpecDraft[]),
    )
  }
  return value ?? ''
}
