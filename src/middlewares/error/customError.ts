class CustomError extends Error {
  error?: { code: number; message: string }

  constructor(statusCode: number, error: string) {
    super(`${error}`)
    this.error = {
      code: statusCode,
      message: error,
    }

    Error.captureStackTrace(this, this.constructor)
  }

  serializeErrors(): { message: { code: number; message: string } }[] {
    return [{ message: this.error! }]
  }
}

export default CustomError

