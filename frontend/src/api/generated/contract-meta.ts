/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = 'b3b76d5718d5b32e262d43ff952702f7b3c44c50cad5a7cfa958deed43c11ae5'

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
  "/dcl/operating-entity/delete",
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
