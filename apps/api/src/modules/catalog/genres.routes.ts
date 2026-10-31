import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { requirePermission } from "../../middleware/require-admin.js";
import { validate } from "../../middleware/validate.js";
import { apiLimiter } from "../../middleware/rate-limit.js";
import { writeAudit } from "../../middleware/audit.js";
import { ah } from "../../utils/async-handler.js";
import { conflict, unprocessable } from "../../utils/http-error.js";
import { cachedPublic, invalidateCatalogCache, supabaseService, uniqueSlug } from "./catalog.service.js";

const router = Router();

const genreCreateSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(1_000).nullable().optional(),
});

const genreUpdateSchema = genreCreateSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: "Empty update",
});
const idParam = z.object({ id: z.string().uuid() });

/** GET /genres — public, cached for 5 minutes. */
router.get(
  "/",
  apiLimiter,
  ah(async (_req, res) => {
    const genres = await cachedPublic<unknown[]>("genres:all", 300_000, async () => {
      const { data, error } = await supabaseService
        .from("genres")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw unprocessable("Genre list failed", error.message);
      return data ?? [];
    });
    res.json({ genres });
  }),
);

router.post(
  "/",
  authenticate,
  requirePermission("catalog:write"),
  validate({ body: genreCreateSchema }),
  ah(async (req, res) => {
    const body = req.body as { name: string; description?: string };
    const slug = await uniqueSlug("genres", body.name);
    const { data, error } = await supabaseService
      .from("genres")
      .insert({ name: body.name, slug, description: body.description ?? null })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") throw conflict("Genre name already exists");
      throw unprocessable("Genre creation failed", error.message);
    }
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "genre.create",
      entityType: "genre",
      entityId: (data as { id: string }).id,
      after: data,
      req,
    });
    await invalidateCatalogCache();
    res.status(201).json({ genre: data });
  }),
);

router.patch(
  "/:id",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam, body: genreUpdateSchema }),
  ah(async (req, res) => {
    const { data, error } = await supabaseService
      .from("genres")
      .update(req.body as Record<string, unknown>)
      .eq("id", req.params.id)
      .select("*")
      .single();
    if (error) throw unprocessable("Genre update failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "genre.update",
      entityType: "genre",
      entityId: req.params.id,
      after: req.body,
      req,
    });
    await invalidateCatalogCache();
    res.json({ genre: data });
  }),
);

router.delete(
  "/:id",
  authenticate,
  requirePermission("catalog:write"),
  validate({ params: idParam }),
  ah(async (req, res) => {
    const { error } = await supabaseService.from("genres").delete().eq("id", req.params.id);
    if (error) throw unprocessable("Genre delete failed", error.message);
    writeAudit({
      actorId: req.user!.id,
      actorRole: "moderator",
      action: "genre.delete",
      entityType: "genre",
      entityId: req.params.id,
      req,
    });
    await invalidateCatalogCache();
    res.status(204).end();
  }),
);

export const genresRouter = router;
