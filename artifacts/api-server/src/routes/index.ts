import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import statsRouter from "./stats";
import analyticsRouter from "./analytics";
import documentsRouter from "./documents";
import publicStatusRouter from "./publicStatus";
import adminEmailRouter from "./adminEmail";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(statsRouter);
router.use(analyticsRouter);
router.use(documentsRouter);
router.use(publicStatusRouter);
router.use(adminEmailRouter);

export default router;
