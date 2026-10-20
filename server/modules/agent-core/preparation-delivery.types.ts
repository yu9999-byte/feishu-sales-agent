interface PreparationDeliveryScope {
  tenantId: string;
  actorOpenId: string;
  resultId: string;
}

interface PreparationDeliveryClaim extends PreparationDeliveryScope {
  text: string;
  now: Date;
}

interface PreparationDeliveryLease {
  token: string;
  chatId: string;
  text: string;
}

interface PreparationDeliveryFinish extends PreparationDeliveryScope {
  token: string;
  messageId: string | null;
}

interface ConfirmPreparationDeliveryInput extends PreparationDeliveryScope {
  operatorOpenId: string;
  expectedVersion: number;
  messageId: string;
  sentAt: Date;
  note: string;
  now: Date;
}

export type { PreparationDeliveryScope, PreparationDeliveryClaim, PreparationDeliveryLease, PreparationDeliveryFinish, ConfirmPreparationDeliveryInput };
