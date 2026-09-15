import type { VouFormulaInput, VouProductQuantitySnapshotInput } from './vou.ts'
/** Input quantity precision. Padded decimal storage does not lose its original value. */
export function isInputQuantity(value: string): boolean {
  const match = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  return !!match && (match[1] ?? '').replace(/0+$/, '').length <= 2
}

function normalized(value: string): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  return `${BigInt(whole!)}.${fraction.replace(/0+$/, '')}`
}

export function sameFormulaQuantities(
  left: VouFormulaInput,
  right: VouFormulaInput,
): boolean {
  const same = (
    a: VouProductQuantitySnapshotInput,
    b: VouProductQuantitySnapshotInput,
  ) =>
    normalized(a.enteredQuantity) !== null &&
    normalized(a.enteredQuantity) === normalized(b.enteredQuantity) &&
    normalized(a.baseQuantity) !== null &&
    normalized(a.baseQuantity) === normalized(b.baseQuantity) &&
    a.enteredUnit.objectId === b.enteredUnit.objectId &&
    a.enteredUnit.code === b.enteredUnit.code &&
    a.enteredUnit.name === b.enteredUnit.name &&
    a.enteredUnit.fixedFactor === b.enteredUnit.fixedFactor
  return (
    same(left.output, right.output) &&
    left.components.length === right.components.length &&
    left.components.every(
      (row, index) =>
        row.material.objectId === right.components[index]!.material.objectId &&
        same(row.quantity, right.components[index]!.quantity),
    )
  )
}
