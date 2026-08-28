/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = '497bf964e7c89cd9b067b96fe2596eccda5136c170bb5a930a7bd21b1b961fc0'

export const nullSuccessContractPaths = [
  "/acc/book/delete",
  "/acc/mapping/delete-version",
  "/acc/subject/delete",
  "/app/user/change-password",
  "/app/user/signout",
  "/aux/{entity}/delete",
  "/dcl/employee/delete",
  "/dcl/operating-entity/delete",
  "/dcl/other-unit/delete",
  "/dcl/party/delete",
  "/dcl/sales-partner/delete",
  "/dcl/supplier/delete",
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
