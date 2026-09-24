import { z } from 'zod';

const conversationDecisionSchema = z.object({
  schemaVersion: z.literal('conversation-intent-v1'),
  intent: z.enum([
    'general_chat',
    'sales_qa',
    'content_generate',
    'business_query',
    'followup_capture',
    'followup_analyze',
    'task_operation',
    'opportunity_operation',
    'project_diagnosis',
    'memory_save',
    'ambiguous',
  ]),
  confidence: z.number().min(0).max(1),
  reply: z.string().min(1).max(4000),
}).strict();

export { conversationDecisionSchema };
