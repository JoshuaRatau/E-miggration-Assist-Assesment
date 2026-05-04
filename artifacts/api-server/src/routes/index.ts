import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leadsRouter from "./leads";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leadsRouter);
router.use(statsRouter);

export default router;
