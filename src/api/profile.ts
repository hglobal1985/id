// /v1 profile APIs: field definitions, my profile, single-field write, visibility, avatar.
// Contract: integration instruction pack, sections 4A and 4C.
import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { AppBindings } from "../env";
import type { Deps } from "../deps";
import { ErrorBodySchema, errorBody } from "../errors";
import { getMember } from "../db/identity";
import { AVATAR_MAX_BYTES, readProfile, removeAvatar, saveAvatarUpload, sniffImage, useGoogleAvatar, writeField, writeVisibility } from "../db/profile";
import { canonicalTerms, recordTerms, suggestTerms } from "../db/vocab";
import { POOLS, isPool, poolOfField } from "../vocab/terms";
import { randomMotto } from "../profile/mottos";
import { AMWAY_KEYS } from "../amway/fields";
import { loadLayout } from "../db/layout";
import { applyOrder } from "../profile/layout";
import {
  AVATAR_DEFINITION,
  MEMBER_NUMBER_DEFINITION,
  memberNumberCountryOptions,
  DEFINITIONS_VERSION,
  FIELD_KEYS,
  GROUPS,
  INFO_BLOCKS,
  fieldDefinitions,
  getFieldDefinition,
  validateFieldValue,
  type Visibility,
} from "../profile/definitions";
import { lifeChartOf, zodiacSign } from "../profile/astro";
import { bearerAuth, missingScope } from "./auth";
import { ensureMemberNumber } from "../db/member-numbers";
import { putMemberNumbers } from "./member-number";
import { resolveIssuer } from "../oidc/config";

type C = Context<AppBindings>;

const errors = {
  401: { description: "unauthenticated", content: { "application/json": { schema: ErrorBodySchema } } },
  403: { description: "forbidden (scope)", content: { "application/json": { schema: ErrorBodySchema } } },
};
const json = (schema: z.ZodTypeAny) => ({ "application/json": { schema } });
const security = [{ bearer: [] }];

const MemberNumberEntrySchema = z.object({ country: z.string(), number: z.string() }).openapi("MemberNumberEntry");
const FieldValueSchema = z.union([z.string(), z.array(z.string()), z.array(MemberNumberEntrySchema), z.null()]).openapi("FieldValue");

const OptionSchema = z.object({ value: z.string(), label: z.string() });
const FieldDefinitionSchema = z
  .object({
    key: z.string(),
    group: z.string(),
    order: z.number().int(),
    label: z.string(),
    help: z.string().optional(),
    type: z.string().openapi({ description: "text | textarea | url | email | phone | date | select | tags. Unknown types: show 「請更新 app」." }),
    suggest: z.string().optional().openapi({ description: "Vocabulary for related words: GET /v1/vocab/suggestions?pool=<suggest>&q=<typed>. Free typing is always allowed." }),
    ui: z.string().optional().openapi({ description: "autocomplete: a type-to-search box over `options` (never a native select)." }),
    row: z.object({ key: z.string(), label: z.string(), optional_after: z.string().optional() }).optional().openapi({ description: "Fields with the same row.key share one line; a row with optional_after stays hidden until the member adds it (「新增碩士學歷」)." }),
    scope: z.string(),
    required: z.boolean(),
    read_only: z.boolean(),
    max_length: z.number().int().optional(),
    max_items: z.number().int().optional(),
    label_when_amway: z.string().optional(),
    help_when_amway: z.string().optional().openapi({ description: "member_number: note beside the field when 我是Amway會員 is on" }),
    help_when_not_amway: z.string().optional().openapi({ description: "member_number: note beside the field when 我是Amway會員 is off (the number is random and cannot be changed)" }),
    max_items_when_amway: z.number().int().optional(),
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
  label: z.string().optional(),
  note: z.string().optional().openapi({ description: "member_number only: 隨機產生，不可修改 (Amway off) / 建議修改會員編號 (Amway on)" }),
  max_items: z.number().int().optional(),
  public_url: z.string().nullable().optional(),
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
      talent_number: z.string().nullable().openapi({ description: "Talent numbers of the life number chart, joined with 、" }),
    }),
    derived: z.object({ visibility: z.enum(["public", "private"]) }).openapi({ description: "Visibility of the zodiac and life number chart (key `derived` in PUT /v1/me/profile/visibility)." }),
    life_chart: z.record(z.unknown()).nullable().openapi({ description: "Life number chart data (zodiac, birthday, talent and life numbers; rings per digit 1-9) when a birthday is set." }),
  })
  .openapi("Profile");

const definitionsRoute = createRoute({
  method: "get",
  path: "/v1/profile/field-definitions",
  tags: ["profile"],
  summary: "Profile field definitions in the order the super admin set (drives every app's profile page; cache up to 5 minutes)",
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
    200: { description: "Saved", content: json(z
            .object({
              field_key: z.string(),
              value: FieldValueSchema,
              updated_at: z.string().nullable(),
              public_url: z.string().optional().openapi({ description: "member_number only" }),
              duplicate_candidates: z
                .array(
                  z.object({
                    candidate_id: z.string().openapi({ description: "Opaque, valid 1 hour; pass to POST /v1/me/spouse" }),
                    display_name: z.string().nullable(),
                    avatar_url: z.string().nullable(),
                    rank: z.string().nullable(),
                    matched: MemberNumberEntrySchema,
                  }),
                )
                .optional()
                .openapi({ description: "member_number only: other members with the same number (ask whether to bind as spouses)" }),
            })
            .openapi("ProfileFieldWrite")) },
    ...errors,
    404: { description: "not_found (unknown field_key)", content: json(ErrorBodySchema) },
    422: { description: "invalid_field", content: json(ErrorBodySchema) },
    429: { description: "rate_limited (member_number: 3 self-service changes per 24 hours; see Retry-After)", content: json(ErrorBodySchema) },
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

const avatarUploadRoute = createRoute({
  method: "post",
  path: "/v1/me/profile/avatar",
  tags: ["profile"],
  summary: "Upload a square avatar: the raw image bytes as the request body (Content-Type image/jpeg, image/png or image/webp, at most 128 KB; resize to about 256 px first).",
  security,
  responses: { 200: { description: "Saved", content: json(z.object({ avatar: z.object({ url: z.string(), source: z.literal("upload") }) })) }, ...errors, 413: { description: "too_large", content: json(ErrorBodySchema) }, 422: { description: "invalid_field", content: json(ErrorBodySchema) } },
});
const avatarGoogleRoute = createRoute({
  method: "post",
  path: "/v1/me/profile/avatar/google",
  tags: ["profile"],
  summary: "Use my Google picture as avatar",
  security,
  responses: { 200: { description: "Saved", content: json(z.object({ avatar: z.object({ url: z.string(), source: z.literal("google") }) })) }, ...errors, 422: { description: "invalid_field (no Google picture)", content: json(ErrorBodySchema) } },
});
const vocabRoute = createRoute({
  method: "get",
  path: "/v1/vocab/suggestions",
  tags: ["profile"],
  summary: "Related words while typing: terms of the pool that contain any typed character (any order), best matches first",
  security,
  request: { query: z.object({ pool: z.string().max(40), q: z.string().max(60).default("") }) },
  responses: { 200: { description: "Suggestions", content: json(z.object({ pool: z.string(), suggestions: z.array(z.string()) })) }, ...errors, 422: { description: "invalid_field (unknown pool)", content: json(ErrorBodySchema) } },
});
const mottoRoute = createRoute({
  method: "get",
  path: "/v1/profile/suggestions/motto",
  tags: ["profile"],
  summary: "A random motto suggestion (fills the edit box; the member saves it explicitly)",
  security,
  request: { query: z.object({ current: z.string().max(200).optional() }) },
  responses: { 200: { description: "Suggestion", content: json(z.object({ motto: z.string() })) }, ...errors },
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
  app.use("/v1/vocab/*", auth);

  app.openapi(definitionsRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    const layout = await loadLayout(c.env.DB);
    c.header("cache-control", "private, max-age=300");
    return c.json(
      {
        version: DEFINITIONS_VERSION,
        groups: GROUPS,
        fields: [{ ...MEMBER_NUMBER_DEFINITION, options: memberNumberCountryOptions() }, ...applyOrder(fieldDefinitions(), layout)] as z.infer<typeof FieldDefinitionSchema>[],
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
    const numbers = await ensureMemberNumber(c.env.DB, member.id, member.registration_country, deps.now(), c.get("requestId"));
    const amway = member.amway_enabled === 1;
    const issuer = resolveIssuer(c.env, c.req.url);
    const memberNumber = {
      value: numbers,
      visibility: "public" as const,
      updated_at: null,
      label: amway ? MEMBER_NUMBER_DEFINITION.label_when_amway : MEMBER_NUMBER_DEFINITION.label,
      note: amway ? MEMBER_NUMBER_DEFINITION.help_when_amway : MEMBER_NUMBER_DEFINITION.help_when_not_amway,
      max_items: amway ? MEMBER_NUMBER_DEFINITION.max_items_when_amway : MEMBER_NUMBER_DEFINITION.max_items,
      public_url: numbers[0] ? `${issuer}/${encodeURIComponent(numbers[0].number)}` : null,
    };
    const birthday = typeof fields.birthday?.value === "string" ? fields.birthday.value : null;
    const chart = birthday ? lifeChartOf(birthday) : null;
    return c.json(
      {
        member_id: member.id,
        fields: { member_number: memberNumber, ...fields },
        avatar: { url: member.avatar_url, source: member.avatar_source, always_public: true as const },
        info: {
          member_id: member.id,
          registration_country: member.registration_country,
          account_status: member.status,
          zodiac: birthday ? zodiacSign(birthday) : null,
          life_path_number: chart?.life_number ?? null,
          talent_number: chart && chart.talent_numbers.length ? chart.talent_numbers.join("、") : null,
        },
        derived: { visibility: visibility.get("derived") ?? ("private" as const) },
        life_chart: chart as unknown as Record<string, unknown> | null,
      },
      200,
    );
  });

  app.openapi(putFieldRoute, async (c) => {
    const { field_key } = c.req.valid("param");
    if (field_key === "member_number") return putMemberNumbers(c, deps) as never;
    const def = getFieldDefinition(field_key);
    if (!def) return c.json(errorBody("not_found", "Unknown field", c.get("requestId"), { field_key }), 404);
    const denied = missingScope(c, [def.scope]);
    if (denied) return denied as never;
    const { value } = c.req.valid("json");
    const now = deps.now();
    const v = validateFieldValue(def, value, now);
    if (!v.ok) return invalid(c, field_key, v.reason, v.message);
    const { memberId, clientId } = c.get("auth");
    // Fields with a vocabulary: an existing spelling wins ("taipei university" is saved as "Taipei University"),
    // and what was typed is remembered as a related word for everyone.
    const pool = poolOfField(field_key);
    if (pool && v.value !== null) {
      const list = Array.isArray(v.value) ? v.value : [v.value];
      const canon = await canonicalTerms(c.env.DB, pool, list);
      v.value = Array.isArray(v.value) ? [...new Set(canon)] : (canon[0] ?? v.value);
      await recordTerms(c.env.DB, pool, canon, now);
    }
    const r = await writeField(c.env.DB, field_key, v.value, { memberId, appId: clientId, requestId: c.get("requestId"), now });
    return c.json({ field_key, value: v.value, updated_at: r.updated_at }, 200);
  });

  app.openapi(visibilityRoute, async (c) => {
    const denied = missingScope(c, ["profile.visibility.write"]);
    if (denied) return denied as never;
    const { fields } = c.req.valid("json");
    const entries = Object.entries(fields);
    if (entries.length > FIELD_KEYS.length + AMWAY_KEYS.length + 1) return invalid(c, "fields", "too_many", "欄位數量過多");
    for (const [key] of entries) {
      if (key === "member_number") return invalid(c, key, "always_public", "會員編號永遠公開，無法隱藏");
      if (key === "avatar") return invalid(c, key, "always_public", "頭像永遠公開，無法隱藏");
      if (!getFieldDefinition(key) && key !== "derived" && !AMWAY_KEYS.includes(key)) return invalid(c, key, "unknown_field", "沒有這個欄位");
    }
    const { memberId, clientId } = c.get("auth");
    await writeVisibility(c.env.DB, entries as [string, Visibility][], { memberId, appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    return c.json({ fields: Object.fromEntries(entries) as Record<string, Visibility> }, 200);
  });

  app.openapi(avatarUploadRoute, async (c) => {
    const denied = missingScope(c, ["profile.avatar.write"]);
    if (denied) return denied as never;
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > AVATAR_MAX_BYTES) return c.json(errorBody("too_large", "圖片太大（上限 128 KB），請先縮小。", c.get("requestId")), 413) as never;
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length > AVATAR_MAX_BYTES) return c.json(errorBody("too_large", "圖片太大（上限 128 KB），請先縮小。", c.get("requestId")), 413) as never;
    const mime = sniffImage(bytes);
    if (!mime) return invalid(c, "avatar", "not_an_image", "請上傳 JPEG、PNG 或 WebP 圖片") as never;
    const { memberId, clientId } = c.get("auth");
    const url = await saveAvatarUpload(c.env.DB, mime, bytes, resolveIssuer(c.env, c.req.url), { memberId, appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    return c.json({ avatar: { url, source: "upload" as const } }, 200);
  });
  app.openapi(avatarGoogleRoute, async (c) => {
    const denied = missingScope(c, ["profile.avatar.write"]);
    if (denied) return denied as never;
    const { memberId, clientId } = c.get("auth");
    const url = await useGoogleAvatar(c.env.DB, { memberId, appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    if (!url) return invalid(c, "avatar", "no_google_picture", "您的 Google 帳號沒有大頭貼") as never;
    return c.json({ avatar: { url, source: "google" as const } }, 200);
  });

  app.openapi(vocabRoute, async (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    const { pool, q } = c.req.valid("query");
    if (!isPool(pool)) return invalid(c, "pool", "unknown_pool", `沒有這個詞庫（可用：${Object.keys(POOLS).join("、")}）`) as never;
    const suggestions = q.trim() ? await suggestTerms(c.env.DB, pool, q) : [];
    return c.json({ pool, suggestions }, 200);
  });

  app.openapi(mottoRoute, (c) => {
    const denied = missingScope(c, ["profile.read"]);
    if (denied) return denied as never;
    return c.json({ motto: randomMotto(c.req.valid("query").current ?? null) }, 200);
  });

  app.openapi(avatarDeleteRoute, async (c) => {
    const denied = missingScope(c, ["profile.avatar.write"]);
    if (denied) return denied as never;
    const { memberId, clientId } = c.get("auth");
    await removeAvatar(c.env.DB, { memberId, appId: clientId, requestId: c.get("requestId"), now: deps.now() });
    return c.json({ avatar: { url: null, source: "none" as const } }, 200);
  });
}
