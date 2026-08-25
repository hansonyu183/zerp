/**
 * This file was auto-generated from the bundled OpenAPI contract.
 * Do not make direct changes to the file.
 */

export const contractMetaSourceHash = '0e493b4088dde1c5debd7e262ec347ca244f9ef79b76ad03f89eb47731024265'

export const nullSuccessContractPaths = [
  "/acc/book/delete",
  "/acc/subject/delete",
  "/app/user/change-password",
  "/app/user/signout",
  "/aux/{entity}/delete",
  "/bob/customer/account-delete",
  "/bob/other-unit/delete",
  "/bob/{entity}/delete"
] as const

export type NullSuccessContractPath =
  (typeof nullSuccessContractPaths)[number]

export function permitsNullSuccessData(
  path: string,
): path is NullSuccessContractPath {
  return nullSuccessContractPaths.includes(path as NullSuccessContractPath)
}
