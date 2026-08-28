/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = '2c28300148b649d940ab8882f6a10d10d461cc91e6c21813267632c3723567c6'

export const nullSuccessContractPaths = [
  "/acc/book/delete",
  "/acc/mapping/delete-version",
  "/acc/subject/delete",
  "/app/user/change-password",
  "/app/user/signout",
  "/aux/{entity}/delete",
  "/bob/customer/account-delete",
  "/bob/other-unit/delete",
  "/bob/{entity}/delete",
  "/dcl/employee/delete",
  "/dcl/operating-entity/delete",
  "/dcl/party/delete",
  "/dcl/vehicle/delete",
  "/dcl/warehouse/delete",
  "/rpt/definition/delete",
  "/rpt/definition/delete-version"
] as const

export type NullSuccessContractPath =
  (typeof nullSuccessContractPaths)[number]

export function permitsNullSuccessData(
  path: string,
): path is NullSuccessContractPath {
  return nullSuccessContractPaths.includes(path as NullSuccessContractPath)
}
