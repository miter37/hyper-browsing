import { z } from "zod";

export const LocatorStrategySchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  exact: z.boolean().optional(),
  testId: z.string().optional(),
  text: z.string().optional(),
  label: z.string().optional(),
  placeholder: z.string().optional(),
  css: z.string().optional(),
  within: z.string().optional(),
}).refine((v) => [v.role, v.testId, v.text, v.label, v.placeholder, v.css].filter(Boolean).length === 1, {
  message: "Each locator strategy must define exactly one primary strategy",
});

export const ElementSchema = z.object({
  strategies: z.array(LocatorStrategySchema).min(1),
  description: z.string().optional(),
});

const FingerprintAtomSchema = z.union([
  z.object({ url: z.string() }),
  z.object({ title: z.string() }),
  z.object({ text: z.string() }),
  z.object({ element: z.string() }),
  z.object({ fingerprint: z.string() }),
]);

export const FingerprintSchema = z.object({
  all: z.array(FingerprintAtomSchema).optional(),
  any: z.array(FingerprintAtomSchema).optional(),
}).refine((v) => Boolean(v.all?.length || v.any?.length), { message: "fingerprint requires all or any" });

export const ConditionSchema: z.ZodType<any> = z.lazy(() => z.union([
  z.object({ type: z.literal("fingerprint"), name: z.string() }),
  z.object({ type: z.literal("element_visible"), element: z.string() }),
  z.object({ type: z.literal("url_matches"), pattern: z.string() }),
  z.object({ type: z.literal("extractor_equals"), extractor: z.string(), value: z.string() }),
  z.object({ type: z.literal("extractor_exists"), extractor: z.string() }),
  z.object({ all: z.array(ConditionSchema).min(1) }),
  z.object({ any: z.array(ConditionSchema).min(1) }),
]));

export const ExtractorSchema = z.object({
  element: z.string(),
  read: z.enum(["text", "value", "attribute"]),
  attribute: z.string().optional(),
}).refine((v) => v.read !== "attribute" || Boolean(v.attribute), { message: "attribute extractor requires attribute" });

export const StepSchema = z.union([
  z.object({ op: z.literal("goto"), urlTemplate: z.string() }),
  z.object({ op: z.literal("click"), element: z.string() }),
  z.object({ op: z.literal("fill"), element: z.string(), value: z.string() }),
  z.object({ op: z.literal("select"), element: z.string(), value: z.string() }),
  z.object({ op: z.literal("press"), element: z.string().optional(), key: z.string() }),
  z.object({ op: z.literal("wait_for"), condition: ConditionSchema, timeoutMs: z.number().int().positive().optional() }),
]);

export const ImplementationSchema = z.union([
  z.object({ kind: z.literal("declarative"), steps: z.array(StepSchema) }),
  z.object({ kind: z.literal("code"), export: z.string().optional() }),
]);

export const VerifySchema = z.union([
  ConditionSchema,
  z.object({ type: z.literal("state_is"), state: z.string() }),
]);

export const ActionVariantSchema = z.object({
  lifecycle: z.enum(["encoded", "candidate", "verified"]),
  implementation: ImplementationSchema.optional(),
  verify: z.array(VerifySchema).optional(),
});

export const ActionSchema = z.object({
  knowledge: z.object({ capability: z.string(), scope: z.string() }).optional(),
  description: z.string().optional(),
  risk: z.enum(["read", "local_write", "external_write", "irreversible", "unclassified"]).default("unclassified"),
  lifecycle: z.enum(["encoded", "candidate", "verified"]).default("encoded"),
  allowedStates: z.array(z.string()).optional(),
  preconditions: z.array(z.string()).optional(),
  implementation: ImplementationSchema,
  returns: z.object({ extractor: z.string() }).optional(),
  verify: z.array(VerifySchema).default([]),
  variants: z.record(z.string(), ActionVariantSchema).optional(),
});

export const SiteSchema = z.object({
  site: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
    name: z.string().optional(),
    version: z.number().int().positive().default(1),
  }),
  match: z.object({
    hosts: z.array(z.string()).min(1),
    urlPatterns: z.array(z.string()).optional(),
    fingerprints: z.array(z.string()).optional(),
  }),
  fingerprints: z.record(z.string(), FingerprintSchema).default({}),
  states: z.record(z.string(), z.object({
    variants: z.array(z.string()).min(1),
    readyWhen: ConditionSchema.optional(),
  })).default({}),
  elements: z.record(z.string(), ElementSchema).default({}),
  extractors: z.record(z.string(), ExtractorSchema).default({}),
  preconditions: z.record(z.string(), ConditionSchema).default({}),
  urlTemplates: z.record(z.string(), z.string()).default({}),
  actions: z.record(z.string(), ActionSchema).default({}),
});

export type SiteDefinition = z.infer<typeof SiteSchema>;
export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;
export type ElementDefinition = z.infer<typeof ElementSchema>;
export type FingerprintDefinition = z.infer<typeof FingerprintSchema>;
export type ConditionDefinition = z.infer<typeof ConditionSchema>;
export type ActionDefinition = z.infer<typeof ActionSchema>;
export type ActionVariantDefinition = z.infer<typeof ActionVariantSchema>;
export type VerifyDefinition = z.infer<typeof VerifySchema>;
