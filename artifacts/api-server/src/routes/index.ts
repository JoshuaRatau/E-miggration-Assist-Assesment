import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import statsRouter from "./stats";
import analyticsRouter from "./analytics";
import documentsRouter from "./documents";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(statsRouter);
router.use(analyticsRouter);
router.use(documentsRouter);

export default router;
