import { Router, type IRouter } from "express";
import {
  recordUnsubscribe,
  verifyUnsubscribeToken,
} from "../lib/unsubscribe";

// Phase 4 — Public, unauthenticated unsubscribe endpoint.
//
// Two routes, by design:
//   GET  /api/unsubscribe?token=…   — minimal HTML confirmation page.
//                                     Some email clients (Outlook, gmail web)
//                                     pre-fetch links; relying on GET to do
//                                     the actual write would unsubscribe the
//                                     contact without their consent. So GET
//                                     ONLY shows a "Confirm unsubscribe"
//                                     button which POSTs to the same path.
//   POST /api/unsubscribe?token=…   — performs the unsubscribe (idempotent).
//
// The List-Unsubscribe-Post = "List-Unsubscribe=One-Click" RFC-8058 path
// (used by Gmail / Apple Mail bulk one-click) maps to a direct POST without
// the confirmation page. That's already supported by the same handler.
//
// We never reveal whether the contact existed, was already unsubscribed, or
// was never on the list — every successful POST returns the same neutral
// "you're now unsubscribed" page to defeat enumeration.

const router: IRouter = Router();

function renderPage(args: {
  title: string;
  message: string;
  confirmHref?: string;
}): string {
  const { title, message, confirmHref } = args;
  const button = confirmHref
    ? `<form method="POST" action="${confirmHref}" style="margin-top:24px"><button type="submit" style="background:#0f172a;color:white;border:0;padding:12px 24px;border-radius:8px;font-size:14px;cursor:pointer">Confirm unsubscribe</button></form>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"></head><body style="font-family:system-ui,-apple-system,sans-serif;background:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0;padding:24px;color:#0f172a"><main style="max-width:480px;background:white;padding:32px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);text-align:center"><h1 style="margin:0 0 16px;font-size:20px">${title}</h1><p style="margin:0;color:#475569;line-height:1.5">${message}</p>${button}</main></body></html>`;
}

router.get("/unsubscribe", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return res
      .status(400)
      .type("html")
      .send(
        renderPage({
          title: "Link not recognised",
          message:
            "This unsubscribe link looks invalid or has been tampered with. If you keep receiving emails you didn't ask for, please reply to one and let us know.",
        }),
      );
  }
  const confirmHref = `/api/unsubscribe?token=${encodeURIComponent(token)}`;
  return res.type("html").send(
    renderPage({
      title: "Confirm unsubscribe",
      message:
        "Click the button below to stop receiving campaign messages from E-Migration Assist. Transactional updates about your existing case may still be sent.",
      confirmHref,
    }),
  );
});

router.post("/unsubscribe", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return res
      .status(400)
      .type("html")
      .send(
        renderPage({
          title: "Link not recognised",
          message:
            "This unsubscribe link is invalid. If you keep receiving emails you didn't ask for, please reply to one and let us know.",
        }),
      );
  }
  try {
    await recordUnsubscribe({
      channel: verified.channel,
      contact: verified.contact,
      source: "link",
    });
  } catch (err) {
    req.log.warn({ err }, "Unsubscribe insert failed");
    return res
      .status(500)
      .type("html")
      .send(
        renderPage({
          title: "Something went wrong",
          message:
            "We couldn't record your request. Please try again in a moment, or reply to the email and we'll handle it manually.",
        }),
      );
  }
  return res.type("html").send(
    renderPage({
      title: "You're unsubscribed",
      message:
        "We've added your contact to our suppression list. You'll no longer receive campaign messages from E-Migration Assist.",
    }),
  );
});

export default router;
