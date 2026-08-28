/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = 'c06a33299a876833fd33dec921bec13c0a3ef80354b22ba392586f4c08e7452c'

export const nullSuccessContractPaths = [
  "/acc/book/delete",
  "/acc/mapping/delete-version",
  "/acc/subject/delete",
  "/app/user/change-password",
  "/app/user/signout",
  "/aux/{entity}/delete",
  "/bob/customer/account-delete",
  "/bob/{entity}/delete",
  "/dcl/employee/delete",
  "/dcl/operating-entity/delete",
  "/dcl/other-unit/delete",
  "/dcl/party/delete",
  "/dcl/sales-partner/delete",
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
