/** One field that failed validation. `field` is a path such as `passengers.0.email`. */
export interface FieldError {
  field: string;
  messages: string[];
}

/** The body of every error response, whatever caused the error. */
export interface ErrorResponse {
  statusCode: number;
  /** The standard HTTP reason phrase, for example "Bad Request". */
  error: string;
  /** A message that is safe to show to the user. */
  message: string;
  /** Present only for validation errors (GEN-02). */
  errors?: FieldError[];
  path: string;
  timestamp: string;
}
