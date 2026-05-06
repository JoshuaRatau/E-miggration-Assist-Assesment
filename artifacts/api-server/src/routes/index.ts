import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import statsRouter from "./stats";
import analyticsRouter from "./analytics";
import documentsRouter from "./documents";
import publicStatusRouter from "./publicStatus";
import adminEmailRouter from "./adminEmail";
import adminLeadsRouter from "./adminLeads";
import adminCasesRouter from "./adminCases";
import adminEngagementsRouter from "./adminEngagements";
import adminMessagesRouter from "./adminMessages";
import whatsappWebhookRouter from "./whatsappWebhook";
import otpRouter from "./otp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(statsRouter);
router.use(analyticsRouter);
router.use(documentsRouter);
router.use(publicStatusRouter);
router.use(adminEmailRouter);
router.use(adminLeadsRouter);
router.use(adminCasesRouter);
router.use(adminEngagementsRouter);
router.use(adminMessagesRouter);
router.use(whatsappWebhookRouter);
router.use(otpRouter);

export default router;
