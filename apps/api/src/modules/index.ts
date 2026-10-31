import { Router } from "express";
import { authRoutes } from "./auth/auth.routes.js";

/**
 * Versioned API surface. Route groups are registered here as they are
 * implemented: public, authenticated and administrator operations share
 * the same modular routers.
 */
export const v1Router = Router();

v1Router.use("/auth", authRoutes);
