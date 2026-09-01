/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = '0651f7840496837755bf53b3ea1b0f76f5582bd99e31e8fb8ca917988feb12c6'

export const nullSuccessContractPaths = [
  "/acc/book/delete",
  "/acc/subject/delete",
  "/app/user/change-password",
  "/app/user/signout",
  "/aux/{entity}/delete",
  "/dcl/acc-mapping/delete-version",
  "/dcl/employee/delete",
  "/dcl/operating-entity/delete",
  "/dcl/other-unit/delete",
  "/dcl/party/delete",
  "/dcl/rpt-definition/delete-version",
  "/dcl/sales-partner/delete",
  "/dcl/supplier/delete",
  "/dcl/vehicle/delete",
  "/dcl/warehouse/delete"
] as const

export type NullSuccessContractPath =
  (typeof nullSuccessContractPaths)[number]

export function permitsNullSuccessData(
  path: string,
): path is NullSuccessContractPath {
  return nullSuccessContractPaths.includes(path as NullSuccessContractPath)
}
