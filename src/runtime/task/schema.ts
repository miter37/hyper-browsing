import {z} from 'zod';

const Ref=z.string().regex(/^e\d+$/);
export const StateSchema=z.object({value:z.string().max(2000).optional(),checked:z.union([z.boolean(),z.literal('mixed')]).optional(),selected:z.boolean().optional(),expanded:z.boolean().optional(),pressed:z.union([z.boolean(),z.literal('mixed')]).optional(),disabled:z.boolean().optional()}).strict();
export const GoalSchema=z.object({
 terms:z.array(z.string().trim().min(1).max(240)).max(8).default([]),
 fields:z.array(z.enum(['name','text','placeholder','label','value','href'])).min(1).max(6).default(['name','text']),
 roles:z.array(z.string().min(1).max(40)).min(1).max(12).optional(),exact:z.boolean().default(false),
 scope:z.union([z.enum(['active','document']),z.object({ref:Ref}).strict()]).default('active'),
 states:StateSchema.optional(),actionableOnly:z.boolean().default(true),
 textLimit:z.number().int().min(1).max(4000).default(500),
 limit:z.number().int().min(1).max(12).default(5),maxVisits:z.number().int().min(1).max(20000).default(12000),
 byteBudget:z.number().int().min(1000).max(16000).default(4000),
}).strict().refine(v=>v.terms.length>0||!!v.roles?.length,'Provide search terms or explicit roles');
export type Goal=z.infer<typeof GoalSchema>;
export function parseGoal(input:unknown):Goal{
 const result=GoalSchema.safeParse(input);if(!result.success)throw Object.assign(new Error('invalid_goal'),{code:'invalid_goal',execution:'not_started'});return result.data;
}
export const ExpectSchema=z.object({
 fields:StateSchema.optional(),goal:GoalSchema.optional(),exists:GoalSchema.optional(),introduced:GoalSchema.optional(),
 changed:z.object({ref:Ref}).strict().optional(),
 url:z.object({pathname:z.string().max(2000).optional(),includes:z.string().min(1).max(2000).optional()}).strict().refine(v=>v.pathname!==undefined||v.includes!==undefined).optional(),
}).strict().refine(v=>Boolean(v.fields&&Object.keys(v.fields).length||v.goal||v.exists||v.introduced||v.changed||v.url),'Provide a measurable condition');
export type Expect=z.infer<typeof ExpectSchema>;
const ActionSchema=z.object({op:z.enum(['click','fill','press','select','hover']),value:z.string().max(10000).optional(),key:z.string().min(1).max(80).optional(),option:z.string().max(2000).optional(),confirmed:z.boolean().optional()}).strict()
 .refine(v=>v.op==='fill'?v.value!==undefined:v.op==='press'?v.key!==undefined:v.op==='select'?v.option!==undefined:true,'Missing action input');
export const TaskSchema=z.object({steps:z.array(z.object({
 id:z.string().regex(/^[\w-]{1,32}$/),target:z.union([z.object({ref:Ref}).strict(),GoalSchema]),action:ActionSchema,expect:ExpectSchema.optional(),follow:GoalSchema.optional(),
}).strict()).min(1).max(4),timeoutMs:z.number().int().min(100).max(20000).default(20000),waitMs:z.number().int().min(0).max(3000).default(3000)}).strict()
 .refine(v=>new Set(v.steps.map(s=>s.id)).size===v.steps.length,'Duplicate step ids');
export type Task=z.infer<typeof TaskSchema>;
export function parseTask(input:unknown):Task{const result=TaskSchema.safeParse(input);if(!result.success)throw Object.assign(new Error('invalid_task'),{code:'invalid_task',execution:'not_started'});return result.data;}
export const FollowSchema=z.object({expect:ExpectSchema.optional(),follow:GoalSchema.optional(),waitMs:z.number().int().min(0).max(3000).default(3000)}).strict().refine(v=>!!v.expect||!!v.follow);
export function parseFollow(input:unknown){const result=FollowSchema.safeParse(input);if(!result.success)throw Object.assign(new Error('invalid_follow'),{code:'invalid_follow',execution:'not_started'});return result.data;}
