import { Router } from "express";
import { authRoutes } from "./auth/auth.routes.js";
import { songsRouter } from "./catalog/songs.routes.js";
import { artistsRouter } from "./catalog/artists.routes.js";
import { albumsRouter } from "./catalog/albums.routes.js";
import { genresRouter } from "./catalog/genres.routes.js";
import { usersRouter } from "./users/users.routes.js";
import { favoritesRouter } from "./favorites/favorites.routes.js";
import { playlistsRouter } from "./playlists/playlists.routes.js";
import { searchRouter } from "./search/search.routes.js";
import { trendingRouter, newReleasesRouter, discoverRouter } from "./search/discovery.routes.js";
import { adminRouter } from "./admin/admin.routes.js";
import { notificationsRouter, adminNotificationsRouter } from "./notifications/notifications.routes.js";
import { paymentsRouter, subscriptionsRouter } from "./payments/payments.routes.js";
import { telegramRouter } from "./telegram/telegram.routes.js";

/**
 * Versioned API surface. Route groups are registered here as they are
 * implemented: public, authenticated and administrator operations share
 * the same modular routers.
 */
export const v1Router = Router();

v1Router.use("/auth", authRoutes);
v1Router.use("/songs", songsRouter);
v1Router.use("/artists", artistsRouter);
v1Router.use("/albums", albumsRouter);
v1Router.use("/genres", genresRouter);
v1Router.use("/users", usersRouter);
v1Router.use("/favorites", favoritesRouter);
v1Router.use("/playlists", playlistsRouter);
v1Router.use("/search", searchRouter);
v1Router.use("/trending", trendingRouter);
v1Router.use("/releases/new", newReleasesRouter);
v1Router.use("/discover", discoverRouter);
v1Router.use("/notifications", notificationsRouter);
v1Router.use("/admin/notifications", adminNotificationsRouter);
v1Router.use("/admin", adminRouter);
v1Router.use("/payments", paymentsRouter);
v1Router.use("/subscriptions", subscriptionsRouter);
v1Router.use("/telegram", telegramRouter);
