/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = 'd3375c95d0692ec4d721ab7fcb5224d95ad1e871e84249e71704ffb0cf06fa86'

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
