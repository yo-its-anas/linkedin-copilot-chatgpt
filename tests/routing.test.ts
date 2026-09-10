import { describe, expect, it } from 'vitest';
import { routeLinkedInIntent } from '../src/routing.js';

const cases: [string, string[]][] = [
  ['Write a LinkedIn post about Kubernetes', ['linkedin-post']],
  ['Draft a post about our deployment lessons', ['linkedin-post']],
  ['Give me three hook options for this post', ['linkedin-post']],
  ['Write Tuesday', ['linkedin-post']],
  ['What should I post this week?', ['linkedin-plan']],
  ['Plan my content for next week', ['linkedin-plan']],
  ['Build a content calendar', ['linkedin-plan']],
  ['I have nothing to post about', ['linkedin-plan']],
  ['Analyze my last 20 posts', ['linkedin-audit']],
  ['Why are my LinkedIn impressions dropping?', ['linkedin-audit']],
  ['Which posts worked?', ['linkedin-audit']],
  ['Read these analytics', ['linkedin-audit']],
  ['Why did this post flop?', ['linkedin-audit']],
  ['Score my LinkedIn profile', ['linkedin-profile']],
  ['Rewrite my headline', ['linkedin-profile']],
  ['Fix my about section', ['linkedin-profile']],
  ['Review my experience entries', ['linkedin-profile']],
  ['Make this sound less AI generated', ['linkedin-humanize']],
  ['Humanize this draft', ['linkedin-humanize']],
  ['Remove the em dashes', ['linkedin-humanize']],
  ['Remove stock phrases', ['linkedin-humanize']],
  ['Turn this post into a carousel', ['linkedin-carousel']],
  ['Create a document post', ['linkedin-carousel']],
  ['Make slides for LinkedIn', ['linkedin-carousel']],
  ['Repurpose this transcript', ['linkedin-repurpose']],
  ['Turn this newsletter into posts', ['linkedin-repurpose']],
  ['Extract posts from this podcast', ['linkedin-repurpose']],
  ['Comment on this LinkedIn post', ['linkedin-comment']],
  ['Draft comments for these five posts', ['linkedin-comment']],
  ['What could I say under this?', ['linkedin-comment']],
  ['Reply to this comment', ['linkedin-reply']],
  ['Draft replies to comments on my latest post', ['linkedin-reply']],
  ['Handle my comments', ['linkedin-reply']],
  ['Write a LinkedIn DM to this person', ['linkedin-dm']],
  ['Draft a connection request', ['linkedin-dm']],
  ['Help me follow up on this outreach', ['linkedin-dm']],
  ['Triage my DMs', ['linkedin-inbox']],
  ['My inbox is a mess', ['linkedin-inbox']],
  ['Reply to this incoming message', ['linkedin-inbox']],
  ["Audit my profile and build me next week's content strategy", ['linkedin-profile', 'linkedin-audit', 'linkedin-plan']],
  ['Take my best-performing post and turn it into a carousel', ['linkedin-audit', 'linkedin-repurpose', 'linkedin-carousel']],
  ['Audit my posts and plan next week', ['linkedin-audit', 'linkedin-plan']],
  ['What is the weather today?', []],
  ['Write a SQL query', []],
  ['Audit Kubernetes cluster health', []],
  ['Make a presentation for the board', []],
];
describe('offline natural language routing regressions (not an LLM evaluation)', () => {
  it.each(cases)('%s', (prompt, expected) => expect(routeLinkedInIntent(prompt).skills).toEqual(expected));
  it('handles publication in conversational context without claiming approval', () => {
    expect(routeLinkedInIntent('Publish it', { previousSkill: 'linkedin-comment' })).toEqual({ skills: ['linkedin-comment'], action: 'write-request' });
  });
  it('does not interpret a drafting request as publication', () => {
    expect(routeLinkedInIntent('Write a post about DevOps').action).toBe('draft');
  });
  it.each(['Send this DM', 'Read my inbox', 'Update my LinkedIn profile', 'Search all LinkedIn posts', 'Scrape LinkedIn'])('marks unavailable execution: %s', prompt => {
    expect(routeLinkedInIntent(prompt).action).toBe('unsupported');
  });
});
