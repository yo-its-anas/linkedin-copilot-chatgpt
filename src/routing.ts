/** Offline routing regression helper. ChatGPT selects skills semantically from their descriptions.
 * This classifier never calls tools, grants approval, or replaces the host's intent routing. */
export type SkillName = 'linkedin-post' | 'linkedin-plan' | 'linkedin-audit' | 'linkedin-profile' |
  'linkedin-humanize' | 'linkedin-carousel' | 'linkedin-repurpose' | 'linkedin-comment' |
  'linkedin-reply' | 'linkedin-dm' | 'linkedin-inbox';
export function routeLinkedInIntent(prompt: string, context: { previousSkill?: SkillName } = {}) {
  const text = prompt.toLowerCase().replace(/[’]/g, "'");
  const has = (pattern: RegExp) => pattern.test(text);
  const skills: SkillName[] = [];
  const add = (skill: SkillName) => { if (!skills.includes(skill)) skills.push(skill); };
  let action: 'draft' | 'read' | 'write-request' | 'unsupported' | 'none' = 'none';
  if (has(/\b(weather|recipe|instagram|tiktok|sql query|kubernetes cluster health)\b/) && !has(/linkedin|post|carousel|humanize|less ai/)) return { skills, action };
  const profile = has(/\b(profile|headline|about section|experience entries|banner)\b/) && has(/audit|score|improve|optimi[sz]e|rewrite|fix|review|update/);
  const audit = has(/impressions|analytics|best[- ]performing|top[- ]performing|what('s| is) working|why.*flop|which posts.*work|analy[sz]e.*posts|audit.*(content|posts)/);
  const plan = has(/what should i post|plan.*(week|content)|content (calendar|strategy)|posting schedule|next week.*(strategy|post)|nothing to post|build.*week/);
  const carousel = has(/carousel|document post|slides for linkedin|linkedin slides/);
  const repurpose = has(/repurpose|turn.*(article|video|newsletter|transcript|podcast).*posts|extract.*posts/);
  if (profile) add('linkedin-profile');
  if (audit || (profile && plan)) add('linkedin-audit');
  if (plan) add('linkedin-plan');
  if (repurpose || (audit && carousel)) add('linkedin-repurpose');
  if (carousel) add('linkedin-carousel');
  const inbox = has(/inbox|triage.*(dm|message)|incoming (messages|dms)|reply to.*(dm|message)|should i reply to this message/);
  const dm = has(/connection (note|request)|invite note|\bdm\b|outreach|follow up|follow-up/);
  const reply = has(/repl(y|ies)|respond/) && has(/comment|thread|critic/);
  if (inbox) add('linkedin-inbox');
  else if (dm) add('linkedin-dm');
  else if (reply || has(/handle my comments/)) add('linkedin-reply');
  else if (has(/comment on|draft comments|engagement round|say under/)) add('linkedin-comment');
  if (has(/humanize|less ai|less machine|formulaic|stock phrases|remove.*em dash|sound more like me/)) add('linkedin-humanize');
  if (!skills.length && has(/(write|draft|post|hook).*(linkedin|post|hook)|write (tuesday|wednesday|thursday|friday)|post about/)) add('linkedin-post');
  if (!skills.length && context.previousSkill && has(/^(publish it|post it|send it|yes|make it shorter|rewrite it)[.!]?$/)) add(context.previousSkill);
  if (skills.length) action = skills.every(skill => skill === 'linkedin-audit') ? 'read' : 'draft';
  if (has(/^(publish|post) (it|this|the)|publish.*(post|comment|reply)|delete.*post/)) {
    action = 'write-request';
    if (!skills.length) add(context.previousSkill ?? 'linkedin-post');
  }
  if (has(/send.*(dm|message|invite|connection)|read my (inbox|conversations)|search.*linkedin.*posts|update.*(linkedin )?profile|scrape.*linkedin|send it/) && !has(/draft|write.*message|do not send|don't send/)) action = 'unsupported';
  return { skills, action };
}
