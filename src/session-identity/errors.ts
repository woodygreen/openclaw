// session identity errors
export class SessionIdentityError extends Error {
  constructor(
    public readonly code: "already_bound" | "strict_duplicate" | "unbound" | "mismatch",
    message: string,
  ) {
    super(message)
  }
}