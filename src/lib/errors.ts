export class OperationRejectError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'OperationRejectError';
    this.statusCode = statusCode;
  }
}
