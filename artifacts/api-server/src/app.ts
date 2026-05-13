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
// CORS — the web frontend may live on a different origin from the API
// (e.g. Vercel-hosted frontend talking back to the Replit-hosted API).
// `WEB_ORIGIN` env var carries a comma-separated allow-list of trusted
// origins. When unset (Replit-only / same-origin dev), we fall back to
// `origin: true` which simply reflects the request's Origin header —
// keeps local dev frictionless without weakening production once
// WEB_ORIGIN is configured.
const webOriginEnv = process.env["WEB_ORIGIN"]?.trim();
const allowedOrigins = webOriginEnv
  ? webOriginEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;

// Fail closed in production: if cross-site cookies are enabled but no
// origin allow-list is configured, `origin: true` would reflect ANY
// origin and let any site make credentialed requests on behalf of a
// signed-in admin (CSRF-style exposure). Refuse to boot rather than
// silently expose the API.
if (
  process.env.NODE_ENV === "production" &&
  process.env["CROSS_SITE_COOKIES"] === "true" &&
  !allowedOrigins
) {
  throw new Error(
    "CROSS_SITE_COOKIES=true requires WEB_ORIGIN to be set in production " +
      "(comma-separated list of trusted browser origins).",
  );
}
app.use(
  cors({
    origin: allowedOrigins
      ? (origin, cb) => {
          // Same-origin / non-browser requests (curl, server-to-server)
          // omit Origin entirely — always allow those.
          if (!origin) return cb(null, true);
          cb(null, allowedOrigins.includes(origin));
        }
      : true,
    credentials: true,
  }),
);
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
