import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Same-origin in normal Replit deployments (proxy puts web + api behind
// the same host), so default CORS is fine. `credentials: true` is set
// in case a future operator hosts the admin UI on a different origin —
// the session cookie still needs to be allowed.
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Trust the Replit reverse proxy so `req.ip` and `req.protocol` reflect
// the original client / scheme rather than the loopback hop. Required
// for Twilio webhook signature verification (URL must be reconstructed
// with the public host).
app.set("trust proxy", true);
// Capture the raw request body during JSON parsing. Not currently
// required by any route (Twilio's webhook verifies over a
// URL+sorted-params HMAC, not the raw body — see
// `lib/whatsappWebhook.ts`), but kept available for any future webhook
// provider that signs the raw bytes (Stripe, GitHub, etc.). The buffer
// is attached to the request and is GC'd when the request ends.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
// Twilio webhooks send `application/x-www-form-urlencoded` payloads —
// the urlencoded parser below populates `req.body` for them.
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
