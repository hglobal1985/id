// /v1 profile APIs: field definitions, my profile, single-field write, visibility, avatar.
// Contract: integration instruction pack, sections 4A and 4C.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { getMember } from "../db/identity";
import { readProfile, removeAvatar, writeField, writeVisibility } from "../db/profile";
import {
  AVATAR_DEFINITION,
  DEFINITIONS_VERSION,
  FIELD_KEYS,
  GROUPS,
  INFO_BLOCKS,
  fieldDefinitions,
  getFieldDefinition,
  validateFieldValue,
  type Visibility,
} from "../profile/definitions";
import { lifePathNumber, zodiacSign } from "../profile/astro";
import { bearerAuth, missingScope } from "./auth";

type C = Context<AppBindings>;

const errors = {
  401: { description: "unauthenticated", content: { "application/json": { schema: ErrorBodySchema } } },
  403: { description: "forbidden (scope)", content: { "application/json": { schema: ErrorBodySchema } } },
};
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const security = [{ bearer: [] }];

const FieldValueSchema = z.union([z.string(), z.array(z.string()), z.null()]).openapi("FieldValue");

const OptionSchema = z.object({ value: z.string(), label: z.string() });
const FieldDefinitionSchema = z
  .object({
    key: z.string(),
    group: z.string(),
    order: z.number().int(),
    label: z.string(),
    help: z.string().optional(),
    type: z.string().openapi({ description: "text | textarea | url | email | phone | date | select | tags. Unknown types: show 「請更新 app」." }),
    scope: z.string(),
    required: z.boolean(),
    read_only: z.boolean(),
    max_length: z.number().int().optional(),
    max_items: z.number().int().optional(),
    item_max_length: z.number().int().optional(),
    options: z.array(OptionSchema).optional(),
    visible_when: z.null(),
    visibility: z.object({ configurable: z.boolean(), default: z.enum(["public", "private"]) }),
  })
  .openapi("FieldDefinition");

const DefinitionsSchema = z
  .object({
    version: z.string(),
    groups: z.array(z.object({ key: z.string(), label: z.string(), order: z.number().int() })),
    fields: z.array(FieldDefinitionSchema),
    info: z.array(z.object({ key: z.string(), group: z.string(), order: z.number().int(), label: z.string(), type: z.string(), collapsed: z.boolean() })),
    avatar: z.record(z.unknown()),
  })
  .openapi("ProfileFieldDefinitions");

const ProfileFieldSchema = z.object({
  value: FieldValueSchema,
  visibility: z.enum(["public", "private"]),
  updated_at: z.string().nullable(),
});

const ProfileSchema = z
  .object({
    member_id: z.string(),
    fields: z.record(ProfileFieldSchema),
    avatar: z.object({ url: z.string().nullable(), source: z.enum(["none", "google", "upload"]), always_public: z.literal(true) }),
    info: z.object({
      member_id: z.string(),
      registration_country: z.string(),
      account_status: z.string(),
      zodiac: z.string().nullable(),
      life_path_number: z.number().int().nullable(),
    }),
  })
  .openapi("Profile");

const definitionsRoute = createRoute({
  method: "get",
  path: "/v1/profile/field-definitions",
  tags: ["profile"],
  summary: "Profile field definitions (drives every app's profile page; cache up to 1 hour)",
  security,
  responses: { 200: { description: "Definitions", content: json(DefinitionsSchema) }, ...errors },
});

const meRoute = createRoute({
  method: "get",
  path: "/v1/me/profile",
  tags: ["profile"],
  summary: "My profile (do not cache)",
  security,
  responses: { 200: { description: "Profile", content: json(ProfileSchema) }, ...errors },
});

const putFieldRoute = createRoute({
  method: "put",
  path: "/v1/me/profile/fields/{field_key}",
  tags: ["profile"],
  summary: "Write one profile field (idempotent; null clears it). Scope depends on the field.",
  security,
  request: {
    params: z.object({ field_key: z.string().max(64) }),
    body: { required: true, content: json(z.object({ value: FieldValueSchema })) },
  },
  responses: {
    200: { description: "Saved", content: json(z.object({ field_key: z.string(), value: FieldValueSchema, updated_at: z.string().nullable() }).openapi("ProfileFieldWrite")) },
    ...errors,
    404: { description: "not_found (unknown field_key)", content: json(ErrorBodySchema) },
    422: { description: "invalid_field", content: json(ErrorBodySchema) },
  },
});

const visibilityRoute = createRoute({
  method: "put",
  path: "/v1/me/profile/visibility",
  tags: ["profile"],
  summary: "Set public/private per field (partial update). The avatar is always public.",
  security,
  request: { body: { required: true, content: json(z.object({ fields: z.record(z.enum(["public", "private"])) })) } },
  responses: {
    200: { description: "Saved", content: json(z.object({ fields: z.record(z.enum(["public", "private"])) })) },
    ...errors,
    422: { description: "invalid_field", content: json(ErrorBodySchema) },
  },
});

const notAvailable = { description: "not_available (file storage is not enabled yet)", content: json(ErrorBodySchema) };
const avatarUploadRoute = createRoute({
  method: "post",
  path: "/v1/me/profile/avatar",
  tags: ["profile"],
  summary: "Upload a cropped square avatar (≤512 px, JPEG/PNG/WebP, ≤2 MB). Currently returns 501.",
  security,
  responses: { 501: notAvailable, ...errors },
});
const avatarGoogleRoute = createRoute({
  method: "post",
  path: "/v1/me/profile/avatar/google",
  tags: ["profile"],
  summary: "Use my Google picture as avatar. Currently returns 501.",
  security,
  responses: { 501: notAvailable, ...errors },
});
const avatarDeleteRoute = createRoute({
  method: "delete",
  path: "/v1/me/profile/avatar",
  tags: ["profile"],
  summary: "Remove my avatar",
  security,
  responses: {
    200: { description: "Removed", content: json(z.object({ avatar: z.object({ url: z.null(), source: z.literal("none") }) })) },
    ...errors,
  },
});

function invalid(c: C, fieldKey: string, reason: string, message: string) {
  return c.json(errorBody("invalid_field", message, c.get("requestId"), { field_key: fieldKey, reason }), 422);
}

export function registerProfileRoutes(app: OpenAPIHono<AppBindings>, deps: Deps) {
  const auth = bearerAuth(deps);
  app.use("/v1/me/*", auth);
  app.use("/v1/profile/*", auth);

  app.openapi(definitionsRoute, (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    c.header("cache-control", "private, max-age=3600");
    return c.json(
      {
        version: DEFINITIONS_VERSION,
        groups: GROUPS,
        fields: fieldDefinitions(),
        info: INFO_BLOCKS.map((b) => ({ ...b })),
        avatar: AVATAR_DEFINITION as unknown as Record<string, unknown>,
      },
      200,
    );
  });

  app.openapi(meRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    const { memberId } = c.get("auth");
    const member = await getMember(c.env.DB, memberId);
    if (!member) return c.json(errorBody("unauthenticated", "A valid access token is required", c.get("requestId")), 401) as never;
    const { values, visibility } = await readProfile(c.env.DB, memberId);
    const fields: Record<string, { value: string | string[] | null; visibility: Visibility; updated_at: string | null }> = {};
    for (const def of fieldDefinitions()) {
      const stored = values.get(def.key);
      let value = stored?.value ?? null;
      // Until the member sets a display name, show the name from sign-up.
      if (def.key === "display_name" && value === null) value = member.display_name;
      fields[def.key] = { value, visibility: visibility.get(def.key) ?? def.visibility.default, updated_at: stored?.updated_at ?? null };
    }
    const birthday = typeof fields.birthday?.value === "string" ? fields.birthday.value : null;
    return c.json(
      {
        member_id: member.id,
        fields,
        avatar: { url: member.avatar_url, source: member.avatar_source, always_public: true as const },
        info: {
          member_id: member.id,
          registration_country: member.registration_country,
          account_status: member.status,
          zodiac: birthday ? zodiacSign(birthday) : null,
          life_path_number: birthday ? lifePathNumber(birthday) : null,
        },
      },
      200,
    );
  });

  app.openapi(putFieldRoute, async (c) => {
    const { field_key } = c.req.valid("param");
    const def = getFieldDefinition(field_key);
    if (!def) return c.json(errorBody("not_found", "Unknown field", c.get("requestId"), { field_key }), 404);
    const denied = missingScope(c, [def.scope]);
    if (denied) return denied as never;
    const { value } = c.req.valid("json");
    const now = deps.now();
    const v = validateFieldValue(def, value, now);
    if (!v.ok) return invalid(c, field_key, v.reason, v.message);
    const { memberId, clientId } = c.get("auth");
    const r = await writeField(c.env.DB, field_key, v.value, { memberId, appId: clientId, requestId: c.get("requestId"), now });
    return c.json({ field_key, value: v.value, updated_at: r.updated_at }, 200);
  });

  app.openapi(visibilityRoute, async (c) => {
    const denied = missingScope(c, ["profile.visibility.write"]);
    if (denied) return denied as never;
    const { fields } = c.req.valid("json");
    const entries = Object.entries(fields);
    if (entries.length > FIELD_KEYS.length) return invalid(c, "fields", "too_many", "欄位數量過多");
    for (const [key] of entries) {
      if (key === "avatar") return invalid(c, key, "always_public", "頭像永遠公開，無法隱藏");
      if (!getFieldDefinition(key)) return invalid(c, key, "unknown_field", "沒有這個欄位");
    }
    const { memberId, clientId } = c.get("auth");
    await writeVisibility(c.env.DB, entries as [string, Visibility][], { memberId, appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    return c.json({ fields: Object.fromEntries(entries) as Record<string, Visibility> }, 200);
  });

  const unavailable = (c: C) => {
    const denied = missingScope(c, ["profile.avatar.write"]);
    if (denied) return denied as never;
    return c.json(errorBody("not_available", "目前不提供", c.get("requestId")), 501);
  };
  app.openapi(avatarUploadRoute, unavailable);
  app.openapi(avatarGoogleRoute, unavailable);

  app.openapi(avatarDeleteRoute, async (c) => {
    const denied = missingScope(c, ["profile.avatar.write"]);
    if (denied) return denied as never;
    const { memberId, clientId } = c.get("auth");
    await removeAvatar(c.env.DB, { memberId, appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    return c.json({ avatar: { url: null, source: "none" as const } }, 200);
  });
}
