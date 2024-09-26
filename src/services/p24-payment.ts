import * as P24 from "@tax1driver/node-przelewy24";
import { AbstractPaymentProcessor, PaymentProcessorContext, PaymentProcessorError, PaymentProcessorSessionResponse, PaymentProviderService, PaymentSessionStatus } from "@medusajs/medusa";
import { randomUUID } from "crypto";

type P24PaymentSessionData = Record<string, unknown> & {
    token: string,
    id: string,
}

export default class P24PaymentService extends AbstractPaymentProcessor {
    static identifier = "przelewy24";

    private paymentProviderService: PaymentProviderService;

    private paymentDescriptionTemplate: string;
    private callbackUrl: string;
    private notificationUrl: string;

    private p24Client: P24.P24;

    constructor(container: Record<string, unknown>, options: Record<string, unknown>) {
        super(container);

        this.paymentProviderService = container["paymentProviderService"] as any;

        if (typeof options["merchantId"] !== "number") throw new TypeError("merchantId is not a number");
        if (typeof options["posId"] !== "number") throw new TypeError("posId is not a number");
        if (typeof options["apiKey"] !== "string") throw new TypeError("apiKey is not a string");
        if (typeof options["crcKey"] !== "string") throw new TypeError("crcKey is not a string");
        if (typeof options["useSandbox"] !== "boolean" && typeof options["useSandbox"] !== "undefined") throw new TypeError("useSandbox should be either a boolean or undefined");
        if (typeof options["callbackUrl"] !== "string") throw new TypeError("callbackUrl is not a string");
        if (typeof options["notificationUrl"] !== "string") throw new TypeError("notificationUrl is not a string");

        this.callbackUrl = options["callbackUrl"];
        this.notificationUrl = options["notificationUrl"];
        this.paymentDescriptionTemplate = options["descriptionTemplate"] as string ?? "Payment <id>";

        this.p24Client = new P24.P24(options["merchantId"], options["posId"], options["apiKey"], options["crcKey"], {
            sandbox: options["useSandbox"] ?? false
        });

        this.p24Client.testAccess().then((v) => {
            if (!v) throw new Error();
        }).catch((err) => {
            throw new Error(`test request to Przelewy24 has failed: ${err}`);
        });
    }

    private formatString(template: string, replacements: Record<string, string>) {
        return template.replace(/<(\w+)>/g, (_, key) => {
            return replacements[key] !== undefined ? replacements[key] : `<${key}>`;
        });
    }

    private generateSessionId(cartId: string) {
        return `${cartId}.${randomUUID()}`;
    }

    async capturePayment(paymentSessionData: P24PaymentSessionData): Promise<PaymentProcessorError | P24PaymentSessionData> {
        try {
            const tx = await this.getPaymentData(paymentSessionData);

            const txVerificationResult = await this.p24Client.verifyTransaction({
                amount: tx.amount,
                currency: tx.currency,
                orderId: tx.orderId,
                sessionId: paymentSessionData.id
            });

            if (!txVerificationResult) throw new Error("failed to verify transaction");

            return {
                ...paymentSessionData,
            };
        } catch(e) {
            return {
                error: `P24: capturePayment failed: ${e.message}`
            }
        }
    }

    async authorizePayment(paymentSessionData: P24PaymentSessionData, context: Record<string, unknown>): Promise<PaymentProcessorError | { status: PaymentSessionStatus; data: P24PaymentSessionData; }> {
        try {
            const status = await this.getPaymentStatus(paymentSessionData);

            return {
                status,
                data: paymentSessionData
            };
        } catch(e) {
            return {
                error: `P24: failed to authorize transaction ${e.message}`
            };
        }
    }

    async cancelPayment(paymentSessionData: P24PaymentSessionData): Promise<PaymentProcessorError | P24PaymentSessionData> {
        return paymentSessionData;
    }

    async initiatePayment(context: PaymentProcessorContext): Promise<PaymentProcessorError | PaymentProcessorSessionResponse> {
        const sessionId = this.generateSessionId(context.resource_id);

        const order: P24.Order = {
            sessionId: sessionId,
            amount: context.amount,
            currency: context.currency_code.toUpperCase() as P24.Currency,
            description: this.formatString(this.paymentDescriptionTemplate, {
                id: sessionId,
                email: context.email,
                currency: context.currency_code,
                resourceId: context.resource_id
            }),
            email: context.email,
            country: context.billing_address.country_code.toUpperCase() as P24.Country,
            language: P24.Language.PL,
            urlReturn: this.callbackUrl,
            urlStatus: this.notificationUrl
        };

        try {
            const tx = await this.p24Client.createTransaction(order);
            const sessionData: P24PaymentSessionData = {
                id: sessionId,
                token: tx.token
            }

            return {
                session_data: sessionData
            };
        } catch(e) {
            return {
                error: `P24: failed to create transaction: ${e}`
            }
        }

    }
    
    async deletePayment(paymentSessionData: Record<string, unknown>): Promise<PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]> {
        return {};
    }

    async getPaymentStatus(paymentSessionData: P24PaymentSessionData): Promise<PaymentSessionStatus> {
        try {
            console.log(paymentSessionData);

            const tx = await this.getPaymentData(paymentSessionData);

            console.log(tx);

            if (tx.status === 1 || tx.status === 2) {
                return PaymentSessionStatus.AUTHORIZED;
            } else {
                return PaymentSessionStatus.PENDING;
            }
        } catch(e) {
            console.log(e);
            if (e.error && e.error === "Transaction not found") {
                return PaymentSessionStatus.PENDING;
            } else {
                return PaymentSessionStatus.ERROR;
            }
        }
    }

    async refundPayment(paymentSessionData: P24PaymentSessionData, refundAmount: number): Promise<PaymentProcessorError | P24PaymentSessionData> {
        try {
            const tx = await this.getPaymentData(paymentSessionData);

            const refundResult = await this.p24Client.refund({
                requestId: randomUUID(),
                refundsUuid: paymentSessionData.id,
                refunds: [
                    {
                        amount: refundAmount,
                        description: "Zwrot",
                        orderId: tx.orderId,
                        sessionId: paymentSessionData.id
                    }
                ]
            });
            
            if (!refundResult[0].status) {
                return {
                    error: `P24: refund was unsuccesful: ${refundResult[0].description}`
                };
            }

            return paymentSessionData;
        } catch(e) {
            return {
                error: `P24: failed to refund a payment: ${e.message}`
            };
        }
    }

    async retrievePayment(paymentSessionData: P24PaymentSessionData): Promise<PaymentProcessorError | Record<string, unknown>> {
        return paymentSessionData;
    }

    async getPaymentData(paymentSessionData: P24PaymentSessionData): Promise<P24.TransactionDetails> {
        const tx = await this.p24Client.getTransactionDetails(paymentSessionData.id);
        return tx;
    }

    async updatePayment(context: PaymentProcessorContext): Promise<PaymentProcessorError | PaymentProcessorSessionResponse | void> {
        // reinitiate
        return this.initiatePayment(context);
    }

    async updatePaymentData(sessionId: string, data: Record<string, unknown>): Promise<PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]> {
        return data;
    }

    verifyNotification(notification: P24.NotificationRequest): boolean {
        return this.p24Client.verifyNotification(notification);
    } 
}