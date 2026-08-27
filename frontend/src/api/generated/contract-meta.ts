/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = 'be4983b71291369fefce816947a3a56786e55c6c533ee0ec1c5891071d3c67bd'

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
