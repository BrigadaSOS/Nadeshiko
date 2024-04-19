import express from 'express';
import { router as AdminRoutes} from './adminRoutes'
import { router as ManagementRoutes } from './managementRoutes'
import { router as SearchRoutes } from './searchRoutes'
import { router as UserRoutes } from './userRoutes'

const router = express.Router();

router.use(AdminRoutes);
router.use(ManagementRoutes);
router.use(SearchRoutes)
router.use(UserRoutes)

export { router };