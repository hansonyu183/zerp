import { createTargetApiClient } from '@zerp/api-client'
import { modelBuildId } from '@zerp/model'

const client = createTargetApiClient({
  baseUrl: import.meta.env.VITE_TARGET_API_BASE_URL ?? 'http://127.0.0.1:18082',
  modelBuildId,
})

type RequestJson<Input> = Input extends { json: infer Json } ? Json : never
type PostJson<Post extends (...args: never[]) => unknown> = RequestJson<
  Parameters<Post>[0]
>

export type TargetUserQueryInput = PostJson<
  (typeof client.app.user.query)['$post']
>
export type TargetUserCreateInput = PostJson<
  (typeof client.app.user.create)['$post']
>
export type TargetUserSaveInput = PostJson<
  (typeof client.app.user.save)['$post']
>
export type TargetUserEnabledInput = PostJson<
  (typeof client.app.user.enable)['$post']
>
export type TargetRoleQueryInput = PostJson<
  (typeof client.app.role.query)['$post']
>
export type TargetRoleCreateInput = PostJson<
  (typeof client.app.role.create)['$post']
>
export type TargetRoleSaveInput = PostJson<
  (typeof client.app.role.save)['$post']
>
export type TargetRoleEnabledInput = PostJson<
  (typeof client.app.role.enable)['$post']
>
export type TargetPermissionQueryInput = PostJson<
  (typeof client.app.permission.query)['$post']
>
export type TargetEmployeeCategoryQueryInput = PostJson<
  (typeof client)['aux']['employee-category']['query']['$post']
>
export type TargetEmployeeCategoryCreateInput = PostJson<
  (typeof client)['aux']['employee-category']['create']['$post']
>
export type TargetEmployeeCategorySaveInput = PostJson<
  (typeof client)['aux']['employee-category']['save']['$post']
>
export type TargetEmployeeCategoryEnabledInput = PostJson<
  (typeof client)['aux']['employee-category']['enable']['$post']
>
export type TargetDepartmentQueryInput = PostJson<
  (typeof client)['aux']['department']['query']['$post']
>
export type TargetPositionQueryInput = PostJson<
  (typeof client)['aux']['position']['query']['$post']
>
export type TargetPositionCreateInput = PostJson<
  (typeof client)['aux']['position']['create']['$post']
>
export type TargetPositionSaveInput = PostJson<
  (typeof client)['aux']['position']['save']['$post']
>
export type TargetPositionEnabledInput = PostJson<
  (typeof client)['aux']['position']['enable']['$post']
>
export type TargetMeasurementUnitQueryInput = PostJson<
  (typeof client)['aux']['measurement-unit']['query']['$post']
>
export type TargetMeasurementUnitCreateInput = PostJson<
  (typeof client)['aux']['measurement-unit']['create']['$post']
>
export type TargetMeasurementUnitSaveInput = PostJson<
  (typeof client)['aux']['measurement-unit']['save']['$post']
>
export type TargetMeasurementUnitEnabledInput = PostJson<
  (typeof client)['aux']['measurement-unit']['enable']['$post']
>
export type TargetPaymentMethodQueryInput = PostJson<
  (typeof client)['aux']['payment-method']['query']['$post']
>
export type TargetPaymentMethodCreateInput = PostJson<
  (typeof client)['aux']['payment-method']['create']['$post']
>
export type TargetPaymentMethodSaveInput = PostJson<
  (typeof client)['aux']['payment-method']['save']['$post']
>
export type TargetPaymentMethodEnabledInput = PostJson<
  (typeof client)['aux']['payment-method']['enable']['$post']
>
export type TargetAssetCategoryQueryInput = PostJson<
  (typeof client)['aux']['asset-category']['query']['$post']
>
export type TargetAssetCategoryCreateInput = PostJson<
  (typeof client)['aux']['asset-category']['create']['$post']
>
export type TargetAssetCategorySaveInput = PostJson<
  (typeof client)['aux']['asset-category']['save']['$post']
>
export type TargetAssetCategoryEnabledInput = PostJson<
  (typeof client)['aux']['asset-category']['enable']['$post']
>
export type TargetOperatingEntityQueryInput = PostJson<
  (typeof client)['aux']['operating-entity']['query']['$post']
>
export type TargetOperatingEntityCreateInput = PostJson<
  (typeof client)['aux']['operating-entity']['create']['$post']
>
export type TargetOperatingEntitySaveInput = PostJson<
  (typeof client)['aux']['operating-entity']['save']['$post']
>
export type TargetOperatingEntityEnabledInput = PostJson<
  (typeof client)['aux']['operating-entity']['enable']['$post']
>
export type TargetEmployeeQueryInput = PostJson<
  (typeof client)['aux']['employee']['query']['$post']
>
export type TargetEmployeeCreateInput = PostJson<
  (typeof client)['aux']['employee']['create']['$post']
>
export type TargetEmployeeSaveInput = PostJson<
  (typeof client)['aux']['employee']['save']['$post']
>
export type TargetEmployeeEnabledInput = PostJson<
  (typeof client)['aux']['employee']['enable']['$post']
>
export type TargetWarehouseQueryInput = PostJson<
  (typeof client)['aux']['warehouse']['query']['$post']
>
export type TargetWarehouseCreateInput = PostJson<
  (typeof client)['aux']['warehouse']['create']['$post']
>
export type TargetWarehouseSaveInput = PostJson<
  (typeof client)['aux']['warehouse']['save']['$post']
>
export type TargetWarehouseEnabledInput = PostJson<
  (typeof client)['aux']['warehouse']['enable']['$post']
>
export type TargetWarehouseDeleteInput = PostJson<
  (typeof client)['aux']['warehouse']['delete']['$post']
>
export type TargetFundAccountQueryInput = PostJson<
  (typeof client)['aux']['fund-account']['query']['$post']
>
export type TargetFundAccountCreateInput = PostJson<
  (typeof client)['aux']['fund-account']['create']['$post']
>
export type TargetFundAccountSaveInput = PostJson<
  (typeof client)['aux']['fund-account']['save']['$post']
>
export type TargetFundAccountEnabledInput = PostJson<
  (typeof client)['aux']['fund-account']['enable']['$post']
>
export type TargetFundAccountDeleteInput = PostJson<
  (typeof client)['aux']['fund-account']['delete']['$post']
>
export type TargetVehicleQueryInput = PostJson<
  (typeof client)['aux']['vehicle']['query']['$post']
>
export type TargetVehicleCreateInput = PostJson<
  (typeof client)['aux']['vehicle']['create']['$post']
>
export type TargetVehicleSaveInput = PostJson<
  (typeof client)['aux']['vehicle']['save']['$post']
>
export type TargetVehicleEnabledInput = PostJson<
  (typeof client)['aux']['vehicle']['enable']['$post']
>
export type TargetVehicleDeleteInput = PostJson<
  (typeof client)['aux']['vehicle']['delete']['$post']
>
export type TargetAuxReferenceQueryInput = PostJson<
  (typeof client)['aux']['reference']['query']['$post']
>
export type TargetVouReferenceQueryInput = PostJson<
  (typeof client)['vou']['reference']['query']['$post']
>
export type TargetBobReferenceQueryInput = PostJson<
  (typeof client)['bob']['reference']['query']['$post']
>
export type TargetSupplierQueryInput = PostJson<
  (typeof client)['bob']['supplier']['query']['$post']
>
export type TargetSupplierEnabledInput = PostJson<
  (typeof client)['bob']['supplier']['enable']['$post']
>
export type TargetSupplierSubmissionQueryInput = PostJson<
  (typeof client)['bob']['supplier']['submission-query']['$post']
>
export type TargetSupplierSubmissionGetInput = PostJson<
  (typeof client)['bob']['supplier']['submission-get']['$post']
>
export type TargetSupplierSubmitInput = PostJson<
  (typeof client)['bob']['supplier']['submit-new']['$post']
>
export type TargetSupplierReviewInput = PostJson<
  (typeof client)['bob']['supplier']['approve']['$post']
>
export type TargetSupplierRejectInput = PostJson<
  (typeof client)['bob']['supplier']['reject']['$post']
>
export type TargetOtherUnitQueryInput = PostJson<
  (typeof client)['bob']['other-unit']['query']['$post']
>
export type TargetOtherUnitEnabledInput = PostJson<
  (typeof client)['bob']['other-unit']['enable']['$post']
>
export type TargetOtherUnitSubmissionQueryInput = PostJson<
  (typeof client)['bob']['other-unit']['submission-query']['$post']
>
export type TargetOtherUnitSubmissionGetInput = PostJson<
  (typeof client)['bob']['other-unit']['submission-get']['$post']
>
export type TargetOtherUnitSubmitInput = PostJson<
  (typeof client)['bob']['other-unit']['submit-new']['$post']
>
export type TargetOtherUnitReviewInput = PostJson<
  (typeof client)['bob']['other-unit']['approve']['$post']
>
export type TargetOtherUnitRejectInput = PostJson<
  (typeof client)['bob']['other-unit']['reject']['$post']
>
export type TargetSalesPartnerQueryInput = PostJson<
  (typeof client)['bob']['sales-partner']['query']['$post']
>
export type TargetSalesPartnerEnabledInput = PostJson<
  (typeof client)['bob']['sales-partner']['enable']['$post']
>
export type TargetSalesPartnerSubmissionQueryInput = PostJson<
  (typeof client)['bob']['sales-partner']['submission-query']['$post']
>
export type TargetSalesPartnerSubmissionGetInput = PostJson<
  (typeof client)['bob']['sales-partner']['submission-get']['$post']
>
export type TargetSalesPartnerSubmitInput = PostJson<
  (typeof client)['bob']['sales-partner']['submit-new']['$post']
>
export type TargetSalesPartnerReviewInput = PostJson<
  (typeof client)['bob']['sales-partner']['approve']['$post']
>
export type TargetSalesPartnerRejectInput = PostJson<
  (typeof client)['bob']['sales-partner']['reject']['$post']
>

export class TargetApiError extends Error {
  readonly errorKey: string
  readonly requestId: string
  readonly data: unknown

  constructor(
    errorKey: string,
    message: string,
    requestId: string,
    data: unknown = null,
  ) {
    super(message)
    this.name = 'TargetApiError'
    this.errorKey = errorKey
    this.requestId = requestId
    this.data = data
  }
}

export async function restoreTargetSession() {
  const payload = await (
    await client.session.auth.restore.$post({ json: {} })
  ).json()
  if (payload.code !== 0 || !payload.data)
    throw new TargetApiError(
      payload.errorKey,
      payload.message,
      payload.requestId,
      payload.data,
    )
  return payload.data
}

export async function signInTarget(code: string, password: string) {
  const payload = await (
    await client.session.auth.signin.$post({ json: { code, password } })
  ).json()
  if (payload.code !== 0 || !payload.data)
    throw new TargetApiError(
      payload.errorKey,
      payload.message,
      payload.requestId,
      payload.data,
    )
  return payload.data
}

export async function getTargetBranding() {
  return unwrapTarget(
    await (await client.session.app.get.$post({ json: {} })).json(),
  )
}

export async function getTargetProfile(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.session.user.get.$post({ json: {} }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function saveTargetProfile(
  csrfToken: string,
  input: { name: string; avatarUrl?: string | null },
) {
  return unwrapTarget(
    await (
      await client.session.user.save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function changeTargetPassword(
  csrfToken: string,
  input: { currentPassword: string; newPassword: string },
) {
  return unwrapTarget(
    await (
      await client.session.user['change-password'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function signOutTarget(csrfToken: string) {
  return unwrapTarget(
    await (
      await client.session.auth.signout.$post(
        { json: {} },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetUsers(
  csrfToken: string,
  input: TargetUserQueryInput = {
    keyword: '',
    page: 1,
    pageSize: 20,
  },
) {
  return unwrapTarget(
    await (
      await client.app.user.query.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function getTargetUser(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.app.user.get.$post({ json: { id } }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function createTargetUser(
  csrfToken: string,
  input: TargetUserCreateInput,
) {
  return unwrapTarget(
    await (
      await client.app.user.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetUser(
  csrfToken: string,
  input: TargetUserSaveInput,
) {
  return unwrapTarget(
    await (
      await client.app.user.save.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function setTargetUserEnabled(
  csrfToken: string,
  input: TargetUserEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled ? client.app.user.enable : client.app.user.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetRoles(
  csrfToken: string,
  input: TargetRoleQueryInput,
) {
  return unwrapTarget(
    await (
      await client.app.role.query.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function getTargetRole(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.app.role.get.$post({ json: { id } }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function createTargetRole(
  csrfToken: string,
  input: TargetRoleCreateInput,
) {
  return unwrapTarget(
    await (
      await client.app.role.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetRole(
  csrfToken: string,
  input: TargetRoleSaveInput,
) {
  return unwrapTarget(
    await (
      await client.app.role.save.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function setTargetRoleEnabled(
  csrfToken: string,
  input: TargetRoleEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled ? client.app.role.enable : client.app.role.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetPermissions(
  csrfToken: string,
  input: TargetPermissionQueryInput,
) {
  return unwrapTarget(
    await (
      await client.app.permission.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetEmployeeCategories(
  csrfToken: string,
  input: TargetEmployeeCategoryQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux['employee-category'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetEmployeeCategory(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux['employee-category'].get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function createTargetEmployeeCategory(
  csrfToken: string,
  input: TargetEmployeeCategoryCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux['employee-category'].create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetEmployeeCategory(
  csrfToken: string,
  input: TargetEmployeeCategorySaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux['employee-category'].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetEmployeeCategoryEnabled(
  csrfToken: string,
  input: TargetEmployeeCategoryEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux['employee-category'].enable
    : client.aux['employee-category'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetDepartments(
  csrfToken: string,
  input: TargetDepartmentQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux.department.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetPositions(
  csrfToken: string,
  input: TargetPositionQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux.position.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetPosition(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux.position.get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function createTargetPosition(
  csrfToken: string,
  input: TargetPositionCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux.position.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetPosition(
  csrfToken: string,
  input: TargetPositionSaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux.position.save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetPositionEnabled(
  csrfToken: string,
  input: TargetPositionEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux.position.enable
    : client.aux.position.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetMeasurementUnits(
  csrfToken: string,
  input: TargetMeasurementUnitQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux['measurement-unit'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function getTargetMeasurementUnit(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux['measurement-unit'].get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function createTargetMeasurementUnit(
  csrfToken: string,
  input: TargetMeasurementUnitCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux['measurement-unit'].create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function saveTargetMeasurementUnit(
  csrfToken: string,
  input: TargetMeasurementUnitSaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux['measurement-unit'].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function setTargetMeasurementUnitEnabled(
  csrfToken: string,
  input: TargetMeasurementUnitEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux['measurement-unit'].enable
    : client.aux['measurement-unit'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetPaymentMethods(
  csrfToken: string,
  input: TargetPaymentMethodQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux['payment-method'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function getTargetPaymentMethod(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux['payment-method'].get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function createTargetPaymentMethod(
  csrfToken: string,
  input: TargetPaymentMethodCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux['payment-method'].create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function saveTargetPaymentMethod(
  csrfToken: string,
  input: TargetPaymentMethodSaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux['payment-method'].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function setTargetPaymentMethodEnabled(
  csrfToken: string,
  input: TargetPaymentMethodEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux['payment-method'].enable
    : client.aux['payment-method'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetAssetCategories(
  csrfToken: string,
  input: TargetAssetCategoryQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux['asset-category'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetAssetCategory(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux['asset-category'].get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function createTargetAssetCategory(
  csrfToken: string,
  input: TargetAssetCategoryCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux['asset-category'].create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetAssetCategory(
  csrfToken: string,
  input: TargetAssetCategorySaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux['asset-category'].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetAssetCategoryEnabled(
  csrfToken: string,
  input: TargetAssetCategoryEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux['asset-category'].enable
    : client.aux['asset-category'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetOperatingEntities(
  csrfToken: string,
  input: TargetOperatingEntityQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux['operating-entity'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetOperatingEntity(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux['operating-entity'].get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function createTargetOperatingEntity(
  csrfToken: string,
  input: TargetOperatingEntityCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux['operating-entity'].create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetOperatingEntity(
  csrfToken: string,
  input: TargetOperatingEntitySaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux['operating-entity'].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetOperatingEntityEnabled(
  csrfToken: string,
  input: TargetOperatingEntityEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux['operating-entity'].enable
    : client.aux['operating-entity'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetEmployees(
  csrfToken: string,
  input: TargetEmployeeQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux.employee.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetEmployee(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux.employee.get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function createTargetEmployee(
  csrfToken: string,
  input: TargetEmployeeCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux.employee.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function saveTargetEmployee(
  csrfToken: string,
  input: TargetEmployeeSaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux.employee.save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetEmployeeEnabled(
  csrfToken: string,
  input: TargetEmployeeEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux.employee.enable
    : client.aux.employee.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetWarehouses(
  csrfToken: string,
  input: TargetWarehouseQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux.warehouse.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function getTargetWarehouse(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux.warehouse.get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function createTargetWarehouse(
  csrfToken: string,
  input: TargetWarehouseCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux.warehouse.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function saveTargetWarehouse(
  csrfToken: string,
  input: TargetWarehouseSaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux.warehouse.save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function setTargetWarehouseEnabled(
  csrfToken: string,
  input: TargetWarehouseEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux.warehouse.enable
    : client.aux.warehouse.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function deleteTargetWarehouse(
  csrfToken: string,
  input: TargetWarehouseDeleteInput,
) {
  return unwrapTarget(
    await (
      await client.aux.warehouse.delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetFundAccounts(
  csrfToken: string,
  input: TargetFundAccountQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux['fund-account'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function getTargetFundAccount(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux['fund-account'].get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function createTargetFundAccount(
  csrfToken: string,
  input: TargetFundAccountCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux['fund-account'].create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function saveTargetFundAccount(
  csrfToken: string,
  input: TargetFundAccountSaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux['fund-account'].save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function setTargetFundAccountEnabled(
  csrfToken: string,
  input: TargetFundAccountEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux['fund-account'].enable
    : client.aux['fund-account'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function deleteTargetFundAccount(
  csrfToken: string,
  input: TargetFundAccountDeleteInput,
) {
  return unwrapTarget(
    await (
      await client.aux['fund-account'].delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetVehicles(
  csrfToken: string,
  input: TargetVehicleQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux.vehicle.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function getTargetVehicle(csrfToken: string, id: string) {
  return unwrapTarget(
    await (
      await client.aux.vehicle.get.$post(
        { json: { id } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function createTargetVehicle(
  csrfToken: string,
  input: TargetVehicleCreateInput,
) {
  return unwrapTarget(
    await (
      await client.aux.vehicle.create.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function saveTargetVehicle(
  csrfToken: string,
  input: TargetVehicleSaveInput,
) {
  return unwrapTarget(
    await (
      await client.aux.vehicle.save.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function setTargetVehicleEnabled(
  csrfToken: string,
  input: TargetVehicleEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.aux.vehicle.enable
    : client.aux.vehicle.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function deleteTargetVehicle(
  csrfToken: string,
  input: TargetVehicleDeleteInput,
) {
  return unwrapTarget(
    await (
      await client.aux.vehicle.delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetAuxReferences(
  csrfToken: string,
  input: TargetAuxReferenceQueryInput,
) {
  return unwrapTarget(
    await (
      await client.aux.reference.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function queryTargetVouReferences(
  csrfToken: string,
  input: TargetVouReferenceQueryInput,
) {
  return unwrapTarget(
    await (
      await client.vou.reference.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}
export async function queryTargetBobReferences(
  csrfToken: string,
  input: TargetBobReferenceQueryInput,
) {
  return unwrapTarget(
    await (
      await client.bob.reference.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetSuppliers(
  csrfToken: string,
  input: TargetSupplierQueryInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier.query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetSupplier(csrfToken: string, objectId: string) {
  return unwrapTarget(
    await (
      await client.bob.supplier.get.$post(
        { json: { objectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetSupplierEnabled(
  csrfToken: string,
  input: TargetSupplierEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.bob.supplier.enable
    : client.bob.supplier.disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetOtherUnits(
  csrfToken: string,
  input: TargetOtherUnitQueryInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetOtherUnit(csrfToken: string, objectId: string) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].get.$post(
        { json: { objectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetOtherUnitEnabled(
  csrfToken: string,
  input: TargetOtherUnitEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.bob['other-unit'].enable
    : client.bob['other-unit'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetSalesPartners(
  csrfToken: string,
  input: TargetSalesPartnerQueryInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].query.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetSalesPartner(
  csrfToken: string,
  objectId: string,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].get.$post(
        { json: { objectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function setTargetSalesPartnerEnabled(
  csrfToken: string,
  input: TargetSalesPartnerEnabledInput,
  enabled: boolean,
) {
  const endpoint = enabled
    ? client.bob['sales-partner'].enable
    : client.bob['sales-partner'].disable
  return unwrapTarget(
    await (
      await endpoint.$post({ json: input }, csrfHeaders(csrfToken))
    ).json(),
  )
}

export async function queryTargetSupplierSubmissions(
  csrfToken: string,
  input: TargetSupplierSubmissionQueryInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier['submission-query'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetSupplierSubmission(
  csrfToken: string,
  input: TargetSupplierSubmissionGetInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier['submission-get'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetSupplierVersions(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier.versions.$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetSupplierAuditHistory(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier['audit-history'].$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitNewTargetSupplier(
  csrfToken: string,
  input: TargetSupplierSubmitInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier['submit-new'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitChangeTargetSupplier(
  csrfToken: string,
  input: TargetSupplierSubmitInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier['submit-change'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function approveTargetSupplier(
  csrfToken: string,
  input: TargetSupplierReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier.approve.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function rejectTargetSupplier(
  csrfToken: string,
  input: TargetSupplierRejectInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier.reject.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function unrejectTargetSupplier(
  csrfToken: string,
  input: TargetSupplierReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier.unreject.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function unapproveTargetSupplier(
  csrfToken: string,
  input: TargetSupplierRejectInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier.unapprove.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function deleteTargetSupplier(
  csrfToken: string,
  input: TargetSupplierReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob.supplier.delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetOtherUnitSubmission(
  csrfToken: string,
  input: TargetOtherUnitSubmissionGetInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit']['submission-get'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetOtherUnitVersions(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].versions.$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitNewTargetOtherUnit(
  csrfToken: string,
  input: TargetOtherUnitSubmitInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit']['submit-new'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitChangeTargetOtherUnit(
  csrfToken: string,
  input: TargetOtherUnitSubmitInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit']['submit-change'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetOtherUnitSubmissions(
  csrfToken: string,
  input: TargetOtherUnitSubmissionQueryInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit']['submission-query'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetOtherUnitAuditHistory(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit']['audit-history'].$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function approveTargetOtherUnit(
  csrfToken: string,
  input: TargetOtherUnitReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].approve.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function rejectTargetOtherUnit(
  csrfToken: string,
  input: TargetOtherUnitRejectInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].reject.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function unrejectTargetOtherUnit(
  csrfToken: string,
  input: TargetOtherUnitReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].unreject.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function unapproveTargetOtherUnit(
  csrfToken: string,
  input: TargetOtherUnitRejectInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].unapprove.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function deleteTargetOtherUnit(
  csrfToken: string,
  input: TargetOtherUnitReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob['other-unit'].delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function getTargetSalesPartnerSubmission(
  csrfToken: string,
  input: TargetSalesPartnerSubmissionGetInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner']['submission-get'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetSalesPartnerVersions(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].versions.$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitNewTargetSalesPartner(
  csrfToken: string,
  input: TargetSalesPartnerSubmitInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner']['submit-new'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function submitChangeTargetSalesPartner(
  csrfToken: string,
  input: TargetSalesPartnerSubmitInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner']['submit-change'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetSalesPartnerSubmissions(
  csrfToken: string,
  input: TargetSalesPartnerSubmissionQueryInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner']['submission-query'].$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function queryTargetSalesPartnerAuditHistory(
  csrfToken: string,
  subjectId: string,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner']['audit-history'].$post(
        { json: { subjectId } },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function approveTargetSalesPartner(
  csrfToken: string,
  input: TargetSalesPartnerReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].approve.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function rejectTargetSalesPartner(
  csrfToken: string,
  input: TargetSalesPartnerRejectInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].reject.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function unrejectTargetSalesPartner(
  csrfToken: string,
  input: TargetSalesPartnerReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].unreject.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function unapproveTargetSalesPartner(
  csrfToken: string,
  input: TargetSalesPartnerRejectInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].unapprove.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

export async function deleteTargetSalesPartner(
  csrfToken: string,
  input: TargetSalesPartnerReviewInput,
) {
  return unwrapTarget(
    await (
      await client.bob['sales-partner'].delete.$post(
        { json: input },
        csrfHeaders(csrfToken),
      )
    ).json(),
  )
}

type TargetSuccessData<T> = T extends { code: 0; data: infer Data }
  ? Data
  : never

function unwrapTarget<
  T extends {
    code: number
    errorKey: string
    message: string
    requestId: string
    data: unknown
  },
>(payload: T): Promise<TargetSuccessData<T>>
function unwrapTarget(payload: unknown): Promise<unknown>
async function unwrapTarget(payload: unknown): Promise<unknown> {
  if (
    !isTargetEnvelope(payload) ||
    payload.code !== 0 ||
    payload.data === null
  ) {
    const failure = isTargetEnvelope(payload) ? payload : undefined
    throw new TargetApiError(
      failure?.errorKey ?? 'invalid_response',
      failure?.message ?? 'invalid target response',
      failure?.requestId ?? '',
      failure?.data,
    )
  }
  return payload.data
}

function isTargetEnvelope(payload: unknown): payload is {
  code: number
  errorKey: string
  message: string
  requestId: string
  data: unknown
} {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Record<string, unknown>
  return (
    typeof value.code === 'number' &&
    typeof value.errorKey === 'string' &&
    typeof value.message === 'string' &&
    typeof value.requestId === 'string' &&
    'data' in value
  )
}

function csrfHeaders(csrfToken: string) {
  return { headers: { 'X-CSRF-Token': csrfToken } }
}
