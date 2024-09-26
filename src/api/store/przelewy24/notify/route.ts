import { AbstractCartCompletionStrategy, CartService, IdempotencyKeyService, Logger, MedusaRequest, MedusaResponse } from "@medusajs/medusa";
import { NotificationRequest, P24, Verification, VerificationData } from "@tax1driver/node-przelewy24";
import P24Service from "src/services/p24";

export const POST = async (
    req: MedusaRequest<Record<string, any>>,
    res: MedusaResponse
) => {
    const p24 = req.scope.resolve<P24Service>("p24Service").getClient();
    const body = req.body as NotificationRequest;
    const logger = req.scope.resolve<Logger>("logger");
    
    if (!p24.verifyNotification(body)) {
        logger.error(`P24(${body.sessionId}): Unauthorized notification`);
        return res.status(400).send("Unauthorized");
    }

    if (body.amount !== body.originAmount) {
        logger.error(`P24(${body.sessionId}): Amount mismatch: ${body.amount} !== ${body.originAmount}`);
        return res.status(400).send("Amount mismatch");
    }

    const [ cartId, uuid ] = body.sessionId.split(".").slice(0, 2);
    const cartService = req.scope.resolve<CartService>("cartService");

    const cart = await cartService.retrieve(cartId);
    if (!cart) {
        logger.error(`P24(${body.sessionId}): Cart not found`);
        return;
    }

    if (cart.completed_at !== null) {
        logger.error(`P24(${body.sessionId}): Cart already completed`);
        return res.status(400).send("Cart already completed");
    }

    const cartCompletionStrategy = req.scope.resolve<AbstractCartCompletionStrategy>("cartCompletionStrategy");
    if (!cartCompletionStrategy) {
        logger.error(`P24(${body.sessionId}): Cart completion strategy not found`);
        return res.status(500).send("Cart completion strategy not found");
    }

    const idempotencyKeyService = req.scope.resolve<
        IdempotencyKeyService
    >("idempotencyKeyService");

    const idempotencyKey = await idempotencyKeyService.create({})

    const completeResponse = await cartCompletionStrategy.complete(cart.id, idempotencyKey, req);
    if (completeResponse.response_code !== 200) {
        logger.error(`P24(${body.sessionId}): Cart completion failed`);
        return res.status(500).send("Cart completion failed");
    }

    const verification: Verification = {
        amount: body.amount,
        currency: body.currency,
        orderId: body.orderId,
        sessionId: body.sessionId
    };

    const verified = await p24.verifyTransaction(verification);

    if (!verified) {
        logger.error(`P24(${body.sessionId}): Verification failed`);
        return res.status(400).send("Verification failed");
    }
}