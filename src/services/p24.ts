import { TransactionBaseService } from "@medusajs/medusa"
import { P24 as P24Api } from "@tax1driver/node-przelewy24";

export default class P24Service extends TransactionBaseService {
    private callbackUrl: string;
    private notificationUrl: string;
    private p24Client: P24Api;

    constructor(container: any, options: any) {
        super(container)
        // options contains plugin options
        if (typeof options["merchantId"] !== "number") throw new TypeError("merchantId is not a number");
        if (typeof options["posId"] !== "number") throw new TypeError("posId is not a number");
        if (typeof options["apiKey"] !== "string") throw new TypeError("apiKey is not a string");
        if (typeof options["crcKey"] !== "string") throw new TypeError("crcKey is not a string");
        if (typeof options["useSandbox"] !== "boolean" && typeof options["useSandbox"] !== "undefined") throw new TypeError("useSandbox should be either a boolean or undefined");
        if (typeof options["callbackUrl"] !== "string") throw new TypeError("callbackUrl is not a string");
        if (typeof options["notificationUrl"] !== "string") throw new TypeError("notificationUrl is not a string");

        this.callbackUrl = options["callbackUrl"];
        this.notificationUrl = options["notificationUrl"];

        this.p24Client = new P24Api(options["merchantId"], options["posId"], options["apiKey"], options["crcKey"], {
            sandbox: options["useSandbox"] ?? false
        });

        this.p24Client.testAccess().then((v) => {
            if (!v) throw new Error();
        }).catch((err) => {
            throw new Error(`test request to Przelewy24 has failed: ${err}`);
        });
    }
    
    getClient() {
        return this.p24Client;
    }
}