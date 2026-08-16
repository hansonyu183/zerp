export const passwordMaxLength = 256

export function passwordMeetsPolicy(
  password: string,
  minimumLength: number,
): boolean {
  const length = Array.from(password).length
  return (
    length >= minimumLength &&
    length <= passwordMaxLength &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  )
}
