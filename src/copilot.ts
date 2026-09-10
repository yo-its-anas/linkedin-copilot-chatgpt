import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { AppError } from './errors.js';

const workflowNames = ['linkedin-post', 'linkedin-plan', 'linkedin-audit', 'linkedin-profile', 'linkedin-humanize', 'linkedin-carousel', 'linkedin-repurpose', 'linkedin-comment', 'linkedin-reply', 'linkedin-dm', 'linkedin-inbox', 'linkedin-router'] as const;
const titles = ['Draft a post', 'Plan a week', 'Audit posts and metrics', 'Review supplied profile content', 'Humanize writing', 'Create carousel copy', 'Repurpose source material', 'Draft comments', 'Draft replies', 'Draft a DM for manual sending', 'Triage supplied conversations', 'Coordinate workflows'];
const workflowInput = z.object({ workflow: z.enum(workflowNames) }).strict();
const names = new Set(['linkedin_get_copilot_guide', 'linkedin_get_workflow']);
const resources: Partial<Record<typeof workflowNames[number], string[]>> = {
  'linkedin-post': ['hooks.json'],
  'linkedin-profile': ['rubric.json'],
  'linkedin-humanize': ['slop.json'],
};

export const copilotCatalog = [
  { name: 'linkedin_get_copilot_guide', title: 'Get started with LinkedIn Copilot', description: 'Explain this Copilot by Muhammad Anas, its twelve workflows, setup and configured tools. Use for what can you do, what skills do you have, or getting started. Public help only; does not verify account connection or install anything.', inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false } },
  { name: 'linkedin_get_workflow', title: 'Load a LinkedIn Copilot workflow', description: 'Retrieve canonical writing or analysis instructions and their reference data for use in this conversation, even without LinkedIn login. ChatGPT performs the workflow using supplied material. This tool does not generate a draft, install skills, save memory or perform LinkedIn actions.', inputSchema: { type: 'object' as const, properties: { workflow: { type: 'string', enum: [...workflowNames] } }, required: ['workflow'], additionalProperties: false } },
].map(tool => ({
  ...tool,
  outputSchema: { type: 'object' as const, properties: { result: { type: 'object' as const, additionalProperties: true } }, required: ['result'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  securitySchemes: [{ type: 'noauth' }],
  _meta: { securitySchemes: [{ type: 'noauth' }] },
}));

export function isCopilotTool(name: string) { return names.has(name); }

export function callCopilotTool(name: string, input: unknown, configuredTools: string[]) {
  let result: Record<string, unknown>;
  if (name === 'linkedin_get_copilot_guide') {
    if (!z.object({}).strict().safeParse(input ?? {}).success) throw new AppError('invalid_input', 'This guide takes no arguments.', 400);
    result = {
      product: 'LinkedIn Copilot for ChatGPT', creator: 'Muhammad Anas',
      repository: 'https://github.com/yo-its-anas/linkedin-copilot-chatgpt',
      workflows: workflowNames.map((id, index) => ({ id, title: titles[index] })),
      configuredTools,
      accountStatus: 'Not checked. Configured tools are not proof of account authorization; use linkedin_get_connection_status for live requests.',
      gettingStarted: 'Ask for a post, weekly plan, carousel or review and supply the source material. Load the relevant workflow only when needed. Carry the draft through follow-up requests in this chat.',
      connection: 'Drafting needs no LinkedIn login. Saved preferences and supported account actions require this Copilot app connection, granted scopes and host permissions. A separate LinkedIn search connector does not supply this app connection.',
      persistence: 'The host manages installed skills. These public help tools do not install skills or write ChatGPT memory. Save reviewed preferences with linkedin_update_user_context only when requested and authenticated.',
      unavailableActions: ['people search', 'live inbox reads', 'DM or invitation sending', 'profile editing', 'media upload', 'reactions', 'scheduled publishing'],
    };
  } else if (name === 'linkedin_get_workflow') {
    const parsed = workflowInput.safeParse(input ?? {});
    if (!parsed.success) throw new AppError('invalid_input', 'Choose a workflow ID from the Copilot guide. File paths and URLs are not accepted.', 400);
    const id = parsed.data.workflow;
    // IDs and resource names come only from fixed allowlists, never caller paths.
    const directory = new URL(`../skills/${id}/`, import.meta.url);
    result = {
      workflow: id,
      instructions: readFileSync(new URL('SKILL.md', directory), 'utf8'),
      resources: Object.fromEntries((resources[id] ?? []).map(file => [file, JSON.parse(readFileSync(new URL(file, directory), 'utf8'))])),
      execution: 'Apply these instructions in ChatGPT. Resolve links to another skill through linkedin_get_workflow if needed. Optional Python helpers require an available local file runtime; use editorial reasoning otherwise. Do not claim a script ran or a skill was installed.',
    };
  } else {
    throw new AppError('unsupported_tool', 'This public Copilot tool is unavailable.', 404);
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: { result } };
}
